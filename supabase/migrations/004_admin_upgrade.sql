alter table public.appointments
  add column if not exists is_test boolean not null default false;

alter table public.orders
  add column if not exists is_test boolean not null default false;

alter table public.payments
  add column if not exists is_test boolean not null default false;

alter table public.admin_events
  drop constraint if exists admin_events_entity_type_check;

alter table public.admin_events
  add constraint admin_events_entity_type_check
  check (entity_type in ('appointment', 'order', 'payment', 'customer'));

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

drop trigger if exists customer_profiles_set_updated_at on public.customer_profiles;
create trigger customer_profiles_set_updated_at
before update on public.customer_profiles
for each row
execute function public.set_updated_at();

update public.appointments
set is_test = true
where is_test = false
  and (
    lower(coalesce(customer_full_name, '')) like '%test%'
    or lower(coalesce(customer_email, '')) like '%@example.com%'
    or lower(coalesce(service_name, '')) like '%test%'
  );

update public.orders
set is_test = true
where is_test = false
  and (
    lower(coalesce(customer_full_name, '')) like '%test%'
    or lower(coalesce(customer_email, '')) like '%@example.com%'
    or lower(coalesce(product_name, '')) like '%test%'
  );

update public.payments
set is_test = true
where is_test = false
  and (
    lower(coalesce(customer_full_name, '')) like '%test%'
    or lower(coalesce(customer_email, '')) like '%@example.com%'
    or lower(coalesce(label, '')) like '%test%'
  );

with customer_sources as (
  select
    coalesce(nullif(lower(customer_email), ''), nullif(regexp_replace(customer_phone, '[^0-9+]', '', 'g'), '')) as customer_key_seed,
    customer_full_name as display_name,
    lower(nullif(customer_email, '')) as email,
    nullif(regexp_replace(customer_phone, '[^0-9+]', '', 'g'), '') as phone,
    is_test,
    created_at,
    case when source_table = 'orders' then 1 else 0 end as orders_count,
    case when source_table = 'appointments' then 1 else 0 end as appointments_count,
    case when source_table = 'payments' then 1 else 0 end as payments_count,
    case when source_table = 'orders' then created_at end as last_order_at,
    case when source_table = 'appointments' then created_at end as last_appointment_at,
    case when source_table = 'payments' then created_at end as last_payment_at
  from (
    select 'orders' as source_table, customer_full_name, customer_email, customer_phone, is_test, created_at from public.orders
    union all
    select 'appointments' as source_table, customer_full_name, customer_email, customer_phone, is_test, created_at from public.appointments
    union all
    select 'payments' as source_table, customer_full_name, customer_email, customer_phone, is_test, created_at from public.payments
  ) src
), aggregated as (
  select
    case
      when email is not null and email <> '' then 'email:' || email
      when phone is not null and phone <> '' then 'phone:' || phone
      else null
    end as customer_key,
    max(display_name) as display_name,
    max(email) as email,
    max(phone) as phone,
    bool_or(is_test) as is_test,
    min(created_at) as first_seen_at,
    max(created_at) as last_seen_at,
    sum(orders_count) as orders_count,
    sum(appointments_count) as appointments_count,
    sum(payments_count) as payments_count,
    max(last_order_at) as last_order_at,
    max(last_appointment_at) as last_appointment_at,
    max(last_payment_at) as last_payment_at
  from customer_sources
  where customer_key_seed is not null
  group by 1
)
insert into public.customer_profiles (
  customer_key,
  display_name,
  normalized_email,
  normalized_phone,
  email,
  phone,
  lifecycle_status,
  is_test,
  orders_count,
  appointments_count,
  payments_count,
  first_seen_at,
  last_seen_at,
  last_order_at,
  last_appointment_at,
  last_payment_at
)
select
  customer_key,
  coalesce(display_name, 'Client Info Experts'),
  email,
  phone,
  email,
  phone,
  case when is_test then 'test' else 'lead' end,
  is_test,
  orders_count,
  appointments_count,
  payments_count,
  first_seen_at,
  last_seen_at,
  last_order_at,
  last_appointment_at,
  last_payment_at
from aggregated
where customer_key is not null
on conflict (customer_key) do update
set
  display_name = excluded.display_name,
  normalized_email = excluded.normalized_email,
  normalized_phone = excluded.normalized_phone,
  email = excluded.email,
  phone = excluded.phone,
  lifecycle_status = case when public.customer_profiles.lifecycle_status = 'test' or excluded.is_test then 'test' else public.customer_profiles.lifecycle_status end,
  is_test = public.customer_profiles.is_test or excluded.is_test,
  orders_count = greatest(public.customer_profiles.orders_count, excluded.orders_count),
  appointments_count = greatest(public.customer_profiles.appointments_count, excluded.appointments_count),
  payments_count = greatest(public.customer_profiles.payments_count, excluded.payments_count),
  first_seen_at = least(public.customer_profiles.first_seen_at, excluded.first_seen_at),
  last_seen_at = greatest(public.customer_profiles.last_seen_at, excluded.last_seen_at),
  last_order_at = greatest(public.customer_profiles.last_order_at, excluded.last_order_at),
  last_appointment_at = greatest(public.customer_profiles.last_appointment_at, excluded.last_appointment_at),
  last_payment_at = greatest(public.customer_profiles.last_payment_at, excluded.last_payment_at);
