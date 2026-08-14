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

# Le pre-push historique (impact/coffre-fort) reste volontairement en pause.
pause_managed_hook "$PRE_PUSH"

# Ne jamais ecraser un hook pre-commit personnel.
if [[ -f "$PRE_COMMIT" ]] && ! is_managed_hook "$PRE_COMMIT"; then
  echo "Hook pre-commit personnel detecte - installation Komerce ignoree."
  echo "Fichier conserve: ${PRE_COMMIT#$ROOT/}"
  exit 0
fi

cat > "$PRE_COMMIT" << 'HOOK'
#!/bin/bash
# KOMERCE-HOOK v3 - tiers-1-2-targeted
# Objectif: controles techniques rapides et registre cible uniquement.
# Pas de generation d'artefacts, pas de Carte First complet, pas de DB drift,
# pas de CSS rebuild/check:fast, pas de graphes 360, pas de pre-push impact.
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

# N1-A - Qualite JS statique.
if echo "$STAGED" | grep -Eq '\.(js|cjs|mjs)$'; then
  run_gate "Qualite JS" node scripts/code-quality-gate.js --strict
fi

# N1-B - Invariants backend.
if echo "$STAGED" | grep -Eq '^(server\.js|routes/|services/|middleware/|utils/|scripts/|config/).+\.(js|cjs|mjs)$|^server\.js$'; then
  run_gate "Invariants backend" node scripts/audit-backend-arch.js
fi

# N1-C - XSS prouvable sur les seules lignes front staged.
if echo "$STAGED" | grep -Eq '^public/.+\.(js|cjs|mjs)$'; then
  run_gate "Sanitization front staged" node scripts/arch-doctrine-sanitize-check.js
fi

# N2-A - Registre de features, uniquement si son perimetre peut avoir change.
# Lecture seule : aucune generation d'artefact ni modification du working tree.
if echo "$STAGED" | grep -Eq '^(features|capabilities|services|routes|migrations|middleware|utils|validators|core|bootstrap|db)/|^\.github/.+\.(yml|yaml|md)$'; then
  run_gate "Feature Registry" node scripts/feature-registry-check.js --strict
fi

TOTAL_END="$(now_ms)"
echo "OK Pre-commit Komerce tiers 1-2 termine en $((TOTAL_END - TOTAL_START)) ms"
HOOK

chmod +x "$PRE_COMMIT"

echo "OK Hooks Komerce - niveaux 1-2 installes."
echo "   pre-commit : qualite JS + invariants backend + XSS staged + Feature Registry cible"
echo "   pre-push   : toujours desactive"
echo "   lourds     : Carte First complet / DB / CSS / 360 / meta toujours en pause"
echo "   timings    : affiches gate par gate a chaque commit"
