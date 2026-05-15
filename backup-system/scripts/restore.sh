#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# restore.sh — Restauration interactive Info Experts
#
# Description : Interface interactive pour lister et restaurer un snapshot.
#               Restaure dans un nouveau dossier (JAMAIS écraser sans confirmation).
#               Couvre : code, Supabase DB, secrets.
#
# Prérequis :
#   - gpg (déchiffrement)
#   - rclone (téléchargement cloud)
#   - gh CLI (GitHub Releases)
#   - psql (restauration DB)
#   Variables :
#       GPG_PASSPHRASE         : pour déchiffrer archives
#       SUPABASE_DB_URL        : URL DB cible pour restauration
#       BACKUP_REPO            : fahareddine/info-experts-backups
#       GDRIVE_FOLDER          : Backups/InfoExperts
#       B2_BUCKET              : info-experts-alkamar-backups
#
# Usage :
#   ./restore.sh [--list] [--from SOURCE] [--snapshot TIMESTAMP]
#
# Options :
#   --list             : Lister les snapshots disponibles sans restaurer
#   --from local|github|gdrive|b2  : Source de restauration (défaut: demande)
#   --snapshot TS      : Timestamp du snapshot à restaurer (ex: 2026-05-14-0300)
#
# Codes de sortie :
#   0 : Succès
#   1 : Annulé par l'utilisateur
#   2 : Erreur
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── CONFIG ────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BACKUP_DIR="${SCRIPT_DIR}/../snapshots"
LOG_DIR="${SCRIPT_DIR}/../logs"
RESTORE_BASE="${PROJECT_ROOT}/../"
TIMESTAMP="$(date +%Y-%m-%d-%H%M)"
LOG_FILE="${LOG_DIR}/restore-${TIMESTAMP}.log"
BACKUP_REPO="${BACKUP_REPO:-fahareddine/info-experts-backups}"
GDRIVE_FOLDER="${GDRIVE_FOLDER:-Backups/InfoExperts}"
B2_BUCKET="${B2_BUCKET:-info-experts-alkamar-backups}"
WORK_DIR=""

LIST_ONLY=false
FROM_SOURCE=""
SNAPSHOT_TS=""

# ── ARGS ──────────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --list)     LIST_ONLY=true; shift ;;
    --from)     FROM_SOURCE="$2"; shift 2 ;;
    --snapshot) SNAPSHOT_TS="$2"; shift 2 ;;
    *) echo "Usage: $0 [--list] [--from local|github|gdrive|b2] [--snapshot TS]"; exit 2 ;;
  esac
done

# ── INIT ──────────────────────────────────────────────────────────────────────
mkdir -p "${LOG_DIR}"

log()       { echo "[$(date +%H:%M:%S)] $*" | tee -a "${LOG_FILE}"; }
log_error() { echo "[$(date +%H:%M:%S)] ERROR: $*" | tee -a "${LOG_FILE}" >&2; }

cleanup() {
  if [[ -n "${WORK_DIR}" && -d "${WORK_DIR}" ]]; then
    log "Nettoyage ${WORK_DIR}..."
    rm -rf "${WORK_DIR}"
  fi
}
trap cleanup EXIT

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║      OUTIL DE RESTAURATION — Info Experts               ║"
echo "║      ⚠️  N'écrase JAMAIS le dossier existant             ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# ── FONCTION : LISTER LES SNAPSHOTS ──────────────────────────────────────────
list_local_snapshots() {
  echo "── Snapshots locaux ──"
  if ls "${BACKUP_DIR}"/MANIFEST-*.json 2>/dev/null | head -20; then
    echo ""
  else
    echo "  (aucun snapshot local trouvé)"
    echo ""
  fi
}

list_github_snapshots() {
  echo "── GitHub Releases ──"
  if command -v gh &>/dev/null; then
    gh release list --repo "${BACKUP_REPO}" --limit 20 2>/dev/null || echo "  (gh CLI non connecté ou repo inaccessible)"
  else
    echo "  (gh CLI non installé)"
  fi
  echo ""
}

list_gdrive_snapshots() {
  echo "── Google Drive ──"
  if command -v rclone &>/dev/null; then
    rclone ls "gdrive:${GDRIVE_FOLDER}/" --max-depth 2 2>/dev/null | grep "MANIFEST" | head -20 || echo "  (rclone non configuré ou inaccessible)"
  else
    echo "  (rclone non installé)"
  fi
  echo ""
}

list_b2_snapshots() {
  echo "── Backblaze B2 ──"
  if command -v rclone &>/dev/null; then
    rclone ls "b2:${B2_BUCKET}/" --max-depth 2 2>/dev/null | grep "MANIFEST" | head -20 || echo "  (B2 non configuré)"
  else
    echo "  (rclone non installé)"
  fi
  echo ""
}

