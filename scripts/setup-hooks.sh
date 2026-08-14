#!/bin/bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$ROOT" ]]; then
  echo "Hors depot Git - hooks Komerce inchanges."
  exit 0
fi

HOOKS_DIR="$ROOT/.git/hooks"
PRE_COMMIT="$HOOKS_DIR/pre-commit"
PRE_PUSH="$HOOKS_DIR/pre-push"
mkdir -p "$HOOKS_DIR"

is_managed_hook() {
  local hook="$1"
  [[ -f "$hook" ]] && grep -Eqi 'KOMERCE-HOOK|Coffre-fort Komerce|reprise gouvernance' "$hook"
}

pause_managed_hook() {
  local hook="$1"
  local backup="${hook}.komerce-paused"

  [[ -f "$hook" ]] || return 0
  if ! is_managed_hook "$hook"; then
    echo "Hook personnel conserve: ${hook#$ROOT/}"
    return 0
  fi

  if [[ ! -e "$backup" ]]; then
    mv "$hook" "$backup"
    echo "Ancien hook Komerce sauvegarde: ${backup#$ROOT/}"
  else
    rm -f "$hook"
    echo "Ancien hook Komerce retire; sauvegarde deja presente."
  fi
}

pause_managed_hook "$PRE_PUSH"

if [[ -f "$PRE_COMMIT" ]] && ! is_managed_hook "$PRE_COMMIT"; then
  echo "Hook pre-commit personnel detecte - installation Komerce ignoree."
  echo "Fichier conserve: ${PRE_COMMIT#$ROOT/}"
  exit 0
fi

cat > "$PRE_COMMIT" << 'HOOK'
#!/bin/bash
# KOMERCE-HOOK v6 - tiers-1-5-targeted
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

now_ms() {
  node -e 'process.stdout.write(String(Date.now()))'
}

run_gate() {
  local label="$1"
  shift
  local start end elapsed output rc
  start="$(now_ms)"
  set +e
  output=$("$@" 2>&1)
  rc=$?
  set -e
  end="$(now_ms)"
  elapsed=$((end - start))

  if [[ $rc -ne 0 ]]; then
    echo "ECHEC $label (${elapsed} ms)"
    [[ -n "$output" ]] && echo "$output"
    exit "$rc"
  fi

  echo "OK $label (${elapsed} ms)"
}

TOTAL_START="$(now_ms)"
STAGED="$(git diff --cached --name-only --diff-filter=ACMR || true)"

if [[ -z "$STAGED" ]]; then
  echo "OK Pre-commit Komerce rapide : aucun fichier staged."
  exit 0
fi

# N1 - Controles techniques generiques rapides.
if echo "$STAGED" | grep -Eq '\.(js|cjs|mjs)$'; then
  run_gate "Qualite JS" node scripts/code-quality-gate.js --strict
fi

if echo "$STAGED" | grep -Eq '^(server\.js|routes/|services/|middleware/|utils/|scripts/|config/).+\.(js|cjs|mjs)$|^server\.js$'; then
  run_gate "Invariants backend" node scripts/audit-backend-arch.js
fi

if echo "$STAGED" | grep -Eq '^public/.+\.(js|cjs|mjs)$'; then
  run_gate "Sanitization front staged" node scripts/arch-doctrine-sanitize-check.js
fi

# N2 - Registre cible avec ratchet des workflows volontairement archives.
if echo "$STAGED" | grep -Eq '^(features|capabilities|services|routes|migrations|middleware|utils|validators|core|bootstrap|db)/|^\.github/.+\.(yml|yaml|md)$'; then
  run_gate "Feature Registry" node scripts/feature-registry-targeted-check.js
fi

# N3 - Schema cible.
if echo "$STAGED" | grep -Eq '^migrations/.+\.sql$|^docs/db/railway-live-schema\.sql$'; then
  run_gate "Schema freshness" node scripts/check-schema-freshness.js
fi

if echo "$STAGED" | grep -Eq '^docs/db/railway-live-schema\.sql$'; then
  run_gate "Schema anti-resurrection" node scripts/check-schema-resurrection.js
fi

# N4 - Boutique source-level uniquement. Aucun rebuild css/dist ici.
HAS_BOUTIQUE_CSS=0
HAS_BOUTIQUE_JS=0
HAS_BOUTIQUE_HTML=0

echo "$STAGED" | grep -Eq '^public/boutique/css/.+\.css$' && HAS_BOUTIQUE_CSS=1 || true
echo "$STAGED" | grep -Eq '^public/boutique/js/.+\.(js|cjs|mjs)$' && HAS_BOUTIQUE_JS=1 || true
echo "$STAGED" | grep -Eq '^public/boutique/index\.html$' && HAS_BOUTIQUE_HTML=1 || true

if [[ "$HAS_BOUTIQUE_CSS" -eq 1 ]]; then
  run_gate "Boutique CSS important" node public/boutique/scripts/check-important.js --strict
  run_gate "Boutique breakpoints" node public/boutique/scripts/check-breakpoints.js --strict
  run_gate "Boutique CSS vars" node public/boutique/scripts/check-css-vars.js --strict
  run_gate "Boutique z-index" node public/boutique/scripts/check-zindex-contract.js --strict
  run_gate "Boutique sticky" node public/boutique/scripts/check-sticky-integrity.js --strict
fi

if [[ "$HAS_BOUTIQUE_JS" -eq 1 ]]; then
  run_gate "Boutique imports JS" node public/boutique/scripts/check-js-imports.js
  run_gate "Boutique no CSS injection" node public/boutique/scripts/check-no-css-injection.js
fi

if [[ "$HAS_BOUTIQUE_HTML" -eq 1 ]]; then
  run_gate "Boutique HTML balance" node public/boutique/scripts/check-html-balance.js
fi

if [[ "$HAS_BOUTIQUE_JS" -eq 1 || "$HAS_BOUTIQUE_HTML" -eq 1 ]]; then
  run_gate "Boutique body classes" node public/boutique/scripts/check-body-classes.js
fi

if [[ "$HAS_BOUTIQUE_CSS" -eq 1 || "$HAS_BOUTIQUE_JS" -eq 1 || "$HAS_BOUTIQUE_HTML" -eq 1 ]]; then
  run_gate "Boutique architecture" node public/boutique/scripts/audit-boutique-arch.js
fi

# N5 - Tests unitaires cibles. Graphe Jest + fallback test homonyme, sans couverture.
if echo "$STAGED" | grep -Eq '^(server\.js|(routes|services|middleware|utils|validators|core|bootstrap|db)/.+\.(js|cjs|mjs|ts)|tests/(unit|invariants|contract|notifications)/.+\.(test|spec)\.(js|cjs|mjs|ts)|tests/parcelOptimization\.test\.js|public/boutique/(js/.+\.(js|cjs|mjs|ts)|tests/unit/.+\.(test|spec)\.(js|cjs|mjs|ts)))$'; then
  run_gate "Tests unitaires lies" node scripts/run-staged-related-tests.js
fi

TOTAL_END="$(now_ms)"
echo "OK Pre-commit Komerce tiers 1-5 termine en $((TOTAL_END - TOTAL_START)) ms"
HOOK

chmod +x "$PRE_COMMIT"

echo "OK Hooks Komerce - niveaux 1-5 installes."
echo "   pre-commit : technique + registry + schema + Boutique source + tests unitaires lies"
echo "   pre-push   : toujours desactive"
echo "   lourds     : Carte First complet / rebuild CSS-dist / coverage / integration / E2E / 360 / meta en pause"
echo "   timings    : affiches gate par gate a chaque commit"