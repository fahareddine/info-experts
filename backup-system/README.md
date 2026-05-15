# Système de Sauvegarde Info Experts

```
╔══════════════════════════════════════════════════════════════════════╗
║          SYSTÈME DE BACKUP & DISASTER RECOVERY — Info Experts       ║
║          boutique.info-experts.fr                                    ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                      ║
║  [CODE SOURCE] ──────────────────────────────────────────────────►  ║
║       ↓                                                              ║
║  [DB SUPABASE + STORAGE] ──► GPG AES256 ──► CHIFFRÉ                 ║
║       ↓                             ↓                               ║
║  [SECRETS .env] ──► GPG AES256 ──► CHIFFRÉ                          ║
║       ↓             ↓              ↓                                ║
║  ┌─────────────────────────────────────────────────────────┐        ║
║  │  3 DESTINATIONS INDÉPENDANTES (redondance totale)       │        ║
║  │  ① GitHub Releases (fahareddine/info-experts-backups)  │        ║
║  │  ② Google Drive    (Backups/InfoExperts/)              │        ║
║  │  ③ Backblaze B2    (info-experts-alkamar-backups/)             │        ║
║  └─────────────────────────────────────────────────────────┘        ║
║                                                                      ║
║  AUTOMATISATION:                                                     ║
║  • Backup quotidien à 03h00 UTC (GitHub Actions)                    ║
║  • Snapshot avant chaque déploiement sur main                       ║
║  • Vérification intégrité chaque dimanche                           ║
║  • Test restauration mensuel à blanc                                 ║
╚══════════════════════════════════════════════════════════════════════╝
```

---

## Structure des fichiers

```
backup-system/
├── README.md                    ← Ce fichier
├── DISASTER-RECOVERY.md         ← Guide récupération 10 scénarios
├── scripts/
│   ├── backup-code.sh           ← Module 1: Code source → 3 clouds
│   ├── backup-supabase.sh       ← Module 2: DB + Storage → GPG + 3 clouds
│   ├── backup-secrets.sh        ← Module 3: .env + Vercel → GPG + 2 clouds
│   ├── snapshot.sh              ← Orchestrateur (combine les 3 modules)
│   ├── restore.sh               ← Restauration interactive
│   └── verify.sh                ← Vérification intégrité
├── config/
│   ├── rclone.conf.example      ← Template configuration rclone
│   ├── retention-policy.yml     ← Politique de rétention
│   └── .gitignore               ← Protège *.gpg, *.key, *.env
├── logs/                        ← Logs d'exécution (git-ignoré)
├── snapshots/                   ← Archives locales temporaires (git-ignoré)
└── reports/                     ← Rapports de vérification

.github/workflows/
├── backup-daily.yml             ← Backup quotidien + rétention
├── backup-pre-deploy.yml        ← Snapshot avant chaque push sur main
└── backup-verify-weekly.yml     ← Vérification intégrité hebdo + test mensuel
```

---

## Installation

### 1. Prérequis logiciels

```bash
# macOS
brew install gnupg rclone postgresql gh

# Ubuntu / Debian
sudo apt-get install -y gnupg postgresql-client jq curl
curl -fsSL https://rclone.org/install.sh | sudo bash
# gh CLI : https://cli.github.com/

# Windows (WSL recommandé, ou Git Bash)
# Installer WSL2 + Ubuntu, puis utiliser les commandes Ubuntu ci-dessus
```

### 2. Configurer rclone

```bash
# Copier le template de configuration
cp backup-system/config/rclone.conf.example ~/.config/rclone/rclone.conf

# Configurer Google Drive (interactif — ouvre un navigateur)
rclone config
# → n (nouveau remote)
# → nom: gdrive
# → type: drive
# → suivre l'assistant OAuth

# Configurer Backblaze B2
# Dans B2 Console → App Keys → Create Application Key
# → nom: alkamar-backup-key
# → type: Read and Write
# → bucket: info-experts-alkamar-backups
# Remplir account et key dans rclone.conf

# Tester
rclone lsd gdrive:
rclone lsd b2:info-experts-alkamar-backups
```

### 3. Créer le repo de backup GitHub

```bash
# Créer un repo PRIVÉ
gh repo create fahareddine/info-experts-backups \
  --private \
  --description "Backups automatiques Info Experts"

# Créer un Personal Access Token avec accès "Contents" (write)
# github.com/settings/tokens → Generate new token (classic)
# → Scopes: repo (pour créer des releases)
```

### 4. Générer la clé GPG

```bash
# Générer une clé symétrique (pas de paire clé publique/privée — plus simple)
# La passphrase est tout ce dont vous avez besoin pour déchiffrer

# Tester le chiffrement/déchiffrement :
echo "test" | gpg --symmetric --armor --cipher-algo AES256 --passphrase "MA_PASSPHRASE" --batch > test.gpg
gpg --decrypt --passphrase "MA_PASSPHRASE" --batch test.gpg
```

**IMPORTANT :** Stocker la passphrase GPG dans :
1. Votre gestionnaire de mots de passe (Bitwarden, 1Password)
2. Coffre-fort physique (copie papier)

### 5. Rendre les scripts exécutables

```bash
chmod +x backup-system/scripts/*.sh
```

### 6. Configurer les secrets GitHub Actions

Dans votre repo → Settings → Secrets and variables → Actions :

**Secrets (valeurs sensibles) :**

