-- Rotation du secret partagé Air Comores (trigger -> edge function send-paid-ticket).
-- L'ancien secret était codé en dur dans la fonction (et exposé dans l'historique
-- git public) : il est révoqué. Le trigger lit désormais la valeur depuis
-- Supabase Vault (secret « aircomores_ticket_secret », créé hors migration),
-- et l'edge function la lit depuis la variable d'environnement AIRCOMORES_TICKET_SECRET.

create or replace function public.aircomores_on_payment_validated()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  shared_secret text;
begin
  if new.payment_status = 'paid' and old.payment_status = 'pending' then
    new.paid_at := now();

    select decrypted_secret into shared_secret
      from vault.decrypted_secrets
     where name = 'aircomores_ticket_secret';

    if shared_secret is null then
      raise warning 'aircomores_ticket_secret absent du Vault — email billet non envoyé';
      return new;
    end if;

    perform net.http_post(
      url := 'https://hochavewlwbmfhxsigzn.supabase.co/functions/v1/send-paid-ticket',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-aircomores-secret', shared_secret
      ),
      body := jsonb_build_object('bookingId', new.id)
    );
  end if;
  return new;
end;
$$;
