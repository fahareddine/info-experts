#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# backup-secrets.sh — Sauvegarde chiffrée des secrets Info Experts
#
# Description : Chiffre .env.local et les variables Vercel avec GPG AES256.
#               Pousse vers Google Drive + Backblaze B2 (JAMAIS vers GitHub).
#               Génère un guide de récupération des secrets.
#
# Prérequis :
#   - gpg
#   - rclone (remotes 'gdrive' et 'b2')
#   - vercel CLI (pour `vercel env pull`)
#   Variables :
#       GPG_PASSPHRASE   : passphrase forte
#       GDRIVE_FOLDER    : Backups/InfoExperts
#       B2_BUCKET        : info-experts-alkamar-backups
#       VERCEL_TOKEN     : token Vercel (pour env pull en CI)
#
# Usage :
#   ./backup-secrets.sh [--dry-run] [--skip-vercel]
#
# Codes de sortie :
#   0 : Succès (2/2 cloud destinations)
#   1 : Succès partiel (1 destination)
#   2 : Échec ou secret manquant
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── CONFIG ────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BACKUP_DIR="${SCRIPT_DIR}/../snapshots"
LOG_DIR="${SCRIPT_DIR}/../logs"
TIMESTAMP="$(date +%Y-%m-%d-%H%M)"
DRY_RUN=false
SKIP_VERCEL=false
GDRIVE_FOLDER="${GDRIVE_FOLDER:-Backups/InfoExperts}"
B2_BUCKET="${B2_BUCKET:-info-experts-alkamar-backups}"
WORK_DIR=""

# ── ARGS ──────────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)     DRY_RUN=true; shift ;;
    --skip-vercel) SKIP_VERCEL=true; shift ;;
    *) echo "Usage: $0 [--dry-run] [--skip-vercel]"; exit 2 ;;
  esac
done

# ── INIT ──────────────────────────────────────────────────────────────────────
mkdir -p "${BACKUP_DIR}" "${LOG_DIR}"
LOG_FILE="${LOG_DIR}/backup-secrets-${TIMESTAMP}.log"
SUCCESS_COUNT=0
FAIL_DESTINATIONS=()

log()       { echo "[$(date +%H:%M:%S)] $*" | tee -a "${LOG_FILE}"; }
log_error() { echo "[$(date +%H:%M:%S)] ERROR: $*" | tee -a "${LOG_FILE}" >&2; }

cleanup() {
  if [[ -n "${WORK_DIR}" && -d "${WORK_DIR}" ]]; then
    # Écraser avant de supprimer (sécurité)
    find "${WORK_DIR}" -type f -exec shred -uz {} \; 2>/dev/null || rm -rf "${WORK_DIR}"
  fi
}
trap cleanup EXIT

log "═══════════════════════════════════════════════════════════"
log "  Backup Secrets — Info Experts"
log "  Timestamp : ${TIMESTAMP}"
log "  Dry-run   : ${DRY_RUN}"
log "═══════════════════════════════════════════════════════════"

# ── VÉRIFICATION PRÉREQUIS ────────────────────────────────────────────────────
MISSING=0
for cmd in gpg; do
  if ! command -v "$cmd" &>/dev/null; then
    log_error "Manquant: ${cmd}"
    MISSING=$((MISSING + 1))
  fi
done

if [[ "$DRY_RUN" == "false" && -z "${GPG_PASSPHRASE:-}" ]]; then
  log_error "GPG_PASSPHRASE non définie"
  MISSING=$((MISSING + 1))
fi

if [[ "$MISSING" -gt 0 ]]; then
  log_error "Prérequis manquants — abandon"
  exit 2
fi

# ── STEP 1 : DOSSIER DE TRAVAIL ──────────────────────────────────────────────
WORK_DIR="$(mktemp -d /tmp/info-experts-secrets-XXXXXX)"
chmod 700 "${WORK_DIR}"
log "→ Dossier de travail (mode 700) : ${WORK_DIR}"

# ── STEP 2 : COLLECTER .env.local ────────────────────────────────────────────
log "→ Collecte .env.local..."

ENV_FILE="${PROJECT_ROOT}/.env.local"
ENV_DEST="${WORK_DIR}/env.local"

if [[ "$DRY_RUN" == "true" ]]; then
  log "  [DRY-RUN] Copie .env.local (simulé)"
  cat > "${ENV_DEST}" <<'EOF'
# DRY RUN — fichier fictif
SUPABASE_URL=https://example.supabase.co
SUPABASE_ANON_KEY=dry-run-anon-key
SUPABASE_SERVICE_ROLE_KEY=dry-run-service-key
STRIPE_SECRET_KEY=sk_test_dry-run
STRIPE_PUBLISHABLE_KEY=pk_test_dry-run
EOF
elif [[ -f "${ENV_FILE}" ]]; then
  cp "${ENV_FILE}" "${ENV_DEST}"
  chmod 600 "${ENV_DEST}"
  log "  .env.local copié"
  # Inventaire des clés (sans les valeurs)
  log "  Clés présentes :"
  grep -E '^[A-Z_]+=' "${ENV_DEST}" | cut -d= -f1 | while read -r KEY; do
    log "    - ${KEY}"
  done