# ── MODE LISTE ───────────────────────────────────────────────────────────────
if [[ "$LIST_ONLY" == "true" ]]; then
  echo "📋 Snapshots disponibles :"
  echo ""
  list_local_snapshots
  list_github_snapshots
  list_gdrive_snapshots
  list_b2_snapshots

  echo "Consultez aussi : ${BACKUP_DIR}/INDEX.md"
  exit 0
fi

# ── SÉLECTION SOURCE ─────────────────────────────────────────────────────────
if [[ -z "$FROM_SOURCE" ]]; then
  echo "Depuis quelle source restaurer ?"
  echo "  1) local  — snapshots dans backup-system/snapshots/"
  echo "  2) github — GitHub Releases (${BACKUP_REPO})"
  echo "  3) gdrive — Google Drive (${GDRIVE_FOLDER})"
  echo "  4) b2     — Backblaze B2 (${B2_BUCKET})"
  echo ""
  read -rp "Choix [1-4] : " CHOICE
  case "$CHOICE" in
    1) FROM_SOURCE="local" ;;
    2) FROM_SOURCE="github" ;;
    3) FROM_SOURCE="gdrive" ;;
    4) FROM_SOURCE="b2" ;;
    *) echo "Choix invalide — abandon"; exit 1 ;;
  esac
fi

# ── SÉLECTION SNAPSHOT ───────────────────────────────────────────────────────
if [[ -z "$SNAPSHOT_TS" ]]; then
  echo ""
  echo "Snapshots disponibles depuis ${FROM_SOURCE}:"
  echo ""

  case "$FROM_SOURCE" in
    local)  list_local_snapshots ;;
    github) list_github_snapshots ;;
    gdrive) list_gdrive_snapshots ;;
    b2)     list_b2_snapshots ;;
  esac

  read -rp "Entrer le timestamp du snapshot (ex: 2026-05-14-0300) : " SNAPSHOT_TS
fi

if [[ -z "$SNAPSHOT_TS" ]]; then
  echo "Timestamp vide — abandon"
  exit 1
fi

# ── DOSSIER DE RESTAURATION ──────────────────────────────────────────────────
RESTORE_DIR="${RESTORE_BASE}restored-${SNAPSHOT_TS}"

echo ""
echo "⚠️  CONFIRMATION DE RESTAURATION"
echo "   Snapshot   : ${SNAPSHOT_TS}"
echo "   Source     : ${FROM_SOURCE}"
echo "   Destination: ${RESTORE_DIR}"
echo ""
echo "   Ce dossier sera créé NOUVEAU (pas d'écrasement de l'existant)."
echo ""
read -rp "Confirmer la restauration ? [oui/non] : " CONFIRM

if [[ "$CONFIRM" != "oui" ]]; then
  echo "Restauration annulée."
  exit 1
fi

mkdir -p "${RESTORE_DIR}"
mkdir -p "${LOG_DIR}"
WORK_DIR="$(mktemp -d /tmp/info-experts-restore-XXXXXX)"
log "Démarrage restauration ${SNAPSHOT_TS} depuis ${FROM_SOURCE}"
log "Destination : ${RESTORE_DIR}"

# ── TÉLÉCHARGEMENT ────────────────────────────────────────────────────────────
log "→ Téléchargement des archives..."

CODE_ARCHIVE=""
SUPA_ARCHIVE=""
SECRETS_ARCHIVE=""

