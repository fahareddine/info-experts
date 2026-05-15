# Rapport d'Implémentation — Système de Backup Info Experts
**Date :** 14 mai 2026
**Statut :** Implémenté — en attente de configuration manuelle

---

## Ce qui est fait ✓

### Scripts (backup-system/scripts/)

| Fichier | Module | Statut |
|---------|--------|--------|
| `backup-code.sh` | Code source → 3 clouds (GitHub + Drive + B2) | ✓ Créé |
| `backup-supabase.sh` | DB SQL + JSON + RLS + Storage → GPG → 3 clouds | ✓ Créé |
| `backup-secrets.sh` | .env.local + Vercel env → GPG → 2 clouds (pas GitHub) | ✓ Créé |
| `snapshot.sh` | Orchestrateur (combine les 3 modules) | ✓ Créé |
| `restore.sh` | Restauration interactive multi-source | ✓ Créé |
| `verify.sh` | Vérification intégrité SHA-256 + déchiffrement | ✓ Créé |

### GitHub Actions (/.github/workflows/)

| Fichier | Trigger | Statut |
|---------|---------|--------|
| `backup-daily.yml` | Quotidien 03h00 UTC + manuel | ✓ Créé |
| `backup-pre-deploy.yml` | Push sur main (fichiers critiques) | ✓ Créé |
| `backup-verify-weekly.yml` | Dimanche 02h00 UTC + test mensuel | ✓ Créé |

### Documentation

| Fichier | Contenu | Statut |
|---------|---------|--------|
| `README.md` | Architecture, installation, cheat sheet | ✓ Créé |
| `DISASTER-RECOVERY.md` | 10 scénarios catastrophe (CAS A-E) | ✓ Créé |
| `config/rclone.conf.example` | Template rclone (Google Drive + B2) | ✓ Créé |
| `config/retention-policy.yml` | Politique de rétention documentée | ✓ Créé |
| `config/.gitignore` | Protection *.gpg, *.key, *.env | ✓ Créé |

### .gitignore racine (mis à jour)

Ajout des patterns de protection backup :
- `backup-system/snapshots/`
- `backup-system/logs/`
- `backup-system/reports/`

---

## Ce qu'il reste à configurer manuellement

### Priorité 1 — REQUIS pour fonctionner

#### Comptes à créer

