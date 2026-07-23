-- Active le Row Level Security sur les tables info-experts.
-- Le backend (api/ + lib/server/supabase.js) utilise exclusivement la clé
-- service_role, qui contourne le RLS : aucune policy n'est nécessaire.
-- Sans policy, RLS = accès totalement fermé pour les clés anon/authenticated.

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_document_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_document_logs ENABLE ROW LEVEL SECURITY;
