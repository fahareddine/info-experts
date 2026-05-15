#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# backup-supabase.sh — Sauvegarde complète Supabase (LE PLUS CRITIQUE)
#
# Description : Exporte la base de données PostgreSQL complète (schéma + données),
#               les tables en JSON, les policies RLS, triggers, functions,
#               et les fichiers Supabase Storage. Chiffre tout avec GPG.
#               Pousse vers GitHub Releases, Google Drive et Backblaze B2.
#
# Prérequis :
#   - pg_dump (PostgreSQL client tools)
#   - psql   (pour exports JSON + policies)
#   - gpg    (chiffrement symétrique)
#   - rclone (Google Drive + B2)
#   - gh CLI (GitHub Releases)
#   - curl   (Supabase Storage API)
#   - jq     (parsing JSON)
#   Variables d'environnement :
#       SUPABASE_DB_URL        : postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres
#       SUPABASE_URL           : https://[ref].supabase.co
#       SUPABASE_SERVICE_ROLE_KEY : clé service role (accès Storage admin)
#       GPG_PASSPHRASE         : passphrase forte pour chiffrement GPG
#       BACKUP_REPO            : fahareddine/info-experts-backups
#       GDRIVE_FOLDER          : Backups/InfoExperts
#       B2_BUCKET              : info-experts-alkamar-backups
#
# Usage :
#   ./backup-supabase.sh [--dry-run] [--no-storage] [--tag LABEL]
#
# Codes de sortie :
#   0 : Succès complet
#   1 : Échec partiel (upload)
#   2 : Échec critique (export DB échoué)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── CONFIG ────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BACKUP_DIR="${SCRIPT_DIR}/../snapshots"
LOG_DIR="${SCRIPT_DIR}/../logs"
TIMESTAMP="$(date +%Y-%m-%d-%H%M)"
DRY_RUN=false
NO_STORAGE=false
TAG_LABEL=""
BACKUP_REPO="${BACKUP_REPO:-fahareddine/info-experts-backups}"
GDRIVE_FOLDER="${GDRIVE_FOLDER:-Backups/InfoExperts}"
B2_BUCKET="${B2_BUCKET:-info-experts-alkamar-backups}"
WORK_DIR=""

# ── ARGS ──────────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)    DRY_RUN=true; shift ;;
    --no-storage) NO_STORAGE=true; shift ;;
    --tag)        TAG_LABEL="$2"; shift 2 ;;
    *) echo "Usage: $0 [--dry-run] [--no-storage] [--tag LABEL]"; exit 2 ;;
  esac
done

# ── INIT ──────────────────────────────────────────────────────────────────────
mkdir -p "${BACKUP_DIR}" "${LOG_DIR}"
LOG_FILE="${LOG_DIR}/backup-supabase-${TIMESTAMP}.log"
ARCHIVE_NAME="info-experts-supabase-${TIMESTAMP}${TAG_LABEL:+-${TAG_LABEL}}"

SUCCESS_COUNT=0
FAIL_DESTINATIONS=()

log()       { echo "[$(date +%H:%M:%S)] $*" | tee -a "${LOG_FILE}"; }
log_error() { echo "[$(date +%H:%M:%S)] ERROR: $*" | tee -a "${LOG_FILE}" >&2; }

# Nettoyage en cas d'erreur
cleanup() {
  if [[ -n "${WORK_DIR}" && -d "${WORK_DIR}" ]]; then
    log "→ Nettoyage dossier temporaire ${WORK_DIR}"
    rm -rf "${WORK_DIR}"
  fi
}
trap cleanup EXIT

log "═══════════════════════════════════════════════════════════"
log "  Backup Supabase — Info Experts"
log "  Timestamp : ${TIMESTAMP}"
log "  Dry-run   : ${DRY_RUN}"
log "  Storage   : $([[ "$NO_STORAGE" == "true" ]] && echo 'NON' || echo 'OUI')"
log "═══════════════════════════════════════════════════════════"

# ── VÉRIFICATION DES PRÉREQUIS ────────────────────────────────────────────────
check_required() {
  local cmd="$1"
  if ! command -v "$cmd" &>/dev/null; then
    log_error "Commande requise manquante: ${cmd}"
    return 1
  fi
}