| Nom | Description |
|-----|-------------|
| `SUPABASE_DB_URL` | `postgresql://postgres:PASSWORD@db.REF.supabase.co:5432/postgres` |
| `SUPABASE_URL` | `https://REF.supabase.co` |
| `SUPABASE_ANON_KEY` | Clé anon publique Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé service role Supabase |
| `STRIPE_SECRET_KEY` | Clé secrète Stripe |
| `STRIPE_PUBLISHABLE_KEY` | Clé publique Stripe |
| `GPG_PASSPHRASE` | Passphrase GPG pour chiffrement |
| `BACKUP_GH_TOKEN` | Personal Access Token GitHub (accès repo releases) |
| `RCLONE_GDRIVE_TOKEN` | Token OAuth Google Drive (JSON complet) |
| `RCLONE_B2_ACCOUNT` | ID compte Backblaze B2 |
| `RCLONE_B2_KEY` | Clé application Backblaze B2 |
| `VERCEL_TOKEN` | Token Vercel (pour env pull) |
| `RESEND_API_KEY` | Clé API Resend (notifications email) |

**Variables (valeurs publiques) :**

| Nom | Valeur par défaut |
|-----|-------------------|
| `BACKUP_REPO` | `fahareddine/info-experts-backups` |
| `GDRIVE_FOLDER` | `Backups/InfoExperts` |
| `B2_BUCKET` | `info-experts-alkamar-backups` |

---

## Commandes courantes (cheat sheet)

```bash
# Snapshot complet (avant un changement majeur)
./backup-system/scripts/snapshot.sh "avant-migration-v2"

# Snapshot code uniquement (rapide)
./backup-system/scripts/snapshot.sh "checkpoint-design" --code-only

# Snapshot DB uniquement (données critiques)
./backup-system/scripts/snapshot.sh "avant-promo-eid" --db-only

# Backup code seul
./backup-system/scripts/backup-code.sh

# Backup Supabase seul
./backup-system/scripts/backup-supabase.sh

# Backup Supabase sans Storage (plus rapide)
./backup-system/scripts/backup-supabase.sh --no-storage

# Backup secrets
./backup-system/scripts/backup-secrets.sh

# Lister les snapshots disponibles
./backup-system/scripts/restore.sh --list

# Restaurer un snapshot
./backup-system/scripts/restore.sh

# Restaurer depuis une source spécifique
./backup-system/scripts/restore.sh --from b2 --snapshot 2026-05-14-0300

# Vérifier l'intégrité (toutes sources)
./backup-system/scripts/verify.sh

# Vérifier uniquement local
./backup-system/scripts/verify.sh --source local

# Dry-run (simuler sans uploads réels)
./backup-system/scripts/snapshot.sh "test" --dry-run
```

---

## Politique de rétention

| Type | Fréquence | Conservation | Destination |
|------|-----------|--------------|-------------|
| Quotidien | Chaque nuit 03h00 | 30 jours | GitHub + Drive + B2 |
| Hebdomadaire | Lundi | 12 semaines | GitHub + Drive + B2 |
| Mensuel | 1er du mois | 12 mois | GitHub + Drive + B2 |
| Annuel | 1er janvier | Indéfini | GitHub + Drive + B2 |
| Manuel | À la demande | 90 jours | GitHub + Drive + B2 |
| Pré-déploiement | Chaque push main | 60 jours | GitHub + Drive + B2 |
| Secrets | Quotidien | 90 jours | Drive + B2 uniquement |

---

## Tableau "Quoi faire si..."

| Situation | Action immédiate |
|-----------|-----------------|
| J'ai supprimé un fichier par erreur | `git checkout HEAD -- fichier` |
| J'ai fait un push qui casse le site | `vercel rollback` ou voir Scénario 10 |
| J'ai vidé une table par erreur | Voir Scénario 4 (CAS D1) |
| J'ai perdu .env.local | Voir Scénario 7 (CAS A ou secrets recovery) |
| Je ne sais pas quel snapshot prendre | `./backup-system/scripts/restore.sh --list` |
| Le backup automatique a échoué | Vérifier GitHub Actions → `backup-daily` |
| Je veux tester que les backups fonctionnent | `./backup-system/scripts/verify.sh` |
| Je pars en vacances 2 semaines | Rien à faire, les backups s'exécutent automatiquement |

---

## Sécurité

- **Chiffrement :** AES256 via GPG symétrique sur toutes les données clients
- **Secrets :** Jamais en clair dans Git, jamais sur GitHub pour les secrets
- **Redondance :** 3 destinations indépendantes (2 pannes tolérées simultanément)
- **Intégrité :** SHA-256 sur chaque archive, vérifié à la restauration
- **Rétention :** Nettoyage automatique des vieilles archives (30j daily, 12 mois monthly)
- **Tests :** Vérification hebdomadaire + test restauration mensuel

---

## Variables d'environnement requises

### Pour les scripts locaux (`.env.local` ou export shell)

```bash
export SUPABASE_DB_URL="postgresql://postgres:PASSWORD@db.REF.supabase.co:5432/postgres"
export SUPABASE_URL="https://REF.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="eyJ..."
export GPG_PASSPHRASE="votre-passphrase-très-forte"
export BACKUP_REPO="fahareddine/info-experts-backups"
export GDRIVE_FOLDER="Backups/InfoExperts"
export B2_BUCKET="info-experts-alkamar-backups"
```

### Pour GitHub Actions

Voir section "Installation → Secrets GitHub Actions" ci-dessus.
