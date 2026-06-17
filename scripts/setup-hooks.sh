#!/bin/bash
# ============================================================
# KOMERCE — Installation des hooks Git locaux
# Usage : bash scripts/setup-hooks.sh
# ============================================================

set -e

HOOKS_DIR=".git/hooks"
PRE_PUSH_HOOK="$HOOKS_DIR/pre-push"

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  KOMERCE — Installation du coffre-fort local            ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# Vérifier qu'on est dans un repo Git
if [ ! -d ".git" ]; then
  echo "❌ Ce script doit être exécuté à la racine du dépôt Git"
  exit 1
fi

# Vérifier que Node.js est disponible
if ! command -v node &> /dev/null; then
  echo "❌ Node.js est requis mais n'est pas installé"
  exit 1
fi

# Vérifier la version de Node.js
NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "❌ Node.js >= 18 requis (actuel: $(node -v))"
  exit 1
fi

# Vérifier que les fichiers nécessaires existent
if [ ! -f "scripts/impact-check.js" ]; then
  echo "❌ scripts/impact-check.js introuvable"
  exit 1
fi

if [ ! -f "scripts/impact-config.json" ]; then
  echo "❌ scripts/impact-config.json introuvable"
  exit 1
fi

echo "📂 Répertoire hooks : $HOOKS_DIR"

# Créer le répertoire hooks si nécessaire
mkdir -p "$HOOKS_DIR"

# Sauvegarder le hook existant
if [ -f "$PRE_PUSH_HOOK" ]; then
  echo "⚠️  Un hook pre-push existe déjà"
  echo "   Sauvegarde dans : $PRE_PUSH_HOOK.backup"
  cp "$PRE_PUSH_HOOK" "$PRE_PUSH_HOOK.backup"
fi

# Créer le hook pre-push
cat > "$PRE_PUSH_HOOK" << 'HOOK'
#!/bin/bash
# ============================================================
# KOMERCE — Pre-push hook (coffre-fort local)
# Analyse d'impact automatique avant chaque push
# ============================================================

# Récupérer la branche remote
remote="$1"
url="$2"

# Couleurs
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m'

echo ""
echo "🛡️  Coffre-fort Komerce — Analyse d'impact pré-push..."
echo ""

# Déterminer la base de comparaison
BASE_REF="origin/main"
CURRENT_BRANCH=$(git branch --show-current)

if [ "$CURRENT_BRANCH" = "main" ]; then
  BASE_REF="HEAD~1"
fi

# Exécuter l'analyse
OUTPUT=$(node scripts/impact-check.js --diff="$BASE_REF" 2>&1)
EXIT_CODE=$?

# Extraire le score (chercher la ligne "Score de risque")
SCORE=$(echo "$OUTPUT" | grep -oP 'Score de risque.*?(\d+)/100' | grep -oP '\d+(?=/100)' | head -1)
LEVEL=$(echo "$OUTPUT" | grep -oP '(SAFE|REVIEW|BLOCK)' | head -1)

if [ -z "$SCORE" ]; then
  echo "⚠️  Impossible d'extraire le score d'impact"
  echo "$OUTPUT"
  echo ""
  read -p "Continuer le push ? (y/N) " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
  exit 0
fi

echo "$OUTPUT"
echo ""

case "$LEVEL" in
  "SAFE")
    echo -e "${GREEN}✅ Score $SCORE/100 — Push autorisé${NC}"
    exit 0
    ;;
  "REVIEW")
    echo -e "${YELLOW}⚠️  Score $SCORE/100 — Revue recommandée${NC}"
    echo ""
    read -p "Continuer le push quand même ? (y/N) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo "Push annulé."
      exit 1
    fi
    exit 0
    ;;
  "BLOCK")
    echo -e "${RED}🚫 Score $SCORE/100 — Push bloqué !${NC}"
    echo ""
    echo "Ce changement présente un risque trop élevé."
    echo "Corrigez les problèmes identifiés ou utilisez :"
    echo "  git push --no-verify  (bypass d'urgence)"
    exit 1
    ;;
  *)
    echo "⚠️  Niveau de risque inconnu ($LEVEL)"
    exit 0
    ;;
esac
HOOK

# Rendre le hook exécutable
chmod +x "$PRE_PUSH_HOOK"

