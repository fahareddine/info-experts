#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# setup.sh — Configuration initiale du système de backup Info Experts
#
# Description : Guide interactif pour configurer tout ce qui ne peut pas
#               être automatisé : gh auth, repo backup, GPG, secrets GitHub.
#
# Usage : ./backup-system/scripts/setup.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BACKUP_REPO="${BACKUP_REPO:-fahareddine/info-experts-backups}"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $*"; }
fail() { echo -e "${RED}✗${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC} $*"; }
step() { echo -e "\n${YELLOW}━━━ $* ━━━${NC}"; }

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║     SETUP — Système de Backup Info Experts              ║"
echo "╚══════════════════════════════════════════════════════════╝"

# ── CHECK 1 : OUTILS ─────────────────────────────────────────────────────────
step "1/6 Vérification des outils"

for tool in gh rclone gpg jq tar; do
  if command -v "$tool" &>/dev/null; then
    ok "$tool $(${tool} --version 2>&1 | head -1 | grep -oP '\d+\.\d+[\.\d]*' | head -1)"
  else
    fail "$tool manquant"
  fi
done

# ── CHECK 2 : RCLONE REMOTES ──────────────────────────────────────────────────
step "2/6 Vérification rclone"

REMOTES=$(rclone listremotes 2>/dev/null || echo "")
if echo "$REMOTES" | grep -q "gdrive:"; then
  ok "Google Drive configuré"
  rclone lsd gdrive:Backups 2>/dev/null && ok "Dossier Backups accessible" || warn "Dossier Backups non trouvé (sera créé au 1er backup)"
else
  fail "Google Drive non configuré — lancer: rclone config"
fi

if echo "$REMOTES" | grep -q "b2:"; then
  ok "Backblaze B2 configuré"
  rclone lsd b2:info-experts-alkamar-backups 2>/dev/null && ok "Bucket B2 accessible" || warn "Bucket B2 non accessible"
else
  fail "Backblaze B2 non configuré — lancer: rclone config"
fi

# ── CHECK 3 : GITHUB AUTH ─────────────────────────────────────────────────────
step "3/6 GitHub CLI"

if gh auth status &>/dev/null; then
  ok "gh authentifié : $(gh auth status 2>&1 | grep 'Logged in' | head -1)"

  # Vérifier/créer repo backup
  if gh repo view "${BACKUP_REPO}" &>/dev/null; then
    ok "Repo backup existe : ${BACKUP_REPO}"
  else
    warn "Repo backup introuvable : ${BACKUP_REPO}"
    read -rp "Créer maintenant ? [oui/non] : " CREATE_REPO
    if [[ "$CREATE_REPO" == "oui" ]]; then
      gh repo create "${BACKUP_REPO}" --private \
        --description "Backups automatiques Info Experts"
      ok "Repo créé : ${BACKUP_REPO}"
    fi
  fi
else
  fail "gh non authentifié"
  echo ""
  echo "  Lance cette commande dans ton terminal :"
  echo "  → gh auth login"
  echo "    (GitHub.com → HTTPS → Login with web browser)"
fi

# ── CHECK 4 : GPG PASSPHRASE ──────────────────────────────────────────────────
step "4/6 GPG / chiffrement"

if [[ -n "${GPG_PASSPHRASE:-}" ]]; then
  ok "GPG_PASSPHRASE définie (longueur: ${#GPG_PASSPHRASE} chars)"
  # Test chiffrement/déchiffrement
  TEST_FILE=$(mktemp)
  echo "test-alkamar" > "${TEST_FILE}"
  if echo "${GPG_PASSPHRASE}" | gpg --batch --passphrase-fd 0 \
    --symmetric --cipher-algo AES256 --output "${TEST_FILE}.gpg" \
    "${TEST_FILE}" 2>/dev/null \
  && echo "${GPG_PASSPHRASE}" | gpg --batch --passphrase-fd 0 \
    --decrypt "${TEST_FILE}.gpg" 2>/dev/null | grep -q "test-alkamar"; then
    ok "GPG chiffrement/déchiffrement OK"
  else
    fail "GPG test échoué — vérifier la passphrase"
  fi
  rm -f "${TEST_FILE}" "${TEST_FILE}.gpg"
else
  warn "GPG_PASSPHRASE non définie"
  echo ""
  echo "  Définir avant d'utiliser les backups :"
  echo "  → export GPG_PASSPHRASE=\"ta-passphrase-forte\""
  echo "  → Ajouter dans ton gestionnaire de mots de passe"
  echo "  → Ajouter comme secret GitHub Actions : GPG_PASSPHRASE"
