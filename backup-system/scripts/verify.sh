#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# verify.sh — Vérification d'intégrité des sauvegardes Info Experts
#
# Description : Télécharge le dernier snapshot de chaque cloud, vérifie les
#               hashes SHA-256, teste l'extraction/déchiffrement à blanc,
#               génère un rapport. Échoue bruyamment si problème.
#
# Prérequis :
#   - gpg, rclone, gh CLI, jq, sha256sum/shasum
#   Variables :
#       GPG_PASSPHRASE : pour tester le déchiffrement
#       BACKUP_REPO    : fahareddine/info-experts-backups
#       GDRIVE_FOLDER  : Backups/InfoExperts
#       B2_BUCKET      : info-experts-alkamar-backups
#
# Usage :
#   ./verify.sh [--source local|github|gdrive|b2|all] [--skip-decrypt]
#
# Codes de sortie :
#   0 : Toutes les vérifications passent
#   1 : Avertissements (vérifications partielles)
#   2 : Échec critique (corruption ou déchiffrement impossible)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── CONFIG ────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${SCRIPT_DIR}/../snapshots"
LOG_DIR="${SCRIPT_DIR}/../logs"
REPORTS_DIR="${SCRIPT_DIR}/../reports"
TIMESTAMP="$(date +%Y-%m-%d-%H%M)"
LOG_FILE="${LOG_DIR}/verify-${TIMESTAMP}.log"
REPORT_FILE="${REPORTS_DIR}/verify-${TIMESTAMP}.md"
BACKUP_REPO="${BACKUP_REPO:-fahareddine/info-experts-backups}"
GDRIVE_FOLDER="${GDRIVE_FOLDER:-Backups/InfoExperts}"
B2_BUCKET="${B2_BUCKET:-info-experts-alkamar-backups}"
WORK_DIR=""

SOURCE="all"
SKIP_DECRYPT=false

# ── ARGS ──────────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --source)       SOURCE="$2"; shift 2 ;;
    --skip-decrypt) SKIP_DECRYPT=true; shift ;;
    *) echo "Usage: $0 [--source local|github|gdrive|b2|all] [--skip-decrypt]"; exit 2 ;;
  esac
done

# ── INIT ──────────────────────────────────────────────────────────────────────
mkdir -p "${LOG_DIR}" "${REPORTS_DIR}"

CHECKS_PASSED=0
CHECKS_FAILED=0
CHECKS_WARN=0

log()        { echo "[$(date +%H:%M:%S)] $*" | tee -a "${LOG_FILE}"; }
log_ok()     { echo "[$(date +%H:%M:%S)] ✓ $*" | tee -a "${LOG_FILE}"; ((CHECKS_PASSED++)); }
log_warn()   { echo "[$(date +%H:%M:%S)] ⚠ $*" | tee -a "${LOG_FILE}"; ((CHECKS_WARN++)); }
log_fail()   { echo "[$(date +%H:%M:%S)] ✗ $*" | tee -a "${LOG_FILE}" >&2; ((CHECKS_FAILED++)); }
log_error()  { echo "[$(date +%H:%M:%S)] ERROR: $*" | tee -a "${LOG_FILE}" >&2; }

cleanup() {
  if [[ -n "${WORK_DIR}" && -d "${WORK_DIR}" ]]; then
    rm -rf "${WORK_DIR}"
  fi
}
trap cleanup EXIT

WORK_DIR="$(mktemp -d /tmp/info-experts-verify-XXXXXX)"

log "═══════════════════════════════════════════════════════════"
log "  Vérification intégrité — Info Experts"
log "  Timestamp  : ${TIMESTAMP}"
log "  Source(s)  : ${SOURCE}"
log "  Déchiffrer : $([[ "$SKIP_DECRYPT" == "true" ]] && echo 'NON' || echo 'OUI')"
log "═══════════════════════════════════════════════════════════"

# ── FONCTIONS DE VÉRIFICATION ────────────────────────────────────────────────

verify_zip() {
  local FILE="$1"
  local LABEL="$2"
  log "  Test extraction ZIP : ${LABEL}..."
  if tar -tzf "${FILE}" > /dev/null 2>&1; then
    log_ok "ZIP valide : ${LABEL}"
    return 0
  else
    log_fail "ZIP corrompu : ${LABEL}"
    return 1
  fi
}

