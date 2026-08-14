#!/bin/bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$ROOT" ]]; then
  echo "⚠️  Hors dépôt Git — hooks Komerce inchangés."
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
    echo "↪ Hook personnel conservé: ${hook#$ROOT/}"
    return 0
  fi

  if [[ ! -e "$backup" ]]; then
    mv "$hook" "$backup"
    echo "⏸ Ancien hook Komerce sauvegardé: ${backup#$ROOT/}"
  else
    rm -f "$hook"
    echo "⏸ Ancien hook Komerce retiré; sauvegarde déjà présente."
  fi
}

# Le pre-push historique (impact/coffre-fort) reste volontairement en pause.
pause_managed_hook "$PRE_PUSH"

# Ne jamais écraser un hook pre-commit personnel.
if [[ -f "$PRE_COMMIT" ]] && ! is_managed_hook "$PRE_COMMIT"; then
  echo "⚠️  Hook pre-commit personnel détecté — installation Komerce ignorée."
  echo "   Fichier conservé: ${PRE_COMMIT#$ROOT/}"
  exit 0
fi

cat > "$PRE_COMMIT" << 'HOOK'
#!/bin/bash
# KOMERCE-HOOK v2 — tier-1-fast
# Objectif: contrôles techniques rapides uniquement.
# Pas de génération d'artefacts, pas de Carte First, pas de DB drift,
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
    echo "❌ $label — échec (${elapsed} ms)"
    [[ -n "$output" ]] && echo "$output"
    exit "$rc"
  fi

  echo "✅ $label (${elapsed} ms)"
}

TOTAL_START="$(now_ms)"
STAGED="$(git diff --cached --name-only --diff-filter=ACMR || true)"

if [[ -z "$STAGED" ]]; then
  echo "✅ Pre-commit Komerce rapide : aucun fichier staged."
  exit 0
fi

# N1-A — Qualité JS statique. Le gate est très rapide et ne modifie aucun fichier.
if echo "$STAGED" | grep -Eq '\.(js|cjs|mjs)$'; then
  run_gate "Qualité JS" node scripts/code-quality-gate.js --strict
fi

# N1-B — Invariants backend. Uniquement si du code backend/outillage JS est touché.
if echo "$STAGED" | grep -Eq '^(server\.js|routes/|services/|middleware/|utils/|scripts/|config/).+\.(js|cjs|mjs)$|^server\.js$'; then
  run_gate "Invariants backend" node scripts/audit-backend-arch.js
fi

# N1-C — XSS prouvable sur les seules lignes front staged.
if echo "$STAGED" | grep -Eq '^public/.+\.(js|cjs|mjs)$'; then
  run_gate "Sanitization front staged" node scripts/arch-doctrine-sanitize-check.js
fi

TOTAL_END="$(now_ms)"
echo "⚡ Pre-commit Komerce tier 1 terminé en $((TOTAL_END - TOTAL_START)) ms"
HOOK

chmod +x "$PRE_COMMIT"

echo "✅ Hooks Komerce — niveau 1 réactivé."
echo "   pre-commit : qualité JS + invariants backend + XSS staged (selon fichiers touchés)"
echo "   pre-push   : toujours désactivé"
echo "   lourds     : Carte First / DB / CSS / 360 / meta toujours en pause"
echo "   timings    : affichés à chaque commit avant toute réactivation suivante"
