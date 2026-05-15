-- Billing clients (no account required)
create table if not exists public.billing_clients (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  first_name text,
  last_name text,
  email text,
  phone text,
  address text,
  city text,
  country text default 'Comores',
  company text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists billing_clients_email_idx on public.billing_clients(email);
create index if not exists billing_clients_name_idx on public.billing_clients(display_name);

-- Documents: invoice, proforma, reminder
create table if not exists public.billing_documents (
  id uuid primary key default gen_random_uuid(),
  doc_number text unique not null,
  doc_type text not null check (doc_type in ('invoice','proforma','reminder')),
  status text not null default 'draft',
  client_id uuid references public.billing_clients(id) on delete set null,
  client_name text not null default '',
  client_first_name text,
  client_last_name text,
  client_email text,
  client_phone text,
  client_address text,
  client_city text,
  client_country text default 'Comores',
  client_company text,
  issue_date date not null default current_date,
  due_date date,
  validity_date date,
  payment_method text,
  payment_reference text,
  subtotal_kmf integer not null default 0,
  discount_kmf integer not null default 0,
  tax_rate integer not null default 0,
  tax_kmf integer not null default 0,
  total_kmf integer not null default 0,
  paid_kmf integer not null default 0,
  notes text,
  message text,
  reminder_level text check (reminder_level in ('friendly','firm','final')),
  linked_document_id uuid references public.billing_documents(id) on delete set null,
  email_sent_count integer not null default 0,
  last_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists billing_documents_type_idx on public.billing_documents(doc_type);
create index if not exists billing_documents_status_idx on public.billing_documents(status);
create index if not exists billing_documents_client_id_idx on public.billing_documents(client_id);
create index if not exists billing_documents_created_at_idx on public.billing_documents(created_at desc);

-- Line items
create table if not exists public.billing_document_items (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.billing_documents(id) on delete cascade,
  sort_order integer not null default 0,
  description text not null,
  details text,
  quantity numeric not null default 1,
  unit_price_kmf integer not null default 0,
  total_kmf integer not null default 0
);
create index if not exists billing_document_items_doc_idx on public.billing_document_items(document_id);

-- Audit log
create table if not exists public.billing_document_logs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.billing_documents(id) on delete cascade,
  action text not null,
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists billing_document_logs_doc_idx on public.billing_document_logs(document_id);

-- Auto-update triggers (reuse existing set_updated_at if available)
drop trigger if exists billing_clients_updated_at on public.billing_clients;
create trigger billing_clients_updated_at before update on public.billing_clients for each row execute function public.set_updated_at();
drop trigger if exists billing_documents_updated_at on public.billing_documents;
create trigger billing_documents_updated_at before update on public.billing_documents for each row execute function public.set_updated_at();
