#!/bin/bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$ROOT" ]]; then
  echo "⚠️  Hors dépôt Git — hooks Komerce inchangés."
  exit 0
fi

HOOKS_DIR="$ROOT/.git/hooks"

pause_managed_hook() {
  local hook="$1"
  local backup="${hook}.komerce-paused"

  [[ -f "$hook" ]] || return 0
  if ! grep -Eqi 'KOMERCE|Coffre-fort Komerce|reprise gouvernance' "$hook"; then
    echo "↪ Hook personnel conservé: ${hook#$ROOT/}"
    return 0
  fi

  if [[ ! -e "$backup" ]]; then
    mv "$hook" "$backup"
    echo "⏸ Hook Komerce mis en pause: ${hook#$ROOT/}"
  else
    rm -f "$hook"
    echo "⏸ Hook Komerce déjà sauvegardé, copie active retirée: ${hook#$ROOT/}"
  fi
}

pause_managed_hook "$HOOKS_DIR/pre-commit"
pause_managed_hook "$HOOKS_DIR/pre-push"

echo "✅ Gates locaux Komerce en pause. Aucun hook personnel n'a été supprimé."
echo "   Sauvegardes éventuelles: .git/hooks/*.komerce-paused"
