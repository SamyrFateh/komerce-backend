#!/usr/bin/env bash
# GOV-03 — npm audit gate
#
# Usage:
#   npm run audit:gate          # bloquant (exit 1 si high/critical)
#   npm run audit:gate:observe  # observatoire (exit 0 toujours, log seulement)
#
# Câblage package.json :
#   "audit:gate": "bash scripts/npm-audit-gate.sh",
#   "audit:gate:observe": "bash scripts/npm-audit-gate.sh --observe"
#
# Câblage CI (GitHub Actions) :
#   - name: npm audit (high/critical)
#     run: npm run audit:gate
#
set -euo pipefail

MODE="blocking"
if [[ "${1:-}" == "--observe" ]]; then
  MODE="observe"
fi

echo "╔══════════════════════════════════════════════════════════╗"
echo "║  GOV-03 — npm audit gate (mode: $MODE)                  ║"
echo "╚══════════════════════════════════════════════════════════╝"

# Run npm audit, capture exit code
set +e
OUTPUT=$(npm audit --audit-level=high 2>&1)
AUDIT_EXIT=$?
set -e

echo "$OUTPUT"

if [ $AUDIT_EXIT -eq 0 ]; then
  echo ""
  echo "✅ npm audit: 0 high/critical vulnerabilities"
  exit 0
fi

echo ""
echo "⚠️  npm audit: high/critical vulnerabilities detected"

if [ "$MODE" = "observe" ]; then
  echo "ℹ️  Mode observe — pas de blocage CI"
  exit 0
else
  echo "❌ Mode bloquant — CI fail"
  echo ""
  echo "Fix: npm audit fix"
  echo "Exception: ajouter une exception datée dans scripts/npm-audit-exceptions.json"
  exit 1
fi
