# Guide de Disaster Recovery — Info Experts
**Version :** 1.0 — Mai 2026
**Contact urgence :** +269 477 78 65 | defistylez@gmail.com

---

## Vue d'ensemble des scénarios

| # | Scénario | Gravité | Temps de récupération estimé |
|---|----------|---------|------------------------------|
| 1 | Dossier local supprimé | Moyen | 15 min |
| 2 | Git corrompu / force-push | Moyen | 30 min |
| 3 | Compte GitHub suspendu | Haut | 1-2h |
| 4 | Table Supabase vidée | CRITIQUE | 30 min |
| 5 | Compte Supabase perdu | CRITIQUE | 2-4h |
| 6 | Vercel down / projet supprimé | Haut | 1h |
| 7 | .env.local perdu | Haut | 30 min |
| 8 | Ransomware local | CRITIQUE | 2-4h |
| 9 | Migration SQL cassée | CRITIQUE | 30 min |
| 10 | Mauvais déploiement | Moyen | 15 min |

---

## Prérequis avant de commencer

Pour toute récupération, vous aurez besoin d'**au moins UN** de ces éléments :
- Accès Google Drive (email defistylez@gmail.com)
- Accès Backblaze B2 (compte backblaze.com)
- Accès GitHub (compte fahareddine)
- La passphrase GPG (dans votre gestionnaire de mots de passe)

---

## CAS A — Dossier local supprimé, GitHub intact

**Symptôme :** `rm -rf` accidentel, panne SSD, vol du laptop

```bash
# 1. Cloner le repo depuis GitHub
git clone https://github.com/fahareddine/info-experts.git
cd info-experts

# 2. Récupérer les secrets depuis Google Drive ou B2
#    Télécharger info-experts-secrets-TIMESTAMP.tar.gz.gpg
#    Puis déchiffrer :
echo "$GPG_PASSPHRASE" | gpg --batch --passphrase-fd 0 \
  --decrypt info-experts-secrets-TIMESTAMP.tar.gz.gpg | tar xz

# 3. Copier .env.local
cp env.local .env.local

# 4. Installer les dépendances (si nécessaire)
npm install

# 5. Vérifier que tout fonctionne
node --check api/products.js

# 6. Redéployer (optionnel si Vercel est déjà actif)
vercel --prod
```

**Temps estimé :** 10-15 minutes

---

## CAS B — GitHub aussi perdu (suspendu ou supprimé)

**Symptôme :** Compte GitHub suspendu, repo supprimé, accès refusé

```bash
# 1. Télécharger depuis Google Drive
#    Aller sur drive.google.com → Backups/InfoExperts/code/
#    Télécharger le zip le plus récent : info-experts-code-TIMESTAMP.zip

# Ou via rclone (si installé) :
rclone copy "gdrive:Backups/InfoExperts/code/" ./recovery/

# 2. Extraire
unzip info-experts-code-TIMESTAMP.zip -d info-experts-recovered/
cd info-experts-recovered/

# 3. Réinitialiser git (si nécessaire)
git init
git remote add origin https://github.com/NEW_ACCOUNT/info-experts.git
git add -A
git commit -m "feat: restauration depuis backup"
git push -u origin main

# 4. Récupérer les secrets (depuis Drive ou B2)
rclone copy "gdrive:Backups/InfoExperts/secrets/" ./secrets/
echo "$GPG_PASSPHRASE" | gpg --batch --passphrase-fd 0 \
  --decrypt secrets/info-experts-secrets-TIMESTAMP.tar.gz.gpg | tar xz
cp env.local .env.local

# 5. Lier à Vercel
vercel link
vercel env add SUPABASE_URL    # etc.
vercel --prod
```

**Temps estimé :** 30-60 minutes

---

## CAS C — GitHub + Google Drive perdus, seulement B2 disponible

**Symptôme :** Double panne (très rare), ou accès Google révoqué

```bash
# 1. Configurer rclone avec B2 (sur une nouvelle machine si nécessaire)
# Créer ~/.config/rclone/rclone.conf :
# [b2]
# type = b2
# account = VOTRE_ACCOUNT_ID
# key = VOTRE_APPLICATION_KEY

# 2. Lister les backups disponibles
rclone ls b2:info-experts-alkamar-backups/

# 3. Télécharger le code
rclone copy b2:info-experts-alkamar-backups/code/ ./recovery-b2/
unzip recovery-b2/info-experts-code-TIMESTAMP.zip -d alkamar-restored/

# 4. Télécharger les secrets
rclone copy b2:info-experts-alkamar-backups/secrets/ ./recovery-secrets/
echo "$GPG_PASSPHRASE" | gpg --batch --passphrase-fd 0 \
  --decrypt recovery-secrets/info-experts-secrets-TIMESTAMP.tar.gz.gpg | tar xz

# 5. Télécharger la DB Supabase
rclone copy b2:info-experts-alkamar-backups/supabase/ ./recovery-supabase/
echo "$GPG_PASSPHRASE" | gpg --batch --passphrase-fd 0 \
  --decrypt recovery-supabase/info-experts-supabase-TIMESTAMP.tar.gz.gpg | tar xz

# 6. Suite identique au CAS B (étapes 3-5)
```