MISSING=0
for cmd in gpg jq curl; do
  check_required "$cmd" || MISSING=$((MISSING + 1))
done

if [[ "$DRY_RUN" == "false" ]]; then
  for cmd in pg_dump psql; do
    check_required "$cmd" || MISSING=$((MISSING + 1))
  done
  if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
    log_error "SUPABASE_DB_URL non définie (format: postgresql://postgres:[pass]@db.[ref].supabase.co:5432/postgres)"
    MISSING=$((MISSING + 1))
  fi
  if [[ -z "${GPG_PASSPHRASE:-}" ]]; then
    log_error "GPG_PASSPHRASE non définie"
    MISSING=$((MISSING + 1))
  fi
fi

if [[ "$MISSING" -gt 0 ]]; then
  log_error "${MISSING} prérequis manquants — abandon"
  exit 2
fi

# ── STEP 1 : DOSSIER DE TRAVAIL ──────────────────────────────────────────────
WORK_DIR="$(mktemp -d /tmp/info-experts-supa-XXXXXX)"
log "→ Dossier de travail : ${WORK_DIR}"

# ── STEP 2 : DUMP SQL COMPLET ────────────────────────────────────────────────
log "→ Export pg_dump (schéma + données)..."

SQL_DUMP="${WORK_DIR}/full-dump.sql"
SCHEMA_ONLY="${WORK_DIR}/schema-only.sql"

if [[ "$DRY_RUN" == "true" ]]; then
  log "  [DRY-RUN] pg_dump (simulé)"
  echo "-- DRY RUN DUMP --" > "${SQL_DUMP}"
  echo "-- DRY RUN SCHEMA --" > "${SCHEMA_ONLY}"
else
  log "  Dump complet (schéma + données)..."
  if ! pg_dump \
    --dbname="${SUPABASE_DB_URL}" \
    --format=plain \
    --no-owner \
    --no-acl \
    --exclude-schema=extensions \
    --exclude-schema=pgsodium \
    --exclude-schema=graphql \
    --exclude-schema=graphql_public \
    --exclude-schema=pgbouncer \
    --exclude-schema=realtime \
    --exclude-schema=supabase_functions \
    --exclude-schema=vault \
    --exclude-schema=net \
    --schema=public \
    --schema=auth \
    --schema=storage \
    --file="${SQL_DUMP}" \
    2>> "${LOG_FILE}"; then
    log_error "pg_dump échoué — ABANDON (erreur critique)"
    exit 2
  fi

  log "  Dump schéma uniquement..."
  pg_dump \
    --dbname="${SUPABASE_DB_URL}" \
    --format=plain \
    --schema-only \
    --no-owner \
    --no-acl \
    --schema=public \
    --file="${SCHEMA_ONLY}" \
    2>> "${LOG_FILE}" || true

  log "  Taille dump complet : $(du -sh "${SQL_DUMP}" | cut -f1)"
fi

# ── STEP 3 : EXPORT JSON PAR TABLE ──────────────────────────────────────────
log "→ Export JSON par table..."

JSON_DIR="${WORK_DIR}/json-tables"
mkdir -p "${JSON_DIR}"

# Liste des tables publiques
TABLES=(
  "products"
  "categories"
  "orders"
  "order_items"
  "customers"
  "coupons"
  "promotions"
  "stock_movements"
  "invoices"
  "activity_logs"
  "supplier_offers"
  "pricing_settings"
  "category_pricing_rules"
)

if [[ "$DRY_RUN" == "true" ]]; then
  log "  [DRY-RUN] export JSON (simulé)"
  echo '[]' > "${JSON_DIR}/products.json"
else
  for TABLE in "${TABLES[@]}"; do
    log "  Export ${TABLE}.json..."
    if ! psql "${SUPABASE_DB_URL}" \
      -c "COPY (SELECT row_to_json(t) FROM (SELECT * FROM public.${TABLE}) t) TO STDOUT;" \
      2>> "${LOG_FILE}" \
    | jq -s '.' > "${JSON_DIR}/${TABLE}.json" 2>> "${LOG_FILE}"; then
      log "  Avertissement: table ${TABLE} non trouvée ou erreur (ignoré)"
      echo '[]' > "${JSON_DIR}/${TABLE}.json"
    fi
  done