# ============================================================
# Hook pre-commit : regeneration + reconciliation automatiques
# ============================================================
PRE_COMMIT_HOOK="$HOOKS_DIR/pre-commit"
if [ -f "$PRE_COMMIT_HOOK" ]; then
  echo "⚠️  Un hook pre-commit existe deja — sauvegarde dans $PRE_COMMIT_HOOK.backup"
  cp "$PRE_COMMIT_HOOK" "$PRE_COMMIT_HOOK.backup"
fi

cat > "$PRE_COMMIT_HOOK" << 'PCHOOK'
#!/bin/bash
# ============================================================
# KOMERCE — Pre-commit : reprise automatique de la gouvernance
# 1. regenere le graphe d'architecture (deterministe)
# 2. reconcile le budget (elague les fictions resolues, abaisse le cliquet)
# 3. re-stage les artefacts regeneres / reconcilies
# 4. ne bloque que sur un vrai probleme non resoluble automatiquement
# Bypass d'urgence : git commit --no-verify
# ============================================================
set -e
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

echo ""
echo "🛡️  Komerce — reprise gouvernance (pre-commit)..."

# 1. Graphe a jour a partir des headers
node scripts/generate-komerce-arch-graph.js >/dev/null 2>&1 || true

# 2. Reconciliation auto du budget (resoudre = automatique)
RECON=$(node scripts/arch-reconcile.js --write 2>&1) || true
if echo "$RECON" | grep -q "Budget reconcilie et reecrit"; then
  echo -e "${YELLOW}↻ Budget reconcilie automatiquement :${NC}"
  echo "$RECON" | grep -E "elaguee|abaisse" | sed 's/^/   /'
fi

# 3. Re-stage les artefacts s'ils ont change
git add docs/komerce-arch-header-graph.json docs/KOMERCE_ARCH_HEADER_GRAPH.md scripts/arch-debt-budget.json 2>/dev/null || true

# 4. Portes : ne bloquer que sur un vrai probleme restant
if ! node scripts/arch-db-check.js >/dev/null 2>&1; then
  echo -e "${RED}🚫 Hygiene headers : violation bloquante.${NC} Lance: npm run arch:check"
  exit 1
fi
if ! node scripts/arch-schema-drift-check.js >/dev/null 2>&1; then
  echo -e "${RED}🚫 Drift SCHEMA.md <-> DB live non resolu automatiquement.${NC}"
  echo "   Detail : npm run arch:drift"
  echo "   (fiction hors liste = vrai bug ; fantome = retirer de SCHEMA.md ; cliquet depasse = documenter)"
  exit 1
fi
if ! node scripts/arch-header-sql-check.js >/dev/null 2>&1; then
  echo -e "${RED}🚫 Sous-declaration headers<->SQL au-dela du cliquet.${NC}"
  echo "   Detail : npm run arch:headers-sql"
  echo "   (declare les tables manquantes dans @db-read/@db-write, ou reconcile si baisse legitime)"
  exit 1
fi
# 5. Doctrine sanitize_before_render : ne bloque QUE si une source externe (req/params/
#    location/URL…) atterrit non echappee dans un sink HTML, sur les lignes ajoutees.
if ! node scripts/arch-doctrine-sanitize-check.js >/dev/null 2>&1; then
  echo -e "${RED}🚫 Doctrine sanitize_before_render : entree externe rendue sans echappement.${NC}"
  echo "   Detail : npm run arch:doctrine    (sweep complet : npm run arch:doctrine:all)"
  echo "   (echappe la donnee avec sanitize(...) / escapeHtml(...) avant le rendu)"
  exit 1
fi

echo -e "${GREEN}✅ Gouvernance OK (graphe + budget a jour, portes vertes).${NC}"
exit 0
PCHOOK

chmod +x "$PRE_COMMIT_HOOK"
echo "✅ Hook pre-commit installe (regeneration + reconciliation automatiques)."

echo ""
echo "✅ Hook pre-push installé avec succès !"
echo ""
echo "📋 Comportement :"
echo "   🟢 SAFE (0-29)   → Push autorisé automatiquement"
echo "   🟡 REVIEW (30-69) → Confirmation demandée"
echo "   🔴 BLOCK (70-100)  → Push bloqué (bypass: git push --no-verify)"
echo ""
echo "🔧 Pour désinstaller :"
echo "   rm $PRE_PUSH_HOOK"
echo ""
echo "═══════════════════════════════════════════════════════════"