else
  log_error ".env.local introuvable à ${ENV_FILE}"
  exit 2
fi

# ── STEP 3 : COLLECTER ENV VERCEL ────────────────────────────────────────────
if [[ "$SKIP_VERCEL" == "false" ]]; then
  log "→ Export variables Vercel..."

  VERCEL_ENV_FILE="${WORK_DIR}/vercel.env"

  if [[ "$DRY_RUN" == "true" ]]; then
    log "  [DRY-RUN] vercel env pull (simulé)"
    echo "# DRY RUN" > "${VERCEL_ENV_FILE}"
  elif command -v vercel &>/dev/null; then
    cd "${PROJECT_ROOT}"
    if vercel env pull "${VERCEL_ENV_FILE}" \
      ${VERCEL_TOKEN:+--token "${VERCEL_TOKEN}"} \
      --yes \
      2>> "${LOG_FILE}"; then
      chmod 600 "${VERCEL_ENV_FILE}"
      log "  Variables Vercel exportées"
    else
      log "  Avertissement: vercel env pull échoué (ignoré)"
      echo "# Vercel env pull échoué" > "${VERCEL_ENV_FILE}"
    fi
  else
    log "  vercel CLI non trouvé — Vercel env skippé"
    echo "# vercel CLI non disponible" > "${VERCEL_ENV_FILE}"
  fi
fi

# ── STEP 4 : GUIDE DE RÉCUPÉRATION ──────────────────────────────────────────
log "→ Génération SECRETS-RECOVERY.md..."

cat > "${WORK_DIR}/SECRETS-RECOVERY.md" <<'RECOVERY_EOF'
# Guide de récupération des secrets — Info Experts
# ⚠️ DOCUMENT CONFIDENTIEL — ne pas partager

## Structure des secrets sauvegardés

| Fichier         | Contenu                          | Chiffrement |
|-----------------|----------------------------------|-------------|
| env.local       | .env.local complet               | GPG AES256  |
| vercel.env      | Variables Vercel (toutes envs)   | GPG AES256  |

## Déchiffrement

```bash
# Déchiffrer env.local
gpg --decrypt env.local.gpg > env_restored.local
# Entrer la passphrase GPG quand demandé

# Déchiffrer le bundle complet
echo "$GPG_PASSPHRASE" | gpg --batch --passphrase-fd 0 \
  --decrypt info-experts-secrets-TIMESTAMP.tar.gz.gpg | tar xz
```

## Clés à récupérer et où les retrouver

### Supabase
- SUPABASE_URL → Dashboard Supabase → Project Settings → API → Project URL
- SUPABASE_ANON_KEY → Dashboard → Project Settings → API → anon public
- SUPABASE_SERVICE_ROLE_KEY → Dashboard → Project Settings → API → service_role
- SUPABASE_DB_URL → Dashboard → Project Settings → Database → Connection string (URI)

### Stripe
- STRIPE_PUBLISHABLE_KEY → Stripe Dashboard → Developers → API Keys → Publishable key
- STRIPE_SECRET_KEY → Stripe Dashboard → Developers → API Keys → Secret key
  (⚠️ visible une seule fois — si perdu, créer une nouvelle clé)

### Vercel
- VERCEL_TOKEN → vercel.com/account/tokens → Create Token

## Procédure si tout est perdu

1. Récupérer archive chiffrée depuis Google Drive ou B2
2. Déchiffrer avec passphrase GPG (stockée dans gestionnaire de mots de passe)
3. Lire env_restored.local
4. Si clé Stripe perdue : créer nouvelle clé dans Stripe Dashboard
5. Si projet Supabase perdu : créer nouveau projet, restaurer dump SQL
6. Mettre à jour .env.local et Vercel Dashboard

## Localisation des archives chiffrées

- Google Drive : Backups/InfoExperts/secrets/
- Backblaze B2 : info-experts-alkamar-backups/secrets/
- JAMAIS sur GitHub ou Vercel

## Passphrase GPG

La passphrase GPG doit être stockée dans :
1. Gestionnaire de mots de passe (Bitwarden, 1Password)
2. Coffre-fort physique (copie papier)
3. Chiffrement personnel (Vault, etc.)

NE PAS la stocker dans GitHub Actions en clair — utiliser les Secrets GitHub.
RECOVERY_EOF

# ── STEP 5 : CHIFFREMENT ─────────────────────────────────────────────────────
log "→ Chiffrement de l'archive..."

ARCHIVE_NAME="info-experts-secrets-${TIMESTAMP}"
TAR_PATH="${BACKUP_DIR}/${ARCHIVE_NAME}.tar.gz"
GPG_PATH="${BACKUP_DIR}/${ARCHIVE_NAME}.tar.gz.gpg"

