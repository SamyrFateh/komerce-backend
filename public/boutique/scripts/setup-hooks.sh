#!/bin/bash
# ============================================================
# KOMERCE BOUTIQUE — Installation des hooks Git locaux
# Usage : bash scripts/setup-hooks.sh
# ============================================================
set -e

HOOKS_DIR=".git/hooks"
PRE_COMMIT_HOOK="$HOOKS_DIR/pre-commit"

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  KOMERCE BOUTIQUE — Installation du hook pre-commit     ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

if [ ! -d ".git" ]; then
  echo "❌ Ce script doit être exécuté à la racine du dépôt Git"
  exit 1
fi
if ! command -v node &> /dev/null; then
  echo "❌ Node.js requis"
  exit 1
fi

mkdir -p "$HOOKS_DIR"

if [ -f "$PRE_COMMIT_HOOK" ]; then
  echo "⚠️  Hook existant sauvegardé dans $PRE_COMMIT_HOOK.backup"
  cp "$PRE_COMMIT_HOOK" "$PRE_COMMIT_HOOK.backup"
fi

cat > "$PRE_COMMIT_HOOK" << 'PCHOOK'
#!/bin/bash
# ============================================================
# KOMERCE BOUTIQUE — Pre-commit hook (N0 + N2 + N5)
# Bypass d'urgence : git commit --no-verify
# ============================================================
set -e
GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'

echo ""
echo "🛡️  Komerce Boutique — garde-fous pre-commit..."

# N2 — Code quality
{ _OUT=$(node scripts/code-quality-gate.js --strict 2>&1); _RC=$?; } || true
if [ $_RC -ne 0 ]; then
  echo -e "${RED}🚫 Quality gate N2 : violation bloquante.${NC}"
  echo "$_OUT"
  exit 1
fi

# N0 — Feature registry
{ _OUT=$(node scripts/feature-registry-check.js --strict 2>&1); _RC=$?; } || true
if [ $_RC -ne 0 ]; then
  echo -e "${RED}🚫 Registre features N0 : orphelin ou champ manquant.${NC}"
  echo "$_OUT"
  exit 1
fi

# N5 — Feature slice guard
if [ -f scripts/feature-guard.js ]; then
  { _OUT=$(node scripts/feature-guard.js --strict 2>&1); _RC=$?; } || true
  if [ $_RC -ne 0 ]; then
    echo -e "${RED}🚫 Feature slice guard N5 : incohérence détectée.${NC}"
    echo "$_OUT"
    exit 1
  fi
fi

# Garde-fous boutique (N4 — arch, CSS, HTML, imports)
{ _OUT=$(npm run --silent check:fast 2>&1); _RC=$?; } || true
if [ $_RC -ne 0 ]; then
  echo -e "${RED}🚫 Garde-fous boutique : violation détectée.${NC}"
  echo "$_OUT"
  exit 1
fi

echo -e "${GREEN}✅ Boutique OK — N0 + N2 + N4 + N5 verts.${NC}"
exit 0
PCHOOK

chmod +x "$PRE_COMMIT_HOOK"
echo "✅ Hook pre-commit installé (N2 + N0 + N5 + check:fast)."
echo ""
echo "📋 Ce qui tourne avant chaque commit :"
echo "   ✓ N2 — Code quality (use strict, const/let)"
echo "   ✓ N0 — Feature registry (orphelins, champs obligatoires)"
echo "   ✓ N5 — Feature slice guard (cohérence @domain, fichiers, contrats)"
echo "   ✓ N4 — Garde-fous boutique (HTML, imports, CSS, arch)"
echo ""
echo "🔧 Bypass : git commit --no-verify"
