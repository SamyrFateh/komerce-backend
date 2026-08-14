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

# gen-dashboards-360.js est optionnel a l'installation : le hook le gere lui-meme
# (garde "if [ -d public/dashboards/admin/js ]"), donc non bloquant ici si absent pour
# l'instant — juste un avertissement pour ne pas le perdre de vue.
if [ -d "public/dashboards/admin/js" ] && [ ! -f "scripts/gen-dashboards-360.js" ]; then
  echo "⚠️  public/dashboards/admin/js present mais scripts/gen-dashboards-360.js absent"
  echo "   Le bloc 7 du hook pre-commit (carte 360 dashboards) sera silencieusement inactif."
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

# Déterminer la base de comparaison : toujours l'ancêtre commun réel
# avec origin/main, jamais un simple HEAD~1 codé en dur (faux dès
# qu'on pousse plus d'un commit, ex. après un merge). Fonctionne
# identiquement qu'on soit sur main ou sur une branche.
# FIX 2026-07-11 : l'ancienne version forçait HEAD~1 sur main, ce qui
# cassait le calcul (diff vide -> fallback interactif -> push refusé
# par defaut) dès qu'on poussait plus d'un commit d'un coup (ex. après
# un git pull/merge).
git fetch origin main --quiet 2>/dev/null || true
BASE_REF=$(git merge-base HEAD origin/main 2>/dev/null)
if [ -z "$BASE_REF" ]; then
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
    BRANCH=$(git branch --show-current 2>/dev/null)
    if [ "$BRANCH" != "main" ] && [ "$BRANCH" != "master" ]; then
      echo "Branche de travail — REVIEW informatif, push autorisé."
      echo "La revue finale reste portée par la PR/CI."
      exit 0
    fi
    # Sur main/master seulement, conserver une validation humaine.
    if [ -e /dev/tty ]; then
      REPLY=""
      read -p "Push direct sur main malgré REVIEW ? (y/N) " -n 1 -r < /dev/tty 2>/dev/null || REPLY=""
      echo ""
      if [[ $REPLY =~ ^[Yy]$ ]]; then exit 0; fi
    fi
    echo "Push main annulé — revue requise."
    exit 1
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

# 0a. Registre features (N0) — tout fichier doit appartenir à une feature déclarée.
{ _OUT=$(node scripts/feature-registry-check.js --strict 2>&1); _RC=$?; } || true
if [ $_RC -ne 0 ]; then
  echo -e "${RED}🚫 Registre features : orphelin ou désaccord header↔manifest.${NC}"
  echo "$_OUT"
  exit 1
fi

# 0b. Code quality (N2) — use strict, const/let, pas de SQL concat.
{ _OUT=$(node scripts/code-quality-gate.js --strict 2>&1); _RC=$?; } || true
if [ $_RC -ne 0 ]; then
  echo -e "${RED}🚫 Qualité code : violation N2 (strict/var/SQL).${NC}"
  echo "$_OUT"
  echo "   Auto-fix : node scripts/code-quality-gate.js --fix"
  exit 1
fi

# 0c. CSS Guardian — couvert par l'étape 6b (check:fast côté boutique, après
# rebuild des bundles dist par deploy-css.js). Un doublon vivait ici
# (scripts/css-guard.js, racine) : même rôle, mêmes fichiers scannés
# (public/boutique/css/dist/*.css), mais tournait AVANT le rebuild de l'étape
# 6a -> vérifiait des bundles potentiellement périmés. Supprimé ; voir
# public/boutique/scripts/css-guard.js (canonique, --strict/--save).

# 0. Auto-declaration des tables dans les headers @db-read/@db-write a partir du
#    VRAI SQL du fichier (documentation-only, idempotent, additif : ne retire jamais
#    une declaration manuelle). Resout AUTOMATIQUEMENT la sous-declaration au lieu de
#    bloquer dessus. Ne re-stage QUE les fichiers deja dans le commit -> aucun effet
#    de bord sur d'autres fichiers (un enrichissement incident reste visible, non commite).
STAGED_SRC=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(js|mjs)$' || true)
node scripts/enrich-komerce-arch-db-fields.js --write >/dev/null 2>&1 || true
for f in $STAGED_SRC; do git add "$f" 2>/dev/null || true; done

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
{ _OUT=$(node scripts/arch-db-check.js 2>&1); _RC=$?; } || true
if [ $_RC -ne 0 ]; then
  echo -e "${RED}🚫 Hygiene headers : violation bloquante.${NC}"
  echo "$_OUT"
  exit 1
