#!/bin/bash
set -e
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  KOMERCE DASHBOARDS — Installation hook pre-commit      ║"
echo "╚══════════════════════════════════════════════════════════╝"
mkdir -p .git/hooks 2>/dev/null || true
cat > .git/hooks/pre-commit << 'PCHOOK'
#!/bin/bash
set -e
echo "🛡️ Dashboards — gouvernance pre-commit..."
node scripts/code-quality-gate.js --strict
node scripts/arch-check.js --strict
node scripts/feature-guard.js --strict
node scripts/feature-registry-check.js --strict
echo "✅ Gouvernance OK (N2+N4+N5+N0)."
PCHOOK
chmod +x .git/hooks/pre-commit
echo "✅ Hook pre-commit installé."
