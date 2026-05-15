#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# backup-code.sh — Sauvegarde du code source Info Experts (multi-cloud)
#
# Description : Crée un snapshot complet du repo, génère un manifeste SHA-256,
#               puis pousse vers GitHub Releases, Google Drive et Backblaze B2.
#
# Prérequis :
#   - git (installé)
#   - gh CLI (authentifié, repo cible créé: github.com/fahareddine/info-experts-backups)
#   - rclone (configuré avec remotes 'gdrive' et 'b2')
#   - sha256sum ou shasum (standard Linux/macOS)
#   - Variables d'environnement :
#       BACKUP_REPO      : Repo GitHub cible (ex: fahareddine/info-experts-backups)
#       GDRIVE_FOLDER    : Dossier Drive cible (ex: Backups/InfoExperts)
#       B2_BUCKET        : Bucket B2 cible (ex: info-experts-alkamar-backups)
#       GPG_PASSPHRASE   : Passphrase GPG (optionnel pour le code — utilisé pour DB)
#
# Usage :
#   ./backup-code.sh [--dry-run] [--tag LABEL]
#
# Codes de sortie :
#   0 : Succès complet (3/3 destinations)
#   1 : Échec partiel (1-2 destinations)
#   2 : Échec total ou erreur critique
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── CONFIG ────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BACKUP_DIR="${SCRIPT_DIR}/../snapshots"
LOG_DIR="${SCRIPT_DIR}/../logs"
TIMESTAMP="$(date +%Y-%m-%d-%H%M)"
DRY_RUN=false
TAG_LABEL=""
BACKUP_REPO="${BACKUP_REPO:-fahareddine/info-experts-backups}"
GDRIVE_FOLDER="${GDRIVE_FOLDER:-Backups/InfoExperts}"
B2_BUCKET="${B2_BUCKET:-info-experts-alkamar-backups}"

# ── ARGS ──────────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --tag) TAG_LABEL="$2"; shift 2 ;;
    *) echo "Usage: $0 [--dry-run] [--tag LABEL]"; exit 2 ;;
  esac
done

# ── INIT ──────────────────────────────────────────────────────────────────────
mkdir -p "${BACKUP_DIR}" "${LOG_DIR}"
LOG_FILE="${LOG_DIR}/backup-code-${TIMESTAMP}.log"
ARCHIVE_NAME="info-experts-code-${TIMESTAMP}${TAG_LABEL:+-${TAG_LABEL}}.tar.gz"
ARCHIVE_PATH="${BACKUP_DIR}/${ARCHIVE_NAME}"
MANIFEST_PATH="${BACKUP_DIR}/MANIFEST-${TIMESTAMP}.json"

SUCCESS_COUNT=0
FAIL_DESTINATIONS=()

log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "${LOG_FILE}"; }
log_error() { echo "[$(date +%H:%M:%S)] ERROR: $*" | tee -a "${LOG_FILE}" >&2; }

log "═══════════════════════════════════════════════════════════"
log "  Backup Code Source — Info Experts"
log "  Timestamp : ${TIMESTAMP}"
log "  Dry-run   : ${DRY_RUN}"
log "═══════════════════════════════════════════════════════════"

# ── STEP 1 : CRÉER L'ARCHIVE ──────────────────────────────────────────────────
log "→ Création de l'archive ${ARCHIVE_NAME}..."

cd "${PROJECT_ROOT}"

if [[ "$DRY_RUN" == "true" ]]; then
  log "  [DRY-RUN] tar -czf ${ARCHIVE_PATH} . (simulé)"
else
  tar -czf "${ARCHIVE_PATH}" \
    --exclude="./node_modules" \
    --exclude="./.next" \
    --exclude="./dist" \
    --exclude="./.vercel" \
    --exclude="*.log" \
    --exclude="./backup-system/snapshots" \
    --exclude="./backup-system/logs" \
    --exclude="./backup-system/reports" \
    --exclude="./scripts/*.png" \
    --exclude="./scripts/*.jpg" \
    --exclude="./.playwright-mcp" \
    --exclude="./.superpowers" \
    --exclude="./reports" \
    --exclude="./.lighthouseci" \
    . \
    2>> "${LOG_FILE}"
  log "  Archive créée : $(du -sh "${ARCHIVE_PATH}" | cut -f1)"
fi

# ── STEP 2 : MANIFESTE ───────────────────────────────────────────────────────
log "→ Génération du manifeste..."

GIT_COMMIT="$(git -C "${PROJECT_ROOT}" rev-parse HEAD 2>/dev/null || echo 'unknown')"
GIT_BRANCH="$(git -C "${PROJECT_ROOT}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')"
GIT_TAG="$(git -C "${PROJECT_ROOT}" describe --tags --exact-match 2>/dev/null || echo '')"

if [[ "$DRY_RUN" == "true" ]]; then
  ARCHIVE_SIZE=0
  ARCHIVE_SHA256="dry-run-no-hash"
else
  ARCHIVE_SIZE="$(stat -c%s "${ARCHIVE_PATH}" 2>/dev/null || stat -f%z "${ARCHIVE_PATH}")"
  if command -v sha256sum &>/dev/null; then
    ARCHIVE_SHA256="$(sha256sum "${ARCHIVE_PATH}" | cut -d' ' -f1)"
  else
    ARCHIVE_SHA256="$(shasum -a 256 "${ARCHIVE_PATH}" | cut -d' ' -f1)"
  fi