fi
{ _OUT=$(node scripts/arch-schema-drift-check.js 2>&1); _RC=$?; } || true
if [ $_RC -ne 0 ]; then
  echo -e "${RED}🚫 Drift SCHEMA.md <-> DB live non resolu automatiquement.${NC}"
  echo "$_OUT"
  echo "   (fiction hors liste = vrai bug ; fantome = retirer de SCHEMA.md ; cliquet depasse = documenter)"
  exit 1
fi
{ _OUT=$(node scripts/arch-header-sql-check.js 2>&1); _RC=$?; } || true
if [ $_RC -ne 0 ]; then
  echo -e "${RED}🚫 Sous-declaration headers<->SQL au-dela du cliquet.${NC}"
  echo "$_OUT"
  echo "   Auto-fix : npm run arch:enrich:write   (declare les tables depuis le vrai SQL, puis re-commit)"
  echo "   Sinon    : declarer a la main dans @db-read/@db-write, ou npm run arch:reconcile:write si baisse legitime"
  exit 1
fi
# 5. Doctrine sanitize_before_render : ne bloque QUE si une source externe (req/params/
#    location/URL…) atterrit non echappee dans un sink HTML, sur les lignes ajoutees.
{ _OUT=$(node scripts/arch-doctrine-sanitize-check.js 2>&1); _RC=$?; } || true
if [ $_RC -ne 0 ]; then
  echo -e "${RED}🚫 Doctrine sanitize_before_render : entree externe rendue sans echappement.${NC}"
  echo "$_OUT"
  echo "   (echappe la donnee avec sanitize(...) / escapeHtml(...) avant le rendu)"
  exit 1
fi

# 5b. Audit d'architecture backend (invariants I-BACK-*) : 100% statique, rapide.
#     SQL non parametre, owner unique payment_status, auth admin, etc.
{ _OUT=$(node scripts/audit-backend-arch.js 2>&1); _RC=$?; } || true
if [ $_RC -ne 0 ]; then
  echo -e "${RED}🚫 Audit backend : violation d'invariant (SQL non parametre / owner payment_status / auth admin).${NC}"
  echo "$_OUT"
  exit 1
fi

# 6. Invariants boutique (chaine statique, sans e2e) : ownership CSS, hex/tokens,
#    breakpoints, injection CSS, equilibre HTML, imports JS, cache-buster.
#    Sous-shell : le cd ne fuit pas. Ne tourne que si le dossier boutique existe.
if [ -d public/boutique ]; then
  # 6a. Auto-regeneration des bundles CSS (meme philosophie que le graphe backend) :
  #     rebuild dist + bump des ?v= + cache-buster, puis re-stage. Plus besoin de
  #     lancer `npm run deploy:css` a la main a chaque etape.
  REBUILD=$( cd public/boutique && node scripts/deploy-css.js 2>&1 ) || {
    echo -e "${RED}🚫 deploy-css a echoue.${NC}"
    echo "$REBUILD" | tail -6
    exit 1
  }
  if echo "$REBUILD" | grep -q "bundle(s) modifié"; then
    echo -e "${YELLOW}↻ Bundles CSS regeneres automatiquement (dist + ?v= + cache-buster).${NC}"
    git add public/boutique/css/dist public/boutique/index.html public/boutique/.cache-buster-state.json 2>/dev/null || true
  fi

  # 6b. Invariants boutique (apres rebuild : check:cache est donc forcement vert ici).
  { _OUT=$( cd public/boutique && npm run --silent check:fast 2>&1 ); _RC=$?; } || true
  if [ $_RC -ne 0 ]; then
    echo -e "${RED}🚫 Invariants boutique : violation.${NC}"
    echo "$_OUT"
    echo "   (ownership CSS / hex hors tokens / breakpoints / injection CSS — corrige avant commit)"
    exit 1
  fi
