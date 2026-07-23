-- Aller-retour + paiement : la réservation tient en une ligne (aller +
-- retour optionnel) avec un statut de paiement. Une réservation non payée
-- reste une réservation (place bloquée) ; le billet devient définitif quand
-- le staff passe payment_status à 'paid' (trigger → email automatique).

alter table public.aircomores_bookings
  add column return_departure_id uuid references public.aircomores_flight_departures(id),
  add column payment_method text check (payment_method in ('virement', 'mobile_money', 'cash_agence')),
  add column payment_status text not null default 'pending' check (payment_status in ('pending', 'paid')),
  add column paid_at timestamptz;

-- RPC v2 : décompte atomique des places sur 1 ou 2 tronçons (verrous ordonnés
-- par id pour éviter les interblocages entre réservations concurrentes).
drop function if exists public.aircomores_create_booking(uuid, text, text, text, int, text[]);

create or replace function public.aircomores_create_booking(
  p_departure_id uuid,
  p_return_departure_id uuid,
  p_contact_full_name text,
  p_contact_email text,
  p_contact_phone text,
  p_total_price_kmf int,
  p_passenger_names text[],
  p_payment_method text
)
returns table (booking_id uuid, reference text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_passenger_count int := array_length(p_passenger_names, 1);
  v_ids uuid[];
  v_id uuid;
  v_seats int;
  v_reference text;
  v_booking_id uuid;
  v_name text;
begin
  if v_passenger_count is null or v_passenger_count < 1 then
    raise exception 'at_least_one_passenger_required';
  end if;
  if p_payment_method is null
     or p_payment_method not in ('virement', 'mobile_money', 'cash_agence') then
    raise exception 'invalid_payment_method';
  end if;

  v_ids := array[p_departure_id];
  if p_return_departure_id is not null then
    if p_return_departure_id = p_departure_id then
      raise exception 'return_equals_outbound';
    end if;
    v_ids := v_ids || p_return_departure_id;
  end if;

  -- Verrous dans un ordre stable, puis vérification des places de chaque tronçon.
  foreach v_id in array (select array_agg(x order by x) from unnest(v_ids) as x) loop
    select seats_available into v_seats
    from public.aircomores_flight_departures
    where id = v_id and status = 'scheduled'
    for update;

    if v_seats is null then
      raise exception 'departure_not_found';
    end if;
    if v_seats < v_passenger_count then
      raise exception 'not_enough_seats';
    end if;
  end loop;

  update public.aircomores_flight_departures
  set seats_available = seats_available - v_passenger_count
  where id = any(v_ids);

  v_reference := 'AC-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));

  insert into public.aircomores_bookings (
    reference, departure_id, return_departure_id, contact_full_name,
    contact_email, contact_phone, passenger_count, total_price_kmf,
    payment_method, payment_status
  ) values (
    v_reference, p_departure_id, p_return_departure_id, p_contact_full_name,
    p_contact_email, p_contact_phone, v_passenger_count, p_total_price_kmf,
    p_payment_method, 'pending'
  )
  returning id into v_booking_id;

  foreach v_name in array p_passenger_names loop
    insert into public.aircomores_passengers (booking_id, full_name)
    values (v_booking_id, v_name);
  end loop;

  return query select v_booking_id, v_reference;
end;
$$;

revoke execute on function public.aircomores_create_booking from public, anon, authenticated;
grant execute on function public.aircomores_create_booking to service_role;
;
