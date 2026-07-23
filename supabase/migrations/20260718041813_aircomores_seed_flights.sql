-- Seed des 3 vols (source de vérité = src/data/vols.ts côté front, répliquée ici).
insert into public.aircomores_flight_legs
  (code, route_from, route_to, departure_place, departure_code, departure_time,
   arrival_place, arrival_code, duration_minutes, price_kmf, capacity, active)
values
  ('vol-1', 'Ngazidja', 'Ndzuwani', 'Moroni — Hahaya', 'HAH', '06h30',
   'Ouani — Anjouan', 'AJN', 30, 45000, 8, true),
  ('vol-2', 'Ndzuwani', 'Mwali', 'Ouani', 'AJN', '12h15',
   'Bandar Es Eslam', 'NWA', 25, 40000, 8, false),
  ('vol-3', 'Mwali', 'Ngazidja', 'Bandar Es Eslam', 'NWA', '17h45',
   'Moroni — Hahaya', 'HAH', 35, 45000, 8, false);

-- Départs réservables pour les 30 prochains jours, uniquement pour le vol actif (vol-1).
insert into public.aircomores_flight_departures (leg_id, departure_date, seats_available)
select
  (select id from public.aircomores_flight_legs where code = 'vol-1'),
  d::date,
  (select capacity from public.aircomores_flight_legs where code = 'vol-1')
from generate_series(current_date, current_date + interval '29 days', interval '1 day') as d;
;
