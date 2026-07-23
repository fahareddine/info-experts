-- Complète la rotation triangulaire (Ngazidja→Ndzuwani→Mwali→Ngazidja) par les
-- 3 liaisons inverses, pour permettre n'importe quel départ vers n'importe
-- quelle arrivée entre les 3 îles. Horaires/prix par défaut (à ajuster ici
-- même, dans le dashboard Supabase, sans toucher au code) :
--   Ndzuwani → Ngazidja : 09h00 — 45 000 KMF
--   Mwali → Ndzuwani    : 14h30 — 40 000 KMF
--   Ngazidja → Mwali    : 19h00 — 45 000 KMF

insert into public.aircomores_flight_legs
  (code, route_from, route_to, departure_place, departure_code, departure_time,
   arrival_place, arrival_code, duration_minutes, price_kmf, capacity, active)
values
  ('vol-4', 'Ndzuwani', 'Ngazidja', 'Ouani — Anjouan', 'AJN', '09h00',
   'Moroni — Hahaya', 'HAH', 30, 45000, 8, true),
  ('vol-5', 'Mwali', 'Ndzuwani', 'Bandar Es Eslam', 'NWA', '14h30',
   'Ouani — Anjouan', 'AJN', 25, 40000, 8, true),
  ('vol-6', 'Ngazidja', 'Mwali', 'Moroni — Hahaya', 'HAH', '19h00',
   'Bandar Es Eslam', 'NWA', 35, 45000, 8, true);

insert into public.aircomores_flight_departures (leg_id, departure_date, seats_available)
select l.id, d::date, l.capacity
from public.aircomores_flight_legs l
cross join generate_series(current_date, current_date + interval '29 days', interval '1 day') as d
where l.code in ('vol-4', 'vol-5', 'vol-6')
on conflict (leg_id, departure_date) do nothing;
;
