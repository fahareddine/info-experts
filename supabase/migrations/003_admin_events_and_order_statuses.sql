alter table public.orders
  drop constraint if exists orders_status_check;

alter table public.orders
  add constraint orders_status_check
  check (status in ('payment_submitted', 'cash_reserved', 'validated', 'rejected', 'cancelled', 'fulfilled'));

create table if not exists public.admin_events (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('appointment', 'order', 'payment')),
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
