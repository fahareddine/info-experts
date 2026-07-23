-- À la validation du paiement (pending → paid), on horodate et on notifie
-- l'Edge Function send-paid-ticket qui envoie le billet définitif par email.
-- Le staff n'a qu'à changer payment_status dans le dashboard Supabase.

create extension if not exists pg_net with schema extensions;

create or replace function public.aircomores_on_payment_validated()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.payment_status = 'paid' and old.payment_status = 'pending' then
    new.paid_at := now();
    perform net.http_post(
      url := 'https://hochavewlwbmfhxsigzn.supabase.co/functions/v1/send-paid-ticket',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-aircomores-secret', 'acm_tk_7f3d9b2e5a81c4d6'
      ),
      body := jsonb_build_object('bookingId', new.id)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists aircomores_payment_validated on public.aircomores_bookings;
create trigger aircomores_payment_validated
  before update on public.aircomores_bookings
  for each row
  execute function public.aircomores_on_payment_validated();
;
