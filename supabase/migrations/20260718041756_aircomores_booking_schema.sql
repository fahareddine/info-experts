-- Air Comores : vols, départs datés, réservations, passagers.
-- Tables préfixées aircomores_ pour rester isolées des autres apps de ce projet Supabase.

create table public.aircomores_flight_legs (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  route_from text not null,
  route_to text not null,
  departure_place text not null,
  departure_code text not null,
  departure_time text not null,
  arrival_place text not null,
  arrival_code text not null,
  duration_minutes int not null,
  price_kmf int not null,
  capacity int not null default 8,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.aircomores_flight_departures (
  id uuid primary key default gen_random_uuid(),
  leg_id uuid not null references public.aircomores_flight_legs(id) on delete cascade,
  departure_date date not null,
  seats_available int not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  created_at timestamptz not null default now(),
  unique (leg_id, departure_date)
);

create table public.aircomores_bookings (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  departure_id uuid not null references public.aircomores_flight_departures(id),
  contact_full_name text not null,
  contact_email text not null,
  contact_phone text not null,
  passenger_count int not null check (passenger_count > 0),
  total_price_kmf int not null,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  created_at timestamptz not null default now()
);

create table public.aircomores_passengers (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.aircomores_bookings(id) on delete cascade,
  full_name text not null,
  created_at timestamptz not null default now()
);

-- RLS : lecture publique uniquement sur les vols/départs (données non sensibles,
-- utiles pour afficher horaires + places restantes côté site).
-- Aucun accès direct anon sur bookings/passengers (données personnelles) :
-- tout passe par l'Edge Function via la clé service_role, qui contourne RLS.

alter table public.aircomores_flight_legs enable row level security;
alter table public.aircomores_flight_departures enable row level security;
alter table public.aircomores_bookings enable row level security;
alter table public.aircomores_passengers enable row level security;

create policy "flight_legs are publicly readable"
  on public.aircomores_flight_legs for select
  to anon, authenticated
  using (true);

create policy "flight_departures are publicly readable"
  on public.aircomores_flight_departures for select
  to anon, authenticated
  using (true);

-- Aucune policy sur bookings/passengers pour anon/authenticated : RLS activée
-- sans policy = accès refusé par défaut. Seul service_role (Edge Function) écrit/lit.

-- Fonction atomique : vérifie les places dispo, décrémente, insère la réservation
-- et les passagers en une seule transaction (évite le surbooking en cas de requêtes
-- concurrentes). SECURITY DEFINER pour s'exécuter avec les droits du propriétaire.
create or replace function public.aircomores_create_booking(
  p_departure_id uuid,
  p_contact_full_name text,
  p_contact_email text,
  p_contact_phone text,
  p_total_price_kmf int,
  p_passenger_names text[]
)
returns table (
  booking_id uuid,
  reference text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_passenger_count int := array_length(p_passenger_names, 1);
  v_seats_available int;
  v_reference text;
  v_booking_id uuid;
  v_name text;
begin
  if v_passenger_count is null or v_passenger_count < 1 then
    raise exception 'at_least_one_passenger_required';
  end if;

  select seats_available into v_seats_available
  from public.aircomores_flight_departures
  where id = p_departure_id and status = 'scheduled'
  for update;

  if v_seats_available is null then
    raise exception 'departure_not_found';
  end if;

  if v_seats_available < v_passenger_count then
    raise exception 'not_enough_seats';
  end if;

  update public.aircomores_flight_departures
  set seats_available = seats_available - v_passenger_count
  where id = p_departure_id;

  v_reference := 'AC-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));

  insert into public.aircomores_bookings (
    reference, departure_id, contact_full_name, contact_email,
    contact_phone, passenger_count, total_price_kmf
  ) values (
    v_reference, p_departure_id, p_contact_full_name, p_contact_email,
    p_contact_phone, v_passenger_count, p_total_price_kmf
  )
  returning id into v_booking_id;

  foreach v_name in array p_passenger_names loop
    insert into public.aircomores_passengers (booking_id, full_name)
    values (v_booking_id, v_name);
  end loop;

  return query select v_booking_id, v_reference;
end;
$$;

-- Exécutable uniquement par service_role (appelé depuis l'Edge Function), jamais
-- directement par le navigateur.
revoke execute on function public.aircomores_create_booking from public, anon, authenticated;
grant execute on function public.aircomores_create_booking to service_role;
;
