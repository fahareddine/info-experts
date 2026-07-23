-- Durcissement sécurité + index sur clés étrangères.
--
-- 1) Révoque tous les privilèges anon/authenticated sur les tables
--    info-experts : le backend n'utilise que service_role. En plus du RLS
--    (défense en profondeur), cela retire ces tables du schéma GraphQL public.
--    Les tables aircomores_* ne sont PAS touchées (frontend séparé, policies dédiées).
--
-- 2) Fixe le search_path de set_updated_at (lint 0011 function_search_path_mutable).
--
-- 3) Index sur les clés étrangères non couvertes (lint 0001 unindexed_foreign_keys).

-- 1) Révocation des privilèges anon / authenticated
REVOKE ALL ON public.appointments FROM anon, authenticated;
REVOKE ALL ON public.orders FROM anon, authenticated;
REVOKE ALL ON public.payments FROM anon, authenticated;
REVOKE ALL ON public.admin_events FROM anon, authenticated;
REVOKE ALL ON public.customer_profiles FROM anon, authenticated;
REVOKE ALL ON public.customer_interactions FROM anon, authenticated;
REVOKE ALL ON public.accounting_expenses FROM anon, authenticated;
REVOKE ALL ON public.billing_clients FROM anon, authenticated;
REVOKE ALL ON public.billing_documents FROM anon, authenticated;
REVOKE ALL ON public.billing_document_items FROM anon, authenticated;
REVOKE ALL ON public.billing_document_logs FROM anon, authenticated;

-- 2) search_path immuable pour la fonction trigger
ALTER FUNCTION public.set_updated_at() SET search_path = '';

-- 3) Index sur les clés étrangères
CREATE INDEX IF NOT EXISTS payments_appointment_id_idx ON public.payments (appointment_id);
CREATE INDEX IF NOT EXISTS payments_order_id_idx ON public.payments (order_id);
CREATE INDEX IF NOT EXISTS billing_documents_client_id_idx ON public.billing_documents (client_id);
CREATE INDEX IF NOT EXISTS billing_documents_linked_document_id_idx ON public.billing_documents (linked_document_id);
CREATE INDEX IF NOT EXISTS billing_document_items_document_id_idx ON public.billing_document_items (document_id);
CREATE INDEX IF NOT EXISTS billing_document_logs_document_id_idx ON public.billing_document_logs (document_id);
CREATE INDEX IF NOT EXISTS aircomores_bookings_departure_id_idx ON public.aircomores_bookings (departure_id);
CREATE INDEX IF NOT EXISTS aircomores_bookings_return_departure_id_idx ON public.aircomores_bookings (return_departure_id);
CREATE INDEX IF NOT EXISTS aircomores_passengers_booking_id_idx ON public.aircomores_passengers (booking_id);
