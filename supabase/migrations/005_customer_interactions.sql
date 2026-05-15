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
