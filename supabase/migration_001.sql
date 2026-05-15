-- Migration 001 : email_logs + rate_limit_requests
-- À exécuter manuellement dans Supabase SQL Editor

-- Logs de livraison des emails (Resend)
create table if not exists public.email_logs (
  id uuid primary key default gen_random_uuid(),
  to_address text not null,
  subject text not null,
  email_type text,
  entity_reference text,
  status text not null check (status in ('sent', 'failed', 'skipped')),
  error_message text,
  resend_id text,
  created_at timestamptz not null default now()
);

create index if not exists email_logs_entity_idx
on public.email_logs (entity_reference, created_at desc)
where entity_reference is not null;

create index if not exists email_logs_created_at_idx
on public.email_logs (created_at desc);

-- Suivi des tentatives pour le rate limiting (1 ligne = 1 requête)
create table if not exists public.rate_limit_requests (
  id uuid primary key default gen_random_uuid(),
  ip_hash text not null,
  endpoint text not null,
  created_at timestamptz not null default now()
);

create index if not exists rate_limit_requests_ip_idx
on public.rate_limit_requests (ip_hash, endpoint, created_at desc);

-- Logs d'envoi SMS (Twilio)
create table if not exists public.sms_logs (
  id uuid primary key default gen_random_uuid(),
  to_number text not null,
  body text not null,
  entity_reference text,
  sms_type text,
  status text not null check (status in ('sent', 'failed', 'skipped')),
  error_message text,
  twilio_sid text,
  created_at timestamptz not null default now()
);

create index if not exists sms_logs_entity_idx
on public.sms_logs (entity_reference, created_at desc)
where entity_reference is not null;

create index if not exists sms_logs_created_at_idx
on public.sms_logs (created_at desc);

-- Nettoyage automatique : supprimer les entrées de plus de 2 heures
-- (à appeler depuis le cron ou manuellement)
-- delete from public.rate_limit_requests where created_at < now() - interval '2 hours';
-- delete from public.email_logs where created_at < now() - interval '90 days';
-- delete from public.sms_logs where created_at < now() - interval '90 days';