verify_sha256() {
  local FILE="$1"
  local MANIFEST="$2"
  log "  Vérification SHA-256 : $(basename "${FILE}")..."

  if [[ ! -f "$MANIFEST" ]]; then
    log_warn "Manifeste introuvable pour $(basename "${FILE}")"
    return 0
  fi

  EXPECTED_SHA=$(jq -r '.sha256 // empty' "${MANIFEST}" 2>/dev/null || echo "")
  if [[ -z "$EXPECTED_SHA" || "$EXPECTED_SHA" == "dry-run" ]]; then
    log_warn "SHA256 absent dans le manifeste"
    return 0
  fi

  if command -v sha256sum &>/dev/null; then
    ACTUAL_SHA="$(sha256sum "${FILE}" | cut -d' ' -f1)"
  else
    ACTUAL_SHA="$(shasum -a 256 "${FILE}" | cut -d' ' -f1)"
  fi

  if [[ "$ACTUAL_SHA" == "$EXPECTED_SHA" ]]; then
    log_ok "SHA256 OK : ${ACTUAL_SHA:0:16}..."
    return 0
  else
    log_fail "SHA256 MISMATCH pour $(basename "${FILE}")"
    log_fail "  Attendu : ${EXPECTED_SHA}"
    log_fail "  Obtenu  : ${ACTUAL_SHA}"
    return 1
  fi
}

verify_gpg_decrypt() {
  local FILE="$1"
  local LABEL="$2"

  if [[ "$SKIP_DECRYPT" == "true" ]]; then
    log_warn "Déchiffrement skippé pour ${LABEL} (--skip-decrypt)"
    return 0
  fi

  if [[ -z "${GPG_PASSPHRASE:-}" ]]; then
    log_warn "GPG_PASSPHRASE non définie — déchiffrement skippé pour ${LABEL}"
    return 0
  fi

  log "  Test déchiffrement GPG : ${LABEL}..."
  DECRYPT_WORK="${WORK_DIR}/decrypt-test"
  mkdir -p "${DECRYPT_WORK}"

  if echo "${GPG_PASSPHRASE}" | gpg \
    --batch \
    --passphrase-fd 0 \
    --decrypt "${FILE}" \
    2>/dev/null | tar tz > /dev/null 2>&1; then
    log_ok "GPG déchiffrement OK : ${LABEL}"
    return 0
  else
    log_fail "GPG déchiffrement ÉCHOUÉ : ${LABEL}"
    return 1
  fi
}

verify_sql_parseable() {
  local SQL_FILE="$1"
  log "  Vérification SQL parseable..."
  if head -c 1024 "${SQL_FILE}" | grep -qE '(CREATE TABLE|INSERT INTO|--.*PostgreSQL|SET standard_conforming_strings)'; then
    log_ok "SQL semble valide (header reconnu)"
    return 0
  else
    log_warn "SQL header non reconnu — peut être un dump vide ou format inconnu"
    return 0
  fi
}