---

## CAS D — Supabase entier perdu (table vidée, compte supprimé, compromis)

**Symptôme :** `DELETE FROM products` sans WHERE, compte Supabase piraté, projet supprimé

### Sous-cas D1 : Table(s) vidée(s), projet Supabase intact

```bash
# 1. Récupérer le dump SQL depuis n'importe quelle source
rclone copy "gdrive:Backups/InfoExperts/supabase/" ./recovery-supa/
# ou: b2:info-experts-alkamar-backups/supabase/

# 2. Déchiffrer
echo "$GPG_PASSPHRASE" | gpg --batch --passphrase-fd 0 \
  --decrypt recovery-supa/info-experts-supabase-TIMESTAMP.tar.gz.gpg | tar xz

# 3. Trouver le dump SQL
ls -la full-dump.sql  # ou json-tables/products.json

# 4a. Restaurer via SQL (recommandé)
psql "$SUPABASE_DB_URL" < full-dump.sql

# 4b. Ou restaurer uniquement la table products
psql "$SUPABASE_DB_URL" -c "TRUNCATE public.products;"
# Puis importer depuis JSON :
psql "$SUPABASE_DB_URL" -c "
  COPY public.products FROM STDIN (FORMAT csv);
"
# Ou via script Node :
node -e "
  const data = require('./json-tables/products.json');
  // importer via @supabase/supabase-js
"
```

### Sous-cas D2 : Projet Supabase entier perdu

```bash
# 1. Créer un nouveau projet Supabase
#    supabase.com/dashboard → New Project
#    Région : Europe West (Frankfurt)
#    Mot de passe DB fort (sauvegarder dans gestionnaire)

# 2. Récupérer les nouvelles clés
#    Project Settings → API → copier URL, anon key, service_role key
#    Project Settings → Database → Connection string (URI)

# 3. Déchiffrer le dump SQL (voir D1)

# 4. Restaurer
NEW_DB_URL="postgresql://postgres:PASSWORD@db.NEW_REF.supabase.co:5432/postgres"
psql "$NEW_DB_URL" < full-dump.sql

# 5. Restaurer le Storage
#    Pour chaque fichier dans storage/products/ :
for FILE in storage/products/*; do
  curl -X POST "${NEW_SUPABASE_URL}/storage/v1/object/products/$(basename $FILE)" \
    -H "Authorization: Bearer ${NEW_SERVICE_ROLE_KEY}" \
    -H "Content-Type: image/jpeg" \
    --data-binary "@${FILE}"
done

# 6. Mettre à jour .env.local
cat > .env.local <<EOF
SUPABASE_URL=https://NEW_REF.supabase.co
SUPABASE_ANON_KEY=NEW_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=NEW_SERVICE_ROLE_KEY
SUPABASE_DB_URL=${NEW_DB_URL}
STRIPE_SECRET_KEY=RÉCUPÉRER_DEPUIS_STRIPE_DASHBOARD
STRIPE_PUBLISHABLE_KEY=RÉCUPÉRER_DEPUIS_STRIPE_DASHBOARD
EOF

# 7. Mettre à jour Vercel
vercel env rm SUPABASE_URL production
vercel env add SUPABASE_URL  # entrer la nouvelle valeur
# Répéter pour chaque variable

# 8. Redéployer
vercel --prod
```

**Temps estimé :** 2-4 heures

---

## CAS E — TOUT PERDU sauf 1 snapshot zip

**Scénario ultime :** Ransomware total, perte de tous les comptes sauf 1 archive

### Étape 1 — Nouvelle machine, nouveaux comptes

```bash
# Installer les outils essentiels
# macOS : brew install gnupg rclone postgresql gh
# Ubuntu: sudo apt-get install -y gnupg rclone postgresql-client gh
```

### Étape 2 — Récupérer le code

```bash
# Déchiffrer l'archive code
echo "VOTRE_PASSPHRASE_GPG" | gpg --batch --passphrase-fd 0 \
  --decrypt info-experts-code-TIMESTAMP.zip.gpg > info-experts-code-TIMESTAMP.zip
# Ou si non chiffré :
unzip info-experts-code-TIMESTAMP.zip -d info-experts/
cd info-experts/
```

### Étape 3 — Récupérer les secrets

Si le backup secrets est disponible :
```bash
echo "VOTRE_PASSPHRASE_GPG" | gpg --batch --passphrase-fd 0 \
  --decrypt info-experts-secrets-TIMESTAMP.tar.gz.gpg | tar xz
cp env.local .env.local
```