fi

# 7. Carte 360 des dashboards admin (chaine route -> vue -> KmcApi -> endpoint -> contrat).
#    Independant du bloc boutique ci-dessus : pas de bus ici, la couture est cette chaine.
#    Auto-regenere le rapport (comme le graphe @komerce-arch), puis bloque uniquement sur
#    une regression reelle au-dela du cliquet fige (route orpheline, methode API manquante
#    -> crash garanti, methode API morte, violation de la doctrine kmc_api_only).
#    Les contrats non prouves (UNKNOWN) restent informatifs, jamais bloquants.
if [ -d public/dashboards/admin/js ]; then
  node scripts/gen-dashboards-360.js >/dev/null 2>&1 || true
  git add docs/DASHBOARDS_360.json docs/DASHBOARDS_360.md 2>/dev/null || true

  if ! node scripts/gen-dashboards-360.js --check >/tmp/dashboards-360-check.log 2>&1; then
    echo -e "${RED}🚫 Dashboards 360 : nouvelle anomalie bloquante hors baseline.${NC}"
    cat /tmp/dashboards-360-check.log | grep -E "↑|✖"
    echo "   Detail complet : npm run dashboards:360:check"
    echo "   (relie la chaine route/vue/API, ou si legitime : npm run dashboards:360:save)"
    rm -f /tmp/dashboards-360-check.log
    exit 1
  fi
  rm -f /tmp/dashboards-360-check.log
fi

# 8. Carte 360 boutique (couplage par BUS + couture endpoints -> contrat OpenAPI).
#    Frere de l'etape 7 : auto-regenere docs/BOUTIQUE_360.{json,md}, re-stage, puis bloque
#    sur une regression hors baseline (emission/ecouteur orphelin, evenement non declare,
#    endpoint NOT_FOUND = appel boutique vers un endpoint absent du contrat).
if [ -d public/boutique/js ]; then
  node scripts/gen-boutique-360.js >/dev/null 2>&1 || true
  git add docs/BOUTIQUE_360.json docs/BOUTIQUE_360.md 2>/dev/null || true

  if ! node scripts/gen-boutique-360.js --check >/tmp/boutique-360-check.log 2>&1; then
    echo -e "${RED}🚫 Boutique 360 : nouvelle anomalie bloquante hors baseline.${NC}"
    cat /tmp/boutique-360-check.log | grep -E "↑|✖"
    echo "   Detail : npm run boutique:360:check"
    echo "   (relie le bus ou corrige l'endpoint, ou si legitime : npm run boutique:360:save)"
    rm -f /tmp/boutique-360-check.log
    exit 1
  fi
  rm -f /tmp/boutique-360-check.log
fi

# 9. Meta-graphe des COUTURES : coud backend + boutique + dashboards via le contrat OpenAPI.
#    Tourne en dernier (a besoin des 3 cartes fraiches). Bloque uniquement sur une NOUVELLE
#    couture fantome (un front appelle un endpoint absent du contrat). Endpoints partages et
#    contrats UNKNOWN restent informatifs.
if [ -f docs/komerce-arch-header-graph.json ] && [ -f docs/BOUTIQUE_360.json ] && [ -f docs/DASHBOARDS_360.json ]; then
  node scripts/gen-meta-graph.js >/dev/null 2>&1 || true
  git add docs/META_GRAPH.json docs/META_GRAPH.md 2>/dev/null || true

  if ! node scripts/gen-meta-graph.js --check >/tmp/meta-check.log 2>&1; then
    echo -e "${RED}🚫 Meta-graphe : nouvelle couture fantome hors baseline.${NC}"
    cat /tmp/meta-check.log | grep -E "↑|✖"
    echo "   Detail : npm run meta:graph:check"
    echo "   (ajoute l'endpoint au contrat / corrige l'appel, ou si legitime : npm run meta:graph:save)"
    rm -f /tmp/meta-check.log
    exit 1
  fi
  rm -f /tmp/meta-check.log
fi

echo -e "${GREEN}✅ Gouvernance OK (graphe + budget, portes vertes, boutique verte, 360 x3 + meta).${NC}"
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
