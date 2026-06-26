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

mkdir -p "$HOOKS_DIR"

if [ -f "$PRE_COMMIT_HOOK" ]; then
  echo "⚠️  Hook pre-commit existant sauvegardé dans $PRE_COMMIT_HOOK.backup"
  cp "$PRE_COMMIT_HOOK" "$PRE_COMMIT_HOOK.backup"
fi

cat > "$PRE_COMMIT_HOOK" << 'PCHOOK'
#!/bin/bash
# ============================================================
# KOMERCE BOUTIQUE — Pre-commit hook
# Lance les garde-fous avant chaque commit.
# Bypass d'urgence : git commit --no-verify
# ============================================================
set -e
GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'

echo ""
echo "🛡️  Komerce Boutique — garde-fous pre-commit..."

# 1. Code quality (N2) — use strict, const/let
if ! node scripts/code-quality-gate.js --strict >/dev/null 2>&1; then
  echo -e "${RED}🚫 Qualité code : violation N2 (strict/var).${NC}"
  echo "   Auto-fix : node scripts/code-quality-gate.js --fix"
  exit 1
fi

# 2. Garde-fous boutique (HTML, imports, CSS, arch)
if ! npm run --silent check:fast >/dev/null 2>&1; then
  echo -e "${RED}🚫 Garde-fous boutique : violation détectée.${NC}"
  echo "   Détail : npm run check:fast"
  exit 1
fi

echo -e "${GREEN}✅ Boutique OK — garde-fous verts.${NC}"
exit 0
PCHOOK

chmod +x "$PRE_COMMIT_HOOK"
echo "✅ Hook pre-commit installé."
echo ""
echo "📋 Ce qui tourne avant chaque commit :"
echo "   ✓ Code quality (use strict, const/let)"
echo "   ✓ Garde-fous boutique (HTML, imports, CSS, arch, ownership)"
echo ""
echo "🔧 Bypass : git commit --no-verify"
echo "   Désinstaller : rm $PRE_COMMIT_HOOK"
