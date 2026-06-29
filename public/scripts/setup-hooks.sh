#!/bin/bash
# ============================================================
# KOMERCE DASHBOARDS — Installation du hook pre-commit local
# Usage : bash scripts/setup-hooks.sh
# ============================================================
set -e

HOOKS_DIR=".git/hooks"
PRE_COMMIT_HOOK="$HOOKS_DIR/pre-commit"

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  KOMERCE DASHBOARDS — Installation hook pre-commit      ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

if [ ! -d ".git" ]; then
  echo "❌ Ce script doit etre execute a la racine du depot Git"
  exit 1
fi

if ! command -v node &> /dev/null; then
  echo "❌ Node.js est requis mais n'est pas installe"
  exit 1
fi

mkdir -p "$HOOKS_DIR"

if [ -f "$PRE_COMMIT_HOOK" ]; then
  echo "⚠️  Un hook pre-commit existe deja — sauvegarde dans $PRE_COMMIT_HOOK.backup"
  cp "$PRE_COMMIT_HOOK" "$PRE_COMMIT_HOOK.backup"
fi

cat > "$PRE_COMMIT_HOOK" << 'PCHOOK'
#!/bin/bash
# ============================================================
# KOMERCE DASHBOARDS — Pre-commit : gouvernance minimale
# 1. Quality gate (N2) — use strict, const/let, patterns
# 2. Feature registry (N0) — tout fichier doit etre declare
# Bypass d'urgence : git commit --no-verify
# ============================================================
set -e
GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'

echo ""
echo "🛡️  Dashboards — gouvernance pre-commit..."

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
  echo -e "${RED}🚫 Registre features : orphelin ou champ manquant.${NC}"
  echo "$_OUT"
  exit 1
fi

echo -e "${GREEN}✅ Gouvernance OK (N2 quality + N0 registry).${NC}"
exit 0
PCHOOK

chmod +x "$PRE_COMMIT_HOOK"
echo "✅ Hook pre-commit installe."
echo "   Bypass d'urgence : git commit --no-verify"
echo ""