if [[ "$DRY_RUN" == "true" ]]; then
  log "  [DRY-RUN] tar + gpg (simulé)"
  echo "dry-run-secrets" > "${GPG_PATH}"
else
  tar -czf "${TAR_PATH}" -C "${WORK_DIR}" . 2>> "${LOG_FILE}"

  echo "${GPG_PASSPHRASE}" | gpg \
    --batch \
    --passphrase-fd 0 \
    --symmetric \
    --cipher-algo AES256 \
    --output "${GPG_PATH}" \
    "${TAR_PATH}" \
    2>> "${LOG_FILE}"

  rm -f "${TAR_PATH}"
  log "  Archive chiffrée : $(du -sh "${GPG_PATH}" | cut -f1)"
fi

# ── STEP 6 : MANIFESTE ───────────────────────────────────────────────────────
MANIFEST_PATH="${BACKUP_DIR}/MANIFEST-secrets-${TIMESTAMP}.json"

ARCHIVE_SIZE=0
ARCHIVE_SHA256="dry-run"

if [[ "$DRY_RUN" == "false" ]]; then
  ARCHIVE_SIZE="$(stat -c%s "${GPG_PATH}" 2>/dev/null || stat -f%z "${GPG_PATH}")"
  if command -v sha256sum &>/dev/null; then
    ARCHIVE_SHA256="$(sha256sum "${GPG_PATH}" | cut -d' ' -f1)"
  else
    ARCHIVE_SHA256="$(shasum -a 256 "${GPG_PATH}" | cut -d' ' -f1)"
  fi
fi

cat > "${MANIFEST_PATH}" <<EOF
{
  "type": "secrets-backup",
  "timestamp": "${TIMESTAMP}",
  "date_iso": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "archive": "${ARCHIVE_NAME}.tar.gz.gpg",
  "encrypted": true,
  "cipher": "AES256",
  "size_bytes": ${ARCHIVE_SIZE},
  "sha256": "${ARCHIVE_SHA256}",
  "includes": {
    "env_local": true,
    "vercel_env": ${SKIP_VERCEL:-true}
  }
}
EOF

# ── STEP 7 : UPLOAD (Google Drive + B2 UNIQUEMENT — pas GitHub) ──────────────
# ⚠️ Les secrets ne vont JAMAIS sur GitHub
log "→ Push vers Google Drive (secrets — pas GitHub)..."

if [[ "$DRY_RUN" == "true" ]]; then
  log "  [DRY-RUN] rclone copy gdrive (simulé)"
  SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
elif command -v rclone &>/dev/null; then
  if rclone copy "${GPG_PATH}" "gdrive:${GDRIVE_FOLDER}/secrets/" \
      --log-file="${LOG_FILE}" --log-level INFO 2>> "${LOG_FILE}" \
  && rclone copy "${MANIFEST_PATH}" "gdrive:${GDRIVE_FOLDER}/secrets/" \
      --log-file="${LOG_FILE}" --log-level INFO 2>> "${LOG_FILE}"; then
    log "  ✓ Google Drive OK"
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
  else
    log_error "Google Drive upload échoué"
    FAIL_DESTINATIONS+=("gdrive")
  fi
else
  log_error "rclone non trouvé"
  FAIL_DESTINATIONS+=("gdrive")
fi

log "→ Push vers Backblaze B2 (secrets)..."
if [[ "$DRY_RUN" == "true" ]]; then
  log "  [DRY-RUN] rclone copy B2 (simulé)"
  SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
elif command -v rclone &>/dev/null; then
  if rclone copy "${GPG_PATH}" "b2:${B2_BUCKET}/secrets/" \
      --log-file="${LOG_FILE}" --log-level INFO 2>> "${LOG_FILE}" \
  && rclone copy "${MANIFEST_PATH}" "b2:${B2_BUCKET}/secrets/" \
      --log-file="${LOG_FILE}" --log-level INFO 2>> "${LOG_FILE}"; then
    log "  ✓ Backblaze B2 OK"
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
  else
    log_error "Backblaze B2 upload échoué"
    FAIL_DESTINATIONS+=("b2")
  fi
else
  log_error "rclone non trouvé"
  FAIL_DESTINATIONS+=("b2")
fi

log "═══════════════════════════════════════════════════════════"
log "  RÉSUMÉ : ${SUCCESS_COUNT}/2 destinations OK (pas GitHub pour secrets)"
if [[ ${#FAIL_DESTINATIONS[@]} -gt 0 ]]; then
  log_error "  ÉCHECS : ${FAIL_DESTINATIONS[*]}"
fi
log "═══════════════════════════════════════════════════════════"

if [[ "$SUCCESS_COUNT" -eq 2 ]]; then exit 0
elif [[ "$SUCCESS_COUNT" -eq 1 ]]; then exit 1
else exit 2
fi