download_archives() {
  case "$FROM_SOURCE" in
    local)
      CODE_ARCHIVE=$(ls "${BACKUP_DIR}/info-experts-code-${SNAPSHOT_TS}*.tar.gz" 2>/dev/null | head -1 || echo "")
      SUPA_ARCHIVE=$(ls "${BACKUP_DIR}/info-experts-supabase-${SNAPSHOT_TS}*.gpg" 2>/dev/null | head -1 || echo "")
      SECRETS_ARCHIVE=$(ls "${BACKUP_DIR}/info-experts-secrets-${SNAPSHOT_TS}*.gpg" 2>/dev/null | head -1 || echo "")
      ;;
    github)
      log "  Téléchargement depuis GitHub..."
      mkdir -p "${WORK_DIR}/gh-download"
      gh release download "code-${SNAPSHOT_TS}" \
        --repo "${BACKUP_REPO}" \
        --dir "${WORK_DIR}/gh-download" 2>> "${LOG_FILE}" || true
      gh release download "supabase-${SNAPSHOT_TS}" \
        --repo "${BACKUP_REPO}" \
        --dir "${WORK_DIR}/gh-download" 2>> "${LOG_FILE}" || true
      CODE_ARCHIVE=$(ls "${WORK_DIR}/gh-download/info-experts-code-${SNAPSHOT_TS}"*.tar.gz 2>/dev/null | head -1 || echo "")
      SUPA_ARCHIVE=$(ls "${WORK_DIR}/gh-download/info-experts-supabase-${SNAPSHOT_TS}"*.gpg 2>/dev/null | head -1 || echo "")
      ;;
    gdrive)
      log "  Téléchargement depuis Google Drive..."
      mkdir -p "${WORK_DIR}/gdrive-download"
      rclone copy "gdrive:${GDRIVE_FOLDER}/code/" "${WORK_DIR}/gdrive-download/" \
        --include "*${SNAPSHOT_TS}*" 2>> "${LOG_FILE}" || true
      rclone copy "gdrive:${GDRIVE_FOLDER}/supabase/" "${WORK_DIR}/gdrive-download/" \
        --include "*${SNAPSHOT_TS}*" 2>> "${LOG_FILE}" || true
      rclone copy "gdrive:${GDRIVE_FOLDER}/secrets/" "${WORK_DIR}/gdrive-download/" \
        --include "*${SNAPSHOT_TS}*" 2>> "${LOG_FILE}" || true
      CODE_ARCHIVE=$(ls "${WORK_DIR}/gdrive-download/info-experts-code-${SNAPSHOT_TS}"*.tar.gz 2>/dev/null | head -1 || echo "")
      SUPA_ARCHIVE=$(ls "${WORK_DIR}/gdrive-download/info-experts-supabase-${SNAPSHOT_TS}"*.gpg 2>/dev/null | head -1 || echo "")
      SECRETS_ARCHIVE=$(ls "${WORK_DIR}/gdrive-download/info-experts-secrets-${SNAPSHOT_TS}"*.gpg 2>/dev/null | head -1 || echo "")
      ;;
    b2)
      log "  Téléchargement depuis Backblaze B2..."
      mkdir -p "${WORK_DIR}/b2-download"
      rclone copy "b2:${B2_BUCKET}/code/" "${WORK_DIR}/b2-download/" \
        --include "*${SNAPSHOT_TS}*" 2>> "${LOG_FILE}" || true
      rclone copy "b2:${B2_BUCKET}/supabase/" "${WORK_DIR}/b2-download/" \
        --include "*${SNAPSHOT_TS}*" 2>> "${LOG_FILE}" || true
      rclone copy "b2:${B2_BUCKET}/secrets/" "${WORK_DIR}/b2-download/" \
        --include "*${SNAPSHOT_TS}*" 2>> "${LOG_FILE}" || true
      CODE_ARCHIVE=$(ls "${WORK_DIR}/b2-download/info-experts-code-${SNAPSHOT_TS}"*.tar.gz 2>/dev/null | head -1 || echo "")
      SUPA_ARCHIVE=$(ls "${WORK_DIR}/b2-download/info-experts-supabase-${SNAPSHOT_TS}"*.gpg 2>/dev/null | head -1 || echo "")
      SECRETS_ARCHIVE=$(ls "${WORK_DIR}/b2-download/info-experts-secrets-${SNAPSHOT_TS}"*.gpg 2>/dev/null | head -1 || echo "")
      ;;
  esac
}

download_archives

# ── RESTAURATION CODE ────────────────────────────────────────────────────────
if [[ -n "$CODE_ARCHIVE" && -f "$CODE_ARCHIVE" ]]; then
  log "→ Restauration du code source..."
  CODE_RESTORE="${RESTORE_DIR}/code"
  mkdir -p "${CODE_RESTORE}"
  tar -xzf "${CODE_ARCHIVE}" -C "${CODE_RESTORE}" 2>> "${LOG_FILE}"
  log "  ✓ Code restauré dans ${CODE_RESTORE}"
else
  log "  Archive code introuvable pour ${SNAPSHOT_TS} — skippé"
fi