fi

cat > "${MANIFEST_PATH}" <<EOF
{
  "type": "code-backup",
  "timestamp": "${TIMESTAMP}",
  "date_iso": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "archive": "${ARCHIVE_NAME}",
  "size_bytes": ${ARCHIVE_SIZE},
  "sha256": "${ARCHIVE_SHA256}",
  "git": {
    "commit": "${GIT_COMMIT}",
    "branch": "${GIT_BRANCH}",
    "tag": "${GIT_TAG}"
  },
  "project": "info-experts",
  "label": "${TAG_LABEL:-}"
}
EOF

log "  Commit : ${GIT_COMMIT}"
log "  SHA256 : ${ARCHIVE_SHA256}"

# ── STEP 3 : GITHUB RELEASE ──────────────────────────────────────────────────
log "→ Push vers GitHub Releases (${BACKUP_REPO})..."

RELEASE_TAG="code-${TIMESTAMP}"
RELEASE_TITLE="Code Backup ${TIMESTAMP}${TAG_LABEL:+ — ${TAG_LABEL}}"

if [[ "$DRY_RUN" == "true" ]]; then
  log "  [DRY-RUN] gh release create ${RELEASE_TAG} (simulé)"
  SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
elif command -v gh &>/dev/null; then
  if gh release create "${RELEASE_TAG}" \
    "${ARCHIVE_PATH}" "${MANIFEST_PATH}" \
    --repo "${BACKUP_REPO}" \
    --title "${RELEASE_TITLE}" \
    --notes "Backup automatique du code source. Commit: ${GIT_COMMIT}" \
    2>> "${LOG_FILE}"; then
    log "  ✓ GitHub Release créée : ${RELEASE_TAG}"
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
  else
    log_error "GitHub Release échouée"
    FAIL_DESTINATIONS+=("github")
  fi
else
  log_error "gh CLI non trouvé — GitHub skippé"
  FAIL_DESTINATIONS+=("github")
fi

# ── STEP 4 : GOOGLE DRIVE ────────────────────────────────────────────────────
log "→ Push vers Google Drive (${GDRIVE_FOLDER})..."

GDRIVE_PATH="gdrive:${GDRIVE_FOLDER}/code/"

if [[ "$DRY_RUN" == "true" ]]; then
  log "  [DRY-RUN] rclone copy ${ARCHIVE_PATH} ${GDRIVE_PATH} (simulé)"
  SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
elif command -v rclone &>/dev/null; then
  if rclone copy "${ARCHIVE_PATH}" "${GDRIVE_PATH}" \
    --log-file="${LOG_FILE}" --log-level INFO \
    2>> "${LOG_FILE}" \
  && rclone copy "${MANIFEST_PATH}" "${GDRIVE_PATH}" \
    --log-file="${LOG_FILE}" --log-level INFO \
    2>> "${LOG_FILE}"; then
    log "  ✓ Google Drive OK"
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
  else
    log_error "Google Drive upload échoué"
    FAIL_DESTINATIONS+=("gdrive")
  fi
else
  log_error "rclone non trouvé — Google Drive skippé"
  FAIL_DESTINATIONS+=("gdrive")
fi

# ── STEP 5 : BACKBLAZE B2 ────────────────────────────────────────────────────
log "→ Push vers Backblaze B2 (${B2_BUCKET})..."

B2_PATH="b2:${B2_BUCKET}/code/"

if [[ "$DRY_RUN" == "true" ]]; then
  log "  [DRY-RUN] rclone copy ${ARCHIVE_PATH} ${B2_PATH} (simulé)"
  SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
elif command -v rclone &>/dev/null; then
  if rclone copy "${ARCHIVE_PATH}" "${B2_PATH}" \
    --log-file="${LOG_FILE}" --log-level INFO \
    2>> "${LOG_FILE}" \
  && rclone copy "${MANIFEST_PATH}" "${B2_PATH}" \
    --log-file="${LOG_FILE}" --log-level INFO \
    2>> "${LOG_FILE}"; then
    log "  ✓ Backblaze B2 OK"
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
  else
    log_error "Backblaze B2 upload échoué"
    FAIL_DESTINATIONS+=("b2")
  fi
else
  log_error "rclone non trouvé — B2 skippé"
  FAIL_DESTINATIONS+=("b2")
fi

# ── STEP 6 : NETTOYAGE LOCAL ─────────────────────────────────────────────────
if [[ "$DRY_RUN" == "false" && "$SUCCESS_COUNT" -ge 2 ]]; then
  log "→ Nettoyage des archives locales > 7 jours..."
  find "${BACKUP_DIR}" -name "info-experts-code-*.zip" -mtime +7 -delete 2>/dev/null || true
fi

# ── RÉSUMÉ ───────────────────────────────────────────────────────────────────
log "═══════════════════════════════════════════════════════════"
log "  RÉSUMÉ : ${SUCCESS_COUNT}/3 destinations OK"
if [[ ${#FAIL_DESTINATIONS[@]} -gt 0 ]]; then
  log_error "  ÉCHECS : ${FAIL_DESTINATIONS[*]}"
fi
log "  Log    : ${LOG_FILE}"
log "═══════════════════════════════════════════════════════════"

if [[ "$SUCCESS_COUNT" -eq 3 ]]; then
  exit 0
elif [[ "$SUCCESS_COUNT" -ge 1 ]]; then
  exit 1
else
  exit 2
fi
