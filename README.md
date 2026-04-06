# Info Experts

[![Deploy](https://github.com/fahareddine/info-experts/actions/workflows/deploy.yml/badge.svg)](https://github.com/fahareddine/info-experts/actions)

Site web de la boutique Info Experts - Votre expert informatique à Moroni, Comores.

## Backend metier

Le site utilise maintenant un backend serverless sur `Vercel` avec persistance `Supabase` pour les parcours suivants :

- commandes boutique
- rendez-vous
- paiements mobiles
- emails transactionnels

### Tables Supabase

Le schema SQL se trouve dans `supabase/schema.sql`.

Tables principales :

- `appointments`
- `orders`
- `payments`

### Variables d'environnement Vercel

Configurer au minimum :

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`
- `EMAIL_FROM`
- `EMAIL_TO`
- `ADMIN_PASSWORD`
- `ADMIN_SESSION_SECRET`
- `CRON_SECRET`

### Mise en service

1. Creer un projet Supabase.
2. Executer `supabase/schema.sql` dans le SQL Editor.
3. Ajouter les variables d'environnement dans Vercel.
4. Deployer le site sur Vercel pour activer les routes `api/`.
5. Ouvrir `/admin` pour acceder au mini back-office.

### Back-office admin

Endpoints disponibles :

- `POST /api/admin/login`
- `POST /api/admin/logout`
- `GET /api/admin/session`
- `GET /api/admin/dashboard`
- `GET /api/admin/records?entity=appointments|orders|payments`
- `GET /api/admin/detail?entity=appointments|orders|payments&reference=...`
- `GET /api/admin/export?entity=appointments|orders|payments`
- `GET /api/admin/timeline-export?entity=appointments|orders|payments&reference=...`
- `POST /api/admin/payment-action`
- `POST /api/admin/appointment-action`
- `POST /api/admin/order-action`
- `POST /api/admin/note`
- `GET /api/jobs/payment-reminders`

Fonctions disponibles dans `/admin` :

- vue de synthese des rendez-vous, commandes et paiements
- consultation des derniers enregistrements
- recherche texte et filtres avances
- page detail par rendez-vous et commande
- validation et rejet des paiements en attente
- actions rendez-vous : confirmer, annuler, marquer termine
- actions commandes : valider, annuler, marquer remise
- timeline complete des actions admin par rendez-vous et commande
- notes admin libres ajoutees a la timeline
- export CSV filtre depuis le back-office
- notifications email automatiques aussi pour les actions commande
- page detail aussi disponible pour les paiements
- KPI metier supplementaires : CA encaisse, paiements en retard, rendez-vous du jour
- filtres KPI par periode
- export CSV de la timeline admin
- relances automatiques des paiements en retard via Vercel Cron

### Cron Vercel

Le fichier `vercel.json` declenche `GET /api/jobs/payment-reminders` toutes les heures.

Protection :

- configurer `CRON_SECRET`
- Vercel enverra `Authorization: Bearer <CRON_SECRET>`

### Migrations supplémentaires

Si la base existe déjà, exécuter aussi :

- `supabase/migrations/002_appointments_completed.sql`
- `supabase/migrations/003_admin_events_and_order_statuses.sql`

## Services

- Vente de matériel informatique
- Réparation et maintenance
- Création de sites web
- Solutions réseau

## Déploiement

Les pages statiques peuvent etre publiees comme d'habitude, mais les parcours `boutique`, `booking` et `payment` ont besoin des routes `api/` et doivent etre executes sur Vercel.

## Contact

- 📍 Moroni, Comores
- 📞 +269 331 27 22
- 💬 WhatsApp: +33 6 67 49 13 45
