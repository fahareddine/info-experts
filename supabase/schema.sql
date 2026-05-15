create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  source text not null default 'booking' check (source in ('booking')),
  status text not null check (status in ('confirmed', 'payment_submitted', 'cash_reserved', 'cancelled', 'rejected', 'completed')),
  payment_type text not null check (payment_type in ('free', 'mobile_money', 'cash')),
  service_name text not null,
  service_duration_minutes integer not null check (service_duration_minutes > 0),
  service_price_kmf integer not null default 0 check (service_price_kmf >= 0),
  deposit_amount_kmf integer not null default 0 check (deposit_amount_kmf >= 0),
  appointment_date date not null,
  appointment_time time not null,
  appointment_timezone text not null default 'Indian/Comoro',
  technician_name text not null,
  location text not null,
  customer_first_name text not null,
  customer_last_name text,
  customer_full_name text not null,
  customer_email text not null,
  customer_phone text,
  notes text,
  payment_operator text,
  payment_reference text,
  is_test boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists appointments_active_slot_idx
on public.appointments (appointment_date, appointment_time, technician_name)
where status in ('confirmed', 'payment_submitted', 'cash_reserved');

create index if not exists appointments_created_at_idx
on public.appointments (created_at desc);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  source text not null default 'boutique' check (source in ('boutique')),
  status text not null check (status in ('payment_submitted', 'cash_reserved', 'validated', 'rejected', 'cancelled', 'fulfilled')),
  payment_type text not null check (payment_type in ('mobile_money', 'cash')),
  product_name text not null,
  amount_kmf integer not null check (amount_kmf >= 0),
  customer_full_name text not null,
  customer_email text,
  customer_phone text not null,
  payment_operator text,
  payment_reference text,
  is_test boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_created_at_idx
on public.orders (created_at desc);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  source text not null check (source in ('booking', 'boutique', 'standalone')),
  status text not null check (status in ('pending_review', 'cash_reserved', 'validated', 'failed')),
  payment_type text not null check (payment_type in ('mobile_money', 'cash')),
  appointment_id uuid references public.appointments(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  label text not null,
  amount_kmf integer not null check (amount_kmf >= 0),
  customer_full_name text not null,
  customer_email text,
  customer_phone text not null,
  operator text,
  client_reference text,
  is_test boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payments_created_at_idx
on public.payments (created_at desc);

create table if not exists public.admin_events (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('appointment', 'order', 'payment', 'customer')),
  entity_reference text not null,
  action text not null,
  actor_label text not null default 'admin',
  from_status text,
  to_status text,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_events_entity_idx
on public.admin_events (entity_type, entity_reference, created_at desc);

create table if not exists public.customer_profiles (
  customer_key text primary key,
  display_name text not null,
  normalized_email text,
  normalized_phone text,
  email text,
  phone text,
  lifecycle_status text not null default 'lead' check (lifecycle_status in ('lead', 'active', 'vip', 'blocked', 'test')),
  tags jsonb not null default '[]'::jsonb,
  notes text,
  is_test boolean not null default false,
  orders_count integer not null default 0 check (orders_count >= 0),
  appointments_count integer not null default 0 check (appointments_count >= 0),
  payments_count integer not null default 0 check (payments_count >= 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_order_at timestamptz,
  last_appointment_at timestamptz,
  last_payment_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists customer_profiles_normalized_email_idx
on public.customer_profiles (normalized_email)
where normalized_email is not null;

create unique index if not exists customer_profiles_normalized_phone_idx
on public.customer_profiles (normalized_phone)
where normalized_phone is not null;

create index if not exists customer_profiles_last_seen_idx
on public.customer_profiles (last_seen_at desc);

create table if not exists public.customer_interactions (
  id uuid primary key default gen_random_uuid(),
  customer_key text not null references public.customer_profiles(customer_key) on delete cascade,
  channel text not null check (channel in ('email', 'phone', 'whatsapp', 'website', 'admin', 'system')),
  direction text not null check (direction in ('inbound', 'outbound', 'internal')),
  summary text not null,
  content text,
  related_entity_type text check (related_entity_type in ('appointment', 'order', 'payment', 'customer')),
  related_entity_reference text,
  created_by_role text not null default 'system' check (created_by_role in ('system', 'viewer', 'manager')),
  is_test boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists customer_interactions_customer_idx
on public.customer_interactions (customer_key, created_at desc);

drop trigger if exists appointments_set_updated_at on public.appointments;
create trigger appointments_set_updated_at
before update on public.appointments
for each row
execute function public.set_updated_at();

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
before update on public.orders
for each row
execute function public.set_updated_at();

drop trigger if exists payments_set_updated_at on public.payments;
create trigger payments_set_updated_at
before update on public.payments
for each row
execute function public.set_updated_at();

drop trigger if exists customer_profiles_set_updated_at on public.customer_profiles;
create trigger customer_profiles_set_updated_at
before update on public.customer_profiles
for each row
execute function public.set_updated_at();