# ── RESTAURATION SUPABASE ─────────────────────────────────────────────────────
if [[ -n "$SUPA_ARCHIVE" && -f "$SUPA_ARCHIVE" ]]; then
  log "→ Déchiffrement et restauration Supabase..."

  SUPA_WORK="${WORK_DIR}/supa-decrypt"
  mkdir -p "${SUPA_WORK}"

  if [[ -z "${GPG_PASSPHRASE:-}" ]]; then
    read -rsp "Entrer la passphrase GPG pour déchiffrer les données Supabase : " GPG_PASSPHRASE
    echo ""
    export GPG_PASSPHRASE
  fi

  echo "${GPG_PASSPHRASE}" | gpg \
    --batch \
    --passphrase-fd 0 \
    --decrypt "${SUPA_ARCHIVE}" \
    2>> "${LOG_FILE}" | tar xz -C "${SUPA_WORK}" 2>> "${LOG_FILE}"

  log "  ✓ Archives Supabase déchiffrées"

  # Copier les fichiers utiles dans le dossier de restauration
  DB_RESTORE="${RESTORE_DIR}/supabase"
  mkdir -p "${DB_RESTORE}"
  cp -r "${SUPA_WORK}"/* "${DB_RESTORE}/" 2>/dev/null || true

  log "  ✓ Fichiers Supabase dans ${DB_RESTORE}"

  # Proposer la restauration DB
  if [[ -f "${DB_RESTORE}/full-dump.sql" ]]; then
    echo ""
    echo "Un dump SQL complet est disponible : ${DB_RESTORE}/full-dump.sql"

    if [[ -n "${SUPABASE_DB_URL:-}" ]]; then
      read -rp "Restaurer la DB maintenant (psql) ? [oui/non] : " RESTORE_DB
      if [[ "$RESTORE_DB" == "oui" ]]; then
        log "→ Restauration DB Supabase..."
        echo "⚠️  Attention : cela va écraser les données du projet Supabase cible."
        read -rp "URL DB cible (${SUPABASE_DB_URL}) — confirmer avec Entrée ou entrer une autre URL : " CUSTOM_URL
        TARGET_URL="${CUSTOM_URL:-${SUPABASE_DB_URL}}"
        psql "${TARGET_URL}" < "${DB_RESTORE}/full-dump.sql" 2>> "${LOG_FILE}"
        log "  ✓ DB restaurée"
      fi
    else
      log "  SUPABASE_DB_URL non définie — restauration DB manuelle requise"
      log "  Commande : psql \$SUPABASE_DB_URL < ${DB_RESTORE}/full-dump.sql"
    fi
  fi
else
  log "  Archive Supabase introuvable pour ${SNAPSHOT_TS} — skippé"
fi

# ── RESTAURATION SECRETS ──────────────────────────────────────────────────────
if [[ -n "$SECRETS_ARCHIVE" && -f "$SECRETS_ARCHIVE" ]]; then
  log "→ Déchiffrement secrets..."

  SECRETS_WORK="${WORK_DIR}/secrets-decrypt"
  mkdir -p "${SECRETS_WORK}"
  chmod 700 "${SECRETS_WORK}"

  if [[ -z "${GPG_PASSPHRASE:-}" ]]; then
    read -rsp "Passphrase GPG pour les secrets : " GPG_PASSPHRASE
    echo ""
  fi

  echo "${GPG_PASSPHRASE}" | gpg \
    --batch \
    --passphrase-fd 0 \
    --decrypt "${SECRETS_ARCHIVE}" \
    2>> "${LOG_FILE}" | tar xz -C "${SECRETS_WORK}" 2>> "${LOG_FILE}"

  SECRETS_RESTORE="${RESTORE_DIR}/secrets"
  mkdir -p "${SECRETS_RESTORE}"
  chmod 700 "${SECRETS_RESTORE}"
  cp -r "${SECRETS_WORK}"/* "${SECRETS_RESTORE}/" 2>/dev/null || true
  chmod -R go= "${SECRETS_RESTORE}"

  log "  ✓ Secrets dans ${SECRETS_RESTORE} (mode 600)"
  log "  Copier manuellement : cp ${SECRETS_RESTORE}/env.local ${RESTORE_DIR}/code/.env.local"
else
  log "  Archive secrets introuvable — skippé"
fi

# ── RÉSUMÉ ET PROCHAINES ÉTAPES ──────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  RESTAURATION TERMINÉE                                   ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "Dossier restauré : ${RESTORE_DIR}"
echo ""
echo "Prochaines étapes :"
echo ""
echo "  1. Vérifier le code :"
echo "     ls ${RESTORE_DIR}/code/"
echo ""
echo "  2. Copier les secrets :"
echo "     cp ${RESTORE_DIR}/secrets/env.local ${RESTORE_DIR}/code/.env.local"
echo ""
echo "  3. Si DB restaurée, vérifier les données :"
echo "     psql \$SUPABASE_DB_URL -c 'SELECT COUNT(*) FROM public.products;'"
echo ""
echo "  4. Redéployer sur Vercel :"
echo "     cd ${RESTORE_DIR}/code"
echo "     vercel --prod"
echo ""
echo "Log complet : ${LOG_FILE}"
echo ""

exit 0