- [ ] **Backblaze B2** (si pas déjà fait)
  - Créer compte sur backblaze.com (gratuit jusqu'à 10 GB)
  - Créer un bucket `info-experts-alkamar-backups` (private)
  - Créer une Application Key avec accès Read/Write sur ce bucket
  - Coût estimé : ~0.006$/GB/mois + 0.01$/GB téléchargé ≈ **< 1€/mois**

- [ ] **Repo GitHub privé** `fahareddine/info-experts-backups`
  - `gh repo create fahareddine/info-experts-backups --private`
  - Créer un Personal Access Token (PAT) avec scope `repo`
  - GitHub → Settings → Tokens → Generate new token (classic)

#### Clé GPG à générer

```bash
# Tester la passphrase choisie :
echo "données-sensibles-test" | \
  gpg --symmetric --cipher-algo AES256 --passphrase "VOTRE_PASSPHRASE" --batch | \
  gpg --decrypt --passphrase "VOTRE_PASSPHRASE" --batch
```

**Stocker la passphrase dans :**
- [ ] Gestionnaire de mots de passe (Bitwarden/1Password)
- [ ] Coffre-fort physique (copie papier)

#### rclone à configurer

```bash
# Google Drive
rclone config  # → n → gdrive → drive → suivre OAuth

# Backblaze B2
# Éditer ~/.config/rclone/rclone.conf directement avec account + key
```

#### Récupérer le token rclone gdrive (pour GitHub Actions)

```bash
# Après configuration rclone, extraire le token :
cat ~/.config/rclone/rclone.conf | grep -A 5 '\[gdrive\]'
# Copier la valeur complète du champ "token" (JSON)
```

### Priorité 2 — Secrets GitHub Actions

Aller dans : repo → Settings → Secrets and variables → Actions → New repository secret

| Secret | Comment l'obtenir |
|--------|-------------------|
| `SUPABASE_DB_URL` | Supabase Dashboard → Project Settings → Database → Connection string |
| `SUPABASE_URL` | Supabase Dashboard → Project Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | Supabase Dashboard → API → anon public |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → API → service_role |
| `STRIPE_SECRET_KEY` | Stripe Dashboard → Developers → API Keys |
| `STRIPE_PUBLISHABLE_KEY` | Stripe Dashboard → Developers → API Keys |
| `GPG_PASSPHRASE` | Votre passphrase GPG choisie |
| `BACKUP_GH_TOKEN` | GitHub → Settings → Tokens → nouveau token (scope: repo) |
| `RCLONE_GDRIVE_TOKEN` | Valeur JSON du champ `token` dans rclone.conf |
| `RCLONE_B2_ACCOUNT` | ID compte Backblaze B2 |
| `RCLONE_B2_KEY` | Clé application Backblaze B2 |
| `VERCEL_TOKEN` | vercel.com/account/tokens → Create Token |
| `RESEND_API_KEY` | Optionnel: resend.com → API Keys (pour notifications email) |

### Variables GitHub Actions (publiques)

Settings → Secrets and variables → Actions → Variables :

| Variable | Valeur |
|----------|--------|
| `BACKUP_REPO` | `fahareddine/info-experts-backups` |
| `GDRIVE_FOLDER` | `Backups/InfoExperts` |
| `B2_BUCKET` | `info-experts-alkamar-backups` |

### Priorité 3 — Optionnel mais recommandé

- [ ] **Resend** (resend.com) — notifications email en cas d'échec
  - Créer un compte gratuit (100 emails/jour gratuits)
  - Créer une API Key
  - Vérifier le domaine expéditeur ou utiliser le domaine Resend par défaut

- [ ] **SUPABASE_DB_URL** — à obtenir dans Supabase Dashboard
  - Project Settings → Database → Connection string → Mode: URI
  - Format : `postgresql://postgres:PASSWORD@db.REF.supabase.co:5432/postgres`
  - Le password est celui que vous avez défini à la création du projet

---

## Checklist de mise en service

### Phase 1 — Infrastructure (30 min)

- [ ] Créer repo GitHub `info-experts-alkamar-backups` (privé)
- [ ] Créer compte Backblaze B2 + bucket `info-experts-alkamar-backups`
- [ ] Créer Application Key B2 (read+write, bucket spécifique)
- [ ] Configurer rclone (Google Drive + B2) sur la machine locale

### Phase 2 — Premier test local (15 min)

```bash
# Rendre les scripts exécutables
chmod +x backup-system/scripts/*.sh

# Test dry-run (aucun upload)
export GPG_PASSPHRASE="votre-passphrase"
export BACKUP_REPO="fahareddine/info-experts-backups"
export GDRIVE_FOLDER="Backups/InfoExperts"
export B2_BUCKET="info-experts-alkamar-backups"

./backup-system/scripts/snapshot.sh "test-initial" --dry-run
```

- [ ] Dry-run code backup : `./backup-system/scripts/backup-code.sh --dry-run`
- [ ] Dry-run supabase backup : `./backup-system/scripts/backup-supabase.sh --dry-run`
- [ ] Dry-run secrets backup : `./backup-system/scripts/backup-secrets.sh --dry-run`

### Phase 3 — Premier backup réel (30 min)

```bash
# Premier snapshot complet
./backup-system/scripts/snapshot.sh "mise-en-service-initiale"
```

- [ ] Vérifier GitHub Releases créées
- [ ] Vérifier fichiers sur Google Drive
- [ ] Vérifier fichiers sur Backblaze B2
- [ ] Vérifier que les archives sont bien chiffrées (.gpg)

### Phase 4 — Vérification intégrité (15 min)

```bash
./backup-system/scripts/verify.sh
cat backup-system/reports/verify-*.md
```

- [ ] Tous les checks passent (ou au moins les critiques)

### Phase 5 — GitHub Actions (20 min)

- [ ] Ajouter tous les secrets GitHub Actions
- [ ] Ajouter les variables GitHub Actions
- [ ] Déclencher manuellement `backup-daily` → vérifier le run
- [ ] Déclencher manuellement `backup-verify-weekly` → vérifier

### Phase 6 — Test de restauration (30 min)

```bash
# Lister les snapshots disponibles
./backup-system/scripts/restore.sh --list

# Tester la restauration depuis GitHub
./backup-system/scripts/restore.sh --from github
```

- [ ] Restauration code OK (nouveau dossier créé)
- [ ] Déchiffrement Supabase OK
- [ ] Déchiffrement secrets OK

---

## Coûts estimés

| Service | Plan | Coût estimé |
|---------|------|-------------|
| GitHub (repo privé) | Gratuit (public) | 0€ |
| Google Drive | Personnel (15 GB gratuit) | 0€ |
| Backblaze B2 | 10 GB gratuit, puis 0.006$/GB | < 1€/mois |
| Resend (emails) | 100/jour gratuit | 0€ |
| **Total** | | **< 1€/mois** |

---

## Notes de sécurité importantes

1. **La passphrase GPG est votre seule protection** si les fichiers .gpg sont volés.
   Une passphrase faible = backups inutiles. Utiliser > 20 caractères aléatoires.

2. **Le repo GitHub de backups doit être PRIVÉ.** Les dumps Supabase chiffrés
   peuvent être sur GitHub, mais les secrets (env.gpg) ne doivent JAMAIS y aller.

3. **Tester la restauration tous les mois** (automatisé par backup-verify-weekly.yml).
   Une sauvegarde non testée n'est pas une sauvegarde.

4. **Rotation des clés** : si SUPABASE_SERVICE_ROLE_KEY ou STRIPE_SECRET_KEY est
   compromise, révoquer et regénérer immédiatement, puis mettre à jour tous les secrets.