fi

# ── CHECK 5 : SUPABASE_DB_URL ─────────────────────────────────────────────────
step "5/6 Variables d'environnement"

cd "${PROJECT_ROOT}"

if [[ -f ".env.local" ]]; then
  ok ".env.local trouvé"
  for KEY in SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY STRIPE_SECRET_KEY STRIPE_PUBLISHABLE_KEY; do
    if grep -q "^${KEY}=." .env.local 2>/dev/null; then
      ok "  ${KEY} définie"
    else
      warn "  ${KEY} manquante ou vide"
    fi
  done

  if grep -q "^SUPABASE_DB_URL=." .env.local 2>/dev/null; then
    ok "  SUPABASE_DB_URL définie"
  else
    warn "  SUPABASE_DB_URL MANQUANTE (requise pour backup-supabase.sh)"
    echo ""
    echo "  Obtenir depuis Supabase Dashboard :"
    echo "  → Project Settings → Database → Connection string → URI"
    echo "  Format : postgresql://postgres:PASSWORD@db.REF.supabase.co:5432/postgres"
    echo "  Puis ajouter dans .env.local :"
    echo "  → SUPABASE_DB_URL=postgresql://postgres:PASS@db.REF.supabase.co:5432/postgres"
  fi
else
  fail ".env.local introuvable"
fi

# ── CHECK 6 : SECRETS GITHUB ACTIONS ─────────────────────────────────────────
step "6/6 Secrets GitHub Actions"

MAIN_REPO="fahareddine/info-experts"

if gh auth status &>/dev/null; then
  REQUIRED_SECRETS=(
    "SUPABASE_DB_URL"
    "SUPABASE_URL"
    "SUPABASE_ANON_KEY"
    "SUPABASE_SERVICE_ROLE_KEY"
    "STRIPE_SECRET_KEY"
    "STRIPE_PUBLISHABLE_KEY"
    "GPG_PASSPHRASE"
    "BACKUP_GH_TOKEN"
    "RCLONE_GDRIVE_TOKEN"
    "RCLONE_B2_ACCOUNT"
    "RCLONE_B2_KEY"
  )

  EXISTING_SECRETS=$(gh secret list --repo "${MAIN_REPO}" 2>/dev/null | awk '{print $1}' || echo "")

  MISSING=()
  for S in "${REQUIRED_SECRETS[@]}"; do
    if echo "$EXISTING_SECRETS" | grep -q "^${S}$"; then
      ok "  Secret ${S}"
    else
      fail "  Secret ${S} MANQUANT"
      MISSING+=("$S")
    fi
  done

  if [[ ${#MISSING[@]} -gt 0 ]]; then
    echo ""
    echo "  Ajouter les secrets manquants sur :"
    echo "  https://github.com/${MAIN_REPO}/settings/secrets/actions"
    echo ""
    echo "  Ou via gh CLI :"
    for S in "${MISSING[@]}"; do
      echo "  gh secret set ${S} --repo ${MAIN_REPO}"
    done

    # Proposer d'ajouter le token rclone automatiquement
    GDRIVE_TOKEN=$(grep -A5 '\[gdrive\]' ~/.config/rclone/rclone.conf 2>/dev/null | grep '^token' | cut -d= -f2- | xargs || echo "")
    if [[ -n "$GDRIVE_TOKEN" ]] && echo "${MISSING[@]}" | grep -q "RCLONE_GDRIVE_TOKEN"; then
      read -rp "Ajouter RCLONE_GDRIVE_TOKEN automatiquement depuis rclone.conf ? [oui/non] : " ADD_TOKEN
      if [[ "$ADD_TOKEN" == "oui" ]]; then
        echo "${GDRIVE_TOKEN}" | gh secret set RCLONE_GDRIVE_TOKEN --repo "${MAIN_REPO}"
        ok "RCLONE_GDRIVE_TOKEN ajouté"
      fi
    fi
  fi
else
  warn "gh non authentifié — impossible de vérifier les secrets"
fi

# ── RÉSUMÉ ────────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  SETUP TERMINÉ                                          ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "Quand tout est vert → lancer le premier snapshot réel :"
echo ""
echo "  export GPG_PASSPHRASE=\"ta-passphrase\""
echo "  bash backup-system/scripts/snapshot.sh \"mise-en-service-initiale\""
echo ""
