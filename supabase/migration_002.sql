-- Migration 002 : module comptabilité — dépenses

create table if not exists public.accounting_expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null,
  category text not null,
  supplier text,
  description text not null,
  amount_kmf integer not null check (amount_kmf > 0),
  payment_method text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists accounting_expenses_date_idx
on public.accounting_expenses (expense_date desc);

create index if not exists accounting_expenses_category_idx
on public.accounting_expenses (category);

drop trigger if exists accounting_expenses_set_updated_at on public.accounting_expenses;
create trigger accounting_expenses_set_updated_at
before update on public.accounting_expenses
for each row execute function public.set_updated_at();