fi

# ── STEP 4 : EXPORT POLICIES RLS / TRIGGERS / FUNCTIONS ──────────────────────
log "→ Export RLS policies, triggers, functions..."

EXTRAS_DIR="${WORK_DIR}/extras"
mkdir -p "${EXTRAS_DIR}"

if [[ "$DRY_RUN" == "false" ]]; then
  # RLS Policies
  psql "${SUPABASE_DB_URL}" -c "
    SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname;
  " --csv > "${EXTRAS_DIR}/rls_policies.csv" 2>> "${LOG_FILE}" || true

  # Fonctions custom
  psql "${SUPABASE_DB_URL}" -c "
    SELECT routine_name, routine_definition
    FROM information_schema.routines
    WHERE routine_schema = 'public'
    ORDER BY routine_name;
  " --csv > "${EXTRAS_DIR}/functions.csv" 2>> "${LOG_FILE}" || true

  # Triggers
  psql "${SUPABASE_DB_URL}" -c "
    SELECT trigger_name, event_manipulation, event_object_table,
           action_timing, action_statement
    FROM information_schema.triggers
    WHERE trigger_schema = 'public'
    ORDER BY event_object_table, trigger_name;
  " --csv > "${EXTRAS_DIR}/triggers.csv" 2>> "${LOG_FILE}" || true

  # Index
  psql "${SUPABASE_DB_URL}" -c "
    SELECT schemaname, tablename, indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
    ORDER BY tablename, indexname;
  " --csv > "${EXTRAS_DIR}/indexes.csv" 2>> "${LOG_FILE}" || true

  log "  Policies, triggers, functions exportés"
else
  echo "dry-run" > "${EXTRAS_DIR}/rls_policies.csv"
fi