# ── VÉRIFICATION SNAPSHOTS LOCAUX ────────────────────────────────────────────
verify_local() {
  log ""
  log "┌─ Vérification snapshots locaux ───────────────────────"

  LATEST_CODE=$(ls "${BACKUP_DIR}/info-experts-code-"*.zip 2>/dev/null | sort -r | head -1 || echo "")
  LATEST_SUPA=$(ls "${BACKUP_DIR}/info-experts-supabase-"*.gpg 2>/dev/null | sort -r | head -1 || echo "")
  LATEST_SECRETS=$(ls "${BACKUP_DIR}/info-experts-secrets-"*.gpg 2>/dev/null | sort -r | head -1 || echo "")

  if [[ -z "$LATEST_CODE" && -z "$LATEST_SUPA" ]]; then
    log_warn "Aucun snapshot local trouvé dans ${BACKUP_DIR}"
    return 0
  fi

  if [[ -n "$LATEST_CODE" ]]; then
    TS=$(basename "${LATEST_CODE}" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{4}' | head -1)
    MANIFEST=$(ls "${BACKUP_DIR}/MANIFEST-${TS}.json" 2>/dev/null || echo "")
    verify_zip "${LATEST_CODE}" "$(basename "${LATEST_CODE}")"
    [[ -n "$MANIFEST" ]] && verify_sha256 "${LATEST_CODE}" "${MANIFEST}"
  fi

  if [[ -n "$LATEST_SUPA" ]]; then
    TS=$(basename "${LATEST_SUPA}" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{4}' | head -1)
    MANIFEST=$(ls "${BACKUP_DIR}/MANIFEST-supabase-${TS}.json" 2>/dev/null || echo "")
    verify_gpg_decrypt "${LATEST_SUPA}" "$(basename "${LATEST_SUPA}")"
    [[ -n "$MANIFEST" ]] && verify_sha256 "${LATEST_SUPA}" "${MANIFEST}"
  fi

  if [[ -n "$LATEST_SECRETS" ]]; then
    verify_gpg_decrypt "${LATEST_SECRETS}" "$(basename "${LATEST_SECRETS}")"
  fi

  log "└─ Vérification locale terminée"
}

# ── VÉRIFICATION GITHUB ───────────────────────────────────────────────────────
verify_github() {
  log ""
  log "┌─ Vérification GitHub Releases ───────────────────────"

  if ! command -v gh &>/dev/null; then
    log_warn "gh CLI non disponible — GitHub skippé"
    return 0
  fi

  LATEST_RELEASE=$(gh release list --repo "${BACKUP_REPO}" --limit 1 --json tagName -q '.[0].tagName' 2>/dev/null || echo "")

  if [[ -z "$LATEST_RELEASE" ]]; then
    log_warn "Aucune release GitHub trouvée dans ${BACKUP_REPO}"
    return 0
  fi

  log "  Dernière release : ${LATEST_RELEASE}"

  GH_DL="${WORK_DIR}/gh-verify"
  mkdir -p "${GH_DL}"

  gh release download "${LATEST_RELEASE}" \
    --repo "${BACKUP_REPO}" \
    --dir "${GH_DL}" \
    2>> "${LOG_FILE}" || {
    log_warn "Impossible de télécharger la release ${LATEST_RELEASE}"
    return 0
  }

  ZIP=$(ls "${GH_DL}"/*.zip 2>/dev/null | head -1 || echo "")
  MANIFEST=$(ls "${GH_DL}"/MANIFEST-*.json 2>/dev/null | head -1 || echo "")

  if [[ -n "$ZIP" ]]; then
    verify_zip "${ZIP}" "$(basename "${ZIP}")"
    [[ -n "$MANIFEST" ]] && verify_sha256 "${ZIP}" "${MANIFEST}"
  fi

  log "└─ Vérification GitHub terminée"
}

# ── VÉRIFICATION GOOGLE DRIVE ────────────────────────────────────────────────
verify_gdrive() {
  log ""
  log "┌─ Vérification Google Drive ──────────────────────────"

  if ! command -v rclone &>/dev/null; then
    log_warn "rclone non disponible — Google Drive skippé"
    return 0
  fi

  GDRIVE_DL="${WORK_DIR}/gdrive-verify"
  mkdir -p "${GDRIVE_DL}"

  LATEST_ZIP=$(rclone ls "gdrive:${GDRIVE_FOLDER}/code/" 2>/dev/null \
    | sort -k2 -r | head -1 | awk '{print $2}' || echo "")

  if [[ -z "$LATEST_ZIP" ]]; then
    log_warn "Aucun backup code sur Google Drive"
  else
    log "  Téléchargement : ${LATEST_ZIP}..."
    rclone copy "gdrive:${GDRIVE_FOLDER}/code/${LATEST_ZIP}" "${GDRIVE_DL}/" 2>> "${LOG_FILE}" || true

    LOCAL_FILE="${GDRIVE_DL}/${LATEST_ZIP}"
    if [[ -f "$LOCAL_FILE" ]]; then
      verify_zip "${LOCAL_FILE}" "${LATEST_ZIP}"
    else
      log_warn "Fichier non téléchargé depuis gdrive"
    fi
  fi

  LATEST_SUPA=$(rclone ls "gdrive:${GDRIVE_FOLDER}/supabase/" 2>/dev/null \
    | sort -k2 -r | grep "\.gpg$" | head -1 | awk '{print $2}' || echo "")

  if [[ -n "$LATEST_SUPA" ]]; then
    rclone copy "gdrive:${GDRIVE_FOLDER}/supabase/${LATEST_SUPA}" "${GDRIVE_DL}/" 2>> "${LOG_FILE}" || true
    LOCAL_SUPA="${GDRIVE_DL}/${LATEST_SUPA}"
    if [[ -f "$LOCAL_SUPA" ]]; then
      verify_gpg_decrypt "${LOCAL_SUPA}" "${LATEST_SUPA}"
    fi
  fi

  log "└─ Vérification Google Drive terminée"
}

# ── VÉRIFICATION B2 ──────────────────────────────────────────────────────────
verify_b2() {
  log ""
  log "┌─ Vérification Backblaze B2 ──────────────────────────"

  if ! command -v rclone &>/dev/null; then
    log_warn "rclone non disponible — B2 skippé"
    return 0
  fi

  B2_DL="${WORK_DIR}/b2-verify"
  mkdir -p "${B2_DL}"

  LATEST_ZIP=$(rclone ls "b2:${B2_BUCKET}/code/" 2>/dev/null \
    | sort -k2 -r | head -1 | awk '{print $2}' || echo "")

  if [[ -z "$LATEST_ZIP" ]]; then
    log_warn "Aucun backup code sur B2"
  else
    log "  Téléchargement : ${LATEST_ZIP}..."
    rclone copy "b2:${B2_BUCKET}/code/${LATEST_ZIP}" "${B2_DL}/" 2>> "${LOG_FILE}" || true
    LOCAL_FILE="${B2_DL}/${LATEST_ZIP}"
    if [[ -f "$LOCAL_FILE" ]]; then
      verify_zip "${LOCAL_FILE}" "${LATEST_ZIP}"
    fi
  fi

  LATEST_SUPA=$(rclone ls "b2:${B2_BUCKET}/supabase/" 2>/dev/null \
    | sort -k2 -r | grep "\.gpg$" | head -1 | awk '{print $2}' || echo "")

  if [[ -n "$LATEST_SUPA" ]]; then
    rclone copy "b2:${B2_BUCKET}/supabase/${LATEST_SUPA}" "${B2_DL}/" 2>> "${LOG_FILE}" || true
    LOCAL_SUPA="${B2_DL}/${LATEST_SUPA}"
    if [[ -f "$LOCAL_SUPA" ]]; then
      verify_gpg_decrypt "${LOCAL_SUPA}" "${LATEST_SUPA}"
    fi
  fi

  log "└─ Vérification B2 terminée"
}

# ── EXÉCUTION ─────────────────────────────────────────────────────────────────
case "$SOURCE" in
  local)  verify_local ;;
  github) verify_github ;;
  gdrive) verify_gdrive ;;
  b2)     verify_b2 ;;
  all)
    verify_local
    verify_github
    verify_gdrive
    verify_b2
    ;;
  *) log_error "Source invalide: ${SOURCE}"; exit 2 ;;
esac

# ── RAPPORT ──────────────────────────────────────────────────────────────────
log ""
log "→ Génération du rapport..."

TOTAL=$((CHECKS_PASSED + CHECKS_FAILED + CHECKS_WARN))
REPORT_STATUS="OK"
[[ "$CHECKS_WARN" -gt 0 ]] && REPORT_STATUS="WARN"
[[ "$CHECKS_FAILED" -gt 0 ]] && REPORT_STATUS="FAIL"

cat > "${REPORT_FILE}" <<EOF
# Rapport de vérification intégrité — Info Experts
**Date :** $(date -u +"%Y-%m-%d %H:%M UTC")
**Source(s) :** ${SOURCE}

## Résumé

| Statut | Nombre |
|--------|--------|
| ✓ Passé | ${CHECKS_PASSED} |
| ⚠ Avertissement | ${CHECKS_WARN} |
| ✗ Échoué | ${CHECKS_FAILED} |
| **Total** | **${TOTAL}** |

**STATUT GLOBAL : ${REPORT_STATUS}**

## Détails

Voir log complet : \`${LOG_FILE}\`

## Prochaine vérification recommandée

$(date -u -d "+7 days" +"%Y-%m-%d" 2>/dev/null || date -v+7d -u +"%Y-%m-%d" 2>/dev/null || echo "Dans 7 jours")
EOF

log "  Rapport : ${REPORT_FILE}"

# ── RÉSUMÉ ───────────────────────────────────────────────────────────────────
log ""
log "═══════════════════════════════════════════════════════════"
log "  RÉSULTAT : ✓${CHECKS_PASSED} ⚠${CHECKS_WARN} ✗${CHECKS_FAILED} — ${REPORT_STATUS}"
log "  Rapport  : ${REPORT_FILE}"
log "═══════════════════════════════════════════════════════════"

if [[ "$CHECKS_FAILED" -gt 0 ]]; then
  log_error "ÉCHEC : ${CHECKS_FAILED} vérification(s) critique(s) échouée(s)"
  exit 2
elif [[ "$CHECKS_WARN" -gt 0 ]]; then
  exit 1
else
  exit 0
fi
