-- Les 3 vols de la rotation partent chacun une fois par jour (Ngazidja→Ndzuwani,
-- Ndzuwani→Mwali, Mwali→Ngazidja). Jusqu'ici seul vol-1 était réservable (il est
-- seul à avoir des vidéos pour le hero), mais la réservation ne dépend pas des
-- vidéos : on active vol-2 et vol-3 pour la billetterie et on génère leurs
-- départs sur 30 jours, comme vol-1.

update public.aircomores_flight_legs
set active = true
where code in ('vol-2', 'vol-3');

insert into public.aircomores_flight_departures (leg_id, departure_date, seats_available)
select l.id, d::date, l.capacity
from public.aircomores_flight_legs l
cross join generate_series(current_date, current_date + interval '29 days', interval '1 day') as d
where l.code in ('vol-2', 'vol-3')
on conflict (leg_id, departure_date) do nothing;
;