Si le backup secrets est perdu, récupérer manuellement :
```bash
# 1. Stripe → stripe.com/dashboard → Developers → API Keys
#    Si la clé secrète est perdue : créer une nouvelle clé
#    ⚠️ Mettre à jour tous les webhooks Stripe

# 2. Supabase → créer nouveau projet (voir CAS D)

# 3. Recréer .env.local avec les nouvelles clés
```

### Étape 4 — Restaurer la DB

```bash
# Si backup Supabase disponible :
echo "VOTRE_PASSPHRASE_GPG" | gpg --batch --passphrase-fd 0 \
  --decrypt info-experts-supabase-TIMESTAMP.tar.gz.gpg | tar xz

NEW_DB_URL="postgresql://postgres:PASSWORD@db.NEW_REF.supabase.co:5432/postgres"
psql "$NEW_DB_URL" < full-dump.sql

# Si pas de backup DB : recréer depuis les migrations
cd info-experts/
# Appliquer les migrations dans l'ordre :
for MIGRATION in supabase/migrations/*.sql; do
  echo "Migration: $MIGRATION"
  psql "$NEW_DB_URL" < "$MIGRATION"
done
# Note: les données clients seront perdues si pas de dump
```

### Étape 5 — Nouveau déploiement Vercel

```bash
# Créer un nouveau compte Vercel (ou utiliser existant si récupérable)
npm install -g vercel
vercel login

# Lier le projet
vercel link --name info-experts

# Ajouter les variables d'environnement
vercel env add SUPABASE_URL
vercel env add SUPABASE_ANON_KEY
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add STRIPE_SECRET_KEY
vercel env add STRIPE_PUBLISHABLE_KEY

# Déployer
vercel --prod
```

### Étape 6 — Reconfigurer le DNS

```bash
# Si le domaine boutique.info-experts.fr est récupérable :
# 1. Récupérer accès au DNS (IONOS / registrar)
# 2. Pointer le CNAME vers le nouveau déploiement Vercel
# 3. Ou utiliser vercel --prod --yes pour obtenir une URL temporaire
```

**Temps estimé :** 4-8 heures (avec toutes les données), ou 1-2h (sans données clients)

---

## Scénario 6 — Vercel down ou projet supprimé

```bash
# Option A : Redéployer sur Vercel (projet recréé)
vercel login
vercel link --name info-experts-restored
vercel --prod

# Option B : Déployer sur Netlify (plan de secours)
npm install -g netlify-cli
netlify login
netlify deploy --prod --dir .

# Option C : Déployer sur Cloudflare Pages
npm install -g wrangler
wrangler pages deploy . --project-name=info-experts
```

---

## Scénario 9 — Migration SQL cassée en prod

```bash
# 1. Identifier le problème
psql "$SUPABASE_DB_URL" -c "SELECT * FROM pg_stat_activity WHERE state = 'idle in transaction';"

# 2. Rollback immédiat : restaurer depuis le snapshot pré-déploiement
#    Trouver le snapshot dans GitHub Releases (release tag: pre-deploy-COMMIT)
gh release download "pre-deploy-COMMIT" \
  --repo fahareddine/info-experts-backups \
  --dir ./rollback/

echo "$GPG_PASSPHRASE" | gpg --batch --passphrase-fd 0 \
  --decrypt rollback/info-experts-supabase-TIMESTAMP.tar.gz.gpg | tar xz -C ./rollback/

psql "$SUPABASE_DB_URL" < ./rollback/full-dump.sql

# 3. Rollback Vercel
vercel rollback  # ou: vercel promote PREVIOUS_DEPLOYMENT_ID
```

---

## Scénario 10 — Mauvais déploiement (rollback rapide)

```bash
# Via Vercel CLI
vercel rollback

# Via Vercel Dashboard
# Deployments → clic sur le déploiement précédent → "Promote to Production"

# Vérifier que le rollback est actif
curl -I https://boutique.info-experts.fr
```

---

## Contacts et ressources d'urgence

| Service | Dashboard | Contact support |
|---------|-----------|-----------------|
| Supabase | supabase.com/dashboard | support@supabase.io |
| Vercel | vercel.com/dashboard | vercel.com/support |
| Stripe | dashboard.stripe.com | stripe.com/contact |
| Backblaze B2 | backblaze.com/b2 | backblaze.com/contact |
| GitHub | github.com | support.github.com |
| IONOS (DNS) | ionos.fr | +33 970 808 911 |

---

## Checklist post-récupération

Après toute récupération :
- [ ] Tester l'affichage des produits sur le site
- [ ] Tester l'ajout au panier
- [ ] Tester le checkout (mode test Stripe)
- [ ] Vérifier les commandes récentes dans l'admin
- [ ] Vérifier les logs Vercel (absence d'erreurs 500)
- [ ] Changer tous les secrets si compromission suspectée
- [ ] Documenter l'incident dans un fichier `INCIDENTS.md`
- [ ] Lancer un snapshot manuel : `./backup-system/scripts/snapshot.sh "post-recovery-$(date +%Y-%m-%d)"`
