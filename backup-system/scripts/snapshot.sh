#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# snapshot.sh — Point de restauration complet Info Experts
#
# Description : Orchestrateur qui combine backup-code + backup-supabase +
#               backup-secrets en une seule commande horodatée.
#               Met à jour l'index des snapshots.
#
# Prérequis : Tous les prérequis de backup-code.sh + backup-supabase.sh +
#             backup-secrets.sh (voir chacun pour détails)
#
# Usage :
#   ./snapshot.sh "raison-du-snapshot" [--dry-run] [--code-only] [--db-only]
#
# Exemples :
#   ./snapshot.sh "avant-migration-v2"
#   ./snapshot.sh "pre-deploy-stripe-update"
#   ./snapshot.sh "backup-mensuel-mai-2026" --dry-run
#
# Codes de sortie :
#   0 : Succès complet (tous modules OK)
#   1 : Succès partiel (au moins 1 module OK, avec avertissements)
#   2 : Échec critique (module DB échoué)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── CONFIG ────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${SCRIPT_DIR}/../snapshots"
LOG_DIR="${SCRIPT_DIR}/../logs"
TIMESTAMP="$(date +%Y-%m-%d-%H%M)"
INDEX_FILE="${SCRIPT_DIR}/../snapshots/INDEX.md"

DRY_RUN=false
CODE_ONLY=false
DB_ONLY=false
REASON="${1:-manual}"

# ── ARGS ──────────────────────────────────────────────────────────────────────
shift || true  # consommer l'arg REASON

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)   DRY_RUN=true; shift ;;
    --code-only) CODE_ONLY=true; shift ;;
    --db-only)   DB_ONLY=true; shift ;;
    *) echo "Usage: $0 RAISON [--dry-run] [--code-only] [--db-only]"; exit 2 ;;
  esac
done

# Normaliser la raison (pas d'espaces dans les noms de fichiers)
REASON_SLUG="$(echo "${REASON}" | tr ' ' '-' | tr -cd '[:alnum:]-')"
SNAPSHOT_NAME="${TIMESTAMP}-${REASON_SLUG}"

# ── INIT ──────────────────────────────────────────────────────────────────────
mkdir -p "${BACKUP_DIR}" "${LOG_DIR}"
LOG_FILE="${LOG_DIR}/snapshot-${TIMESTAMP}.log"

CODE_STATUS="SKIPPED"
DB_STATUS="SKIPPED"
SECRETS_STATUS="SKIPPED"
OVERALL_STATUS="OK"

log()       { echo "[$(date +%H:%M:%S)] $*" | tee -a "${LOG_FILE}"; }
log_error() { echo "[$(date +%H:%M:%S)] ERROR: $*" | tee -a "${LOG_FILE}" >&2; }

log "═══════════════════════════════════════════════════════════"
log "  SNAPSHOT — Info Experts"
log "  Nom     : ${SNAPSHOT_NAME}"
log "  Raison  : ${REASON}"
log "  Dry-run : ${DRY_RUN}"
log "═══════════════════════════════════════════════════════════"

# ── EXTRA ARGS COMMUNS ────────────────────────────────────────────────────────
EXTRA_ARGS="--tag ${REASON_SLUG}"
if [[ "$DRY_RUN" == "true" ]]; then
  EXTRA_ARGS="${EXTRA_ARGS} --dry-run"
fi

# ── MODULE 1 : CODE ──────────────────────────────────────────────────────────
if [[ "$DB_ONLY" == "false" ]]; then
  log ""
  log "┌─ MODULE 1/3 : Backup code source ─────────────────────"
  if "${SCRIPT_DIR}/backup-code.sh" ${EXTRA_ARGS} >> "${LOG_FILE}" 2>&1; then
    CODE_STATUS="OK"
    log "└─ ✓ Code backup OK"
  else
    CODE_STATUS="WARN (exit $?)"
    log "└─ ⚠ Code backup partiel (voir log)"
    OVERALL_STATUS="PARTIAL"
  fi