# ── STEP 5 : SUPABASE STORAGE ────────────────────────────────────────────────
if [[ "$NO_STORAGE" == "false" ]]; then
  log "→ Download Supabase Storage..."

  STORAGE_DIR="${WORK_DIR}/storage"
  mkdir -p "${STORAGE_DIR}"

  if [[ "$DRY_RUN" == "false" && -n "${SUPABASE_URL:-}" && -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
    # Lister les buckets
    BUCKETS=$(curl -sf \
      "${SUPABASE_URL}/storage/v1/bucket" \
      -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
      -H "Content-Type: application/json" \
      2>> "${LOG_FILE}" || echo '[]')

    log "  Buckets trouvés : $(echo "$BUCKETS" | jq length)"

    echo "$BUCKETS" | jq -r '.[].name' | while read -r BUCKET; do
      log "  Téléchargement bucket: ${BUCKET}..."
      BUCKET_DIR="${STORAGE_DIR}/${BUCKET}"
      mkdir -p "${BUCKET_DIR}"

      # Lister les fichiers du bucket
      FILES=$(curl -sf \
        "${SUPABASE_URL}/storage/v1/object/list/${BUCKET}" \
        -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
        -H "Content-Type: application/json" \
        -d '{"limit": 1000, "offset": 0, "sortBy": {"column": "name", "order": "asc"}}' \
        2>> "${LOG_FILE}" || echo '[]')

      FILE_COUNT=$(echo "$FILES" | jq length)
      log "    ${FILE_COUNT} fichier(s) dans ${BUCKET}"

      echo "$FILES" | jq -r '.[] | select(.name != null) | .name' | while read -r FILE; do
        FILE_DIR="${BUCKET_DIR}/$(dirname "${FILE}")"
        mkdir -p "${FILE_DIR}"
        curl -sf \
          "${SUPABASE_URL}/storage/v1/object/${BUCKET}/${FILE}" \
          -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
          -o "${BUCKET_DIR}/${FILE}" \
          2>> "${LOG_FILE}" || log "    Avertissement: impossible de télécharger ${FILE}"
      done
    done
  elif [[ "$DRY_RUN" == "true" ]]; then
    log "  [DRY-RUN] Storage download (simulé)"
    echo "dry-run" > "${STORAGE_DIR}/placeholder"
  else
    log "  SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant — Storage skippé"
  fi
fi

# ── STEP 6 : INSTRUCTIONS DE RESTAURATION ────────────────────────────────────
log "→ Génération RESTORE-INSTRUCTIONS.md..."

cat > "${WORK_DIR}/RESTORE-INSTRUCTIONS.md" <<'RESTORE_EOF'
# Instructions de restauration Supabase — Info Experts

## Prérequis
- Accès à un projet Supabase (nouveau ou existant)
- PostgreSQL client tools (`psql`, `pg_restore`)
- `SUPABASE_DB_URL` du projet cible

## Étape 1 — Créer un nouveau projet Supabase
1. Aller sur https://supabase.com/dashboard
2. "New Project" → choisir une région proche (Europe)
3. Noter : Project URL, anon key, service_role key, DB password
4. Mettre à jour `.env.local` avec les nouvelles valeurs

## Étape 2 — Restaurer le schéma et les données
```bash
# Restaurer le dump complet
psql "$NEW_SUPABASE_DB_URL" < full-dump.sql

# Vérifier les tables
psql "$NEW_SUPABASE_DB_URL" -c "\dt public.*"
```

## Étape 3 — Vérifier les RLS policies
```bash
# Vérifier les policies restaurées
psql "$NEW_SUPABASE_DB_URL" -c "SELECT * FROM pg_policies WHERE schemaname='public';"
```

## Étape 4 — Restaurer le Storage
```bash
# Via supabase CLI ou l'API REST:
# Pour chaque fichier dans storage/<bucket>/:
#   curl -X POST "$SUPABASE_URL/storage/v1/object/<bucket>/<path>" \
#     -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
#     -F "file=@<local-file>"
```

## Étape 5 — Mettre à jour les variables d'environnement
Mettre à jour dans :
- `.env.local` (local)
- Vercel Dashboard → Settings → Environment Variables
- GitHub Actions → Secrets

## Étape 6 — Redéployer
```bash
vercel --prod
```
RESTORE_EOF

# ── STEP 7 : CRÉER L'ARCHIVE CHIFFRÉE ────────────────────────────────────────
log "→ Création et chiffrement de l'archive..."

ARCHIVE_PATH="${BACKUP_DIR}/${ARCHIVE_NAME}.tar.gz.gpg"
TAR_PATH="${BACKUP_DIR}/${ARCHIVE_NAME}.tar.gz"

if [[ "$DRY_RUN" == "true" ]]; then
  log "  [DRY-RUN] tar + gpg (simulé)"
  echo "dry-run" > "${ARCHIVE_PATH}"
else
  # Créer le tar.gz
  tar -czf "${TAR_PATH}" -C "${WORK_DIR}" . 2>> "${LOG_FILE}"
  log "  Archive non chiffrée : $(du -sh "${TAR_PATH}" | cut -f1)"

  # Chiffrer avec GPG
  echo "${GPG_PASSPHRASE}" | gpg \
    --batch \
    --passphrase-fd 0 \
    --symmetric \
    --cipher-algo AES256 \
    --output "${ARCHIVE_PATH}" \
    "${TAR_PATH}" \
    2>> "${LOG_FILE}"

  # Supprimer le tar non chiffré
  rm -f "${TAR_PATH}"
  log "  Archive chiffrée : $(du -sh "${ARCHIVE_PATH}" | cut -f1)"
fi

# ── MANIFESTE ────────────────────────────────────────────────────────────────
MANIFEST_PATH="${BACKUP_DIR}/MANIFEST-supabase-${TIMESTAMP}.json"

ARCHIVE_SIZE=0
ARCHIVE_SHA256="dry-run"

if [[ "$DRY_RUN" == "false" ]]; then
  ARCHIVE_SIZE="$(stat -c%s "${ARCHIVE_PATH}" 2>/dev/null || stat -f%z "${ARCHIVE_PATH}")"
  if command -v sha256sum &>/dev/null; then
    ARCHIVE_SHA256="$(sha256sum "${ARCHIVE_PATH}" | cut -d' ' -f1)"
  else
    ARCHIVE_SHA256="$(shasum -a 256 "${ARCHIVE_PATH}" | cut -d' ' -f1)"
  fi
fi

cat > "${MANIFEST_PATH}" <<EOF
{
  "type": "supabase-backup",
  "timestamp": "${TIMESTAMP}",
  "date_iso": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "archive": "${ARCHIVE_NAME}.tar.gz.gpg",
  "encrypted": true,
  "cipher": "AES256",
  "size_bytes": ${ARCHIVE_SIZE},
  "sha256": "${ARCHIVE_SHA256}",
  "includes": {
    "full_sql_dump": true,
    "schema_only": true,
    "json_per_table": true,
    "rls_policies": true,
    "triggers": true,
    "functions": true,
    "storage": ${NO_STORAGE:-false}
  },
  "label": "${TAG_LABEL:-}"
}
EOF

log "  SHA256 : ${ARCHIVE_SHA256}"

# ── STEP 8 : UPLOAD MULTI-CLOUD ──────────────────────────────────────────────
log "→ Push vers GitHub Releases (${BACKUP_REPO})..."
RELEASE_TAG="supabase-${TIMESTAMP}"

if [[ "$DRY_RUN" == "true" ]]; then
  log "  [DRY-RUN] gh release create (simulé)"
  SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
elif command -v gh &>/dev/null; then
  if gh release create "${RELEASE_TAG}" \
    "${ARCHIVE_PATH}" "${MANIFEST_PATH}" \
    --repo "${BACKUP_REPO}" \
    --title "Supabase Backup ${TIMESTAMP}${TAG_LABEL:+ — ${TAG_LABEL}}" \
    --notes "Backup Supabase chiffré AES256. Déchiffrer avec GPG_PASSPHRASE." \
    2>> "${LOG_FILE}"; then
    log "  ✓ GitHub Release OK"
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
  else
    log_error "GitHub Release échouée"
    FAIL_DESTINATIONS+=("github")
  fi
else
  log_error "gh CLI non trouvé"
  FAIL_DESTINATIONS+=("github")
fi

log "→ Push vers Google Drive..."
if [[ "$DRY_RUN" == "true" ]]; then
  log "  [DRY-RUN] rclone copy (simulé)"
  SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
elif command -v rclone &>/dev/null; then
  if rclone copy "${ARCHIVE_PATH}" "gdrive:${GDRIVE_FOLDER}/supabase/" \
      --log-file="${LOG_FILE}" --log-level INFO 2>> "${LOG_FILE}" \
  && rclone copy "${MANIFEST_PATH}" "gdrive:${GDRIVE_FOLDER}/supabase/" \
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

log "→ Push vers Backblaze B2..."
if [[ "$DRY_RUN" == "true" ]]; then
  log "  [DRY-RUN] rclone copy B2 (simulé)"
  SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
elif command -v rclone &>/dev/null; then
  if rclone copy "${ARCHIVE_PATH}" "b2:${B2_BUCKET}/supabase/" \
      --log-file="${LOG_FILE}" --log-level INFO 2>> "${LOG_FILE}" \
  && rclone copy "${MANIFEST_PATH}" "b2:${B2_BUCKET}/supabase/" \
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

# ── RÉSUMÉ ───────────────────────────────────────────────────────────────────
log "═══════════════════════════════════════════════════════════"
log "  RÉSUMÉ : ${SUCCESS_COUNT}/3 destinations OK"
if [[ ${#FAIL_DESTINATIONS[@]} -gt 0 ]]; then
  log_error "  ÉCHECS : ${FAIL_DESTINATIONS[*]}"
fi
log "  Log    : ${LOG_FILE}"
log "═══════════════════════════════════════════════════════════"

if [[ "$SUCCESS_COUNT" -eq 3 ]]; then exit 0
elif [[ "$SUCCESS_COUNT" -ge 1 ]]; then exit 1
else exit 2
fi