fi

# ── MODULE 2 : SUPABASE (CRITIQUE) ──────────────────────────────────────────
if [[ "$CODE_ONLY" == "false" ]]; then
  log ""
  log "┌─ MODULE 2/3 : Backup Supabase (DB + Storage) ─────────"
  if "${SCRIPT_DIR}/backup-supabase.sh" ${EXTRA_ARGS} >> "${LOG_FILE}" 2>&1; then
    DB_STATUS="OK"
    log "└─ ✓ Supabase backup OK"
  else
    EXIT_CODE=$?
    if [[ "$EXIT_CODE" -eq 2 ]]; then
      DB_STATUS="CRITICAL FAIL"
      log_error "└─ ✗ Supabase backup CRITIQUE ÉCHOUÉ"
      OVERALL_STATUS="CRITICAL"
    else
      DB_STATUS="WARN (partiel)"
      log "└─ ⚠ Supabase backup partiel"
      OVERALL_STATUS="PARTIAL"
    fi
  fi
fi

# ── MODULE 3 : SECRETS ──────────────────────────────────────────────────────
if [[ "$CODE_ONLY" == "false" && "$DB_ONLY" == "false" ]]; then
  log ""
  log "┌─ MODULE 3/3 : Backup secrets ─────────────────────────"
  if "${SCRIPT_DIR}/backup-secrets.sh" \
      ${DRY_RUN:+--dry-run} >> "${LOG_FILE}" 2>&1; then
    SECRETS_STATUS="OK"
    log "└─ ✓ Secrets backup OK"
  else
    SECRETS_STATUS="WARN (partiel)"
    log "└─ ⚠ Secrets backup partiel"
    if [[ "$OVERALL_STATUS" == "OK" ]]; then
      OVERALL_STATUS="PARTIAL"
    fi
  fi
fi

# ── MISE À JOUR INDEX ────────────────────────────────────────────────────────
log ""
log "→ Mise à jour de l'index snapshots..."

# Créer l'index s'il n'existe pas
if [[ ! -f "${INDEX_FILE}" ]]; then
  cat > "${INDEX_FILE}" <<'EOF'
# Index des snapshots — Info Experts

| Date/Heure | Raison | Code | DB | Secrets | Statut |
|------------|--------|------|----|---------|--------|
EOF
fi

# Déterminer les URLs cloud (approximatif — à vérifier dans les logs)
GITHUB_URL="https://github.com/${BACKUP_REPO:-fahareddine/info-experts-backups}/releases/tag/code-${TIMESTAMP}"
GDRIVE_URL="gdrive:${GDRIVE_FOLDER:-Backups/InfoExperts}/"
B2_URL="b2:${B2_BUCKET:-info-experts-alkamar-backups}/"

# Ajouter ligne à l'index
echo "| ${TIMESTAMP} | ${REASON} | ${CODE_STATUS} | ${DB_STATUS} | ${SECRETS_STATUS} | **${OVERALL_STATUS}** |" >> "${INDEX_FILE}"

log "  Index mis à jour : ${INDEX_FILE}"

# ── RAPPORT FINAL ────────────────────────────────────────────────────────────
log ""
log "═══════════════════════════════════════════════════════════"
log "  RÉSUMÉ SNAPSHOT ${SNAPSHOT_NAME}"
log "  Code    : ${CODE_STATUS}"
log "  DB      : ${DB_STATUS}"
log "  Secrets : ${SECRETS_STATUS}"
log "  STATUT  : ${OVERALL_STATUS}"
log "  Log     : ${LOG_FILE}"
log "═══════════════════════════════════════════════════════════"

# Code de sortie selon statut global
case "${OVERALL_STATUS}" in
  "OK")       exit 0 ;;
  "PARTIAL")  exit 1 ;;
  "CRITICAL") exit 2 ;;
  *)          exit 1 ;;
esac
