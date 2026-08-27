#!/usr/bin/env python3
from pathlib import Path
import json
import subprocess
import sys

ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
HERE = Path(__file__).resolve().parent


def run(*args, cwd=None, capture=False, check=True):
    print('+', ' '.join(str(a) for a in args), flush=True)
    return subprocess.run(args, cwd=cwd or ROOT, check=check, text=True,
                          capture_output=capture)

# v5 performs the complete patch + semantic proof + related tests + Boutique
# source gates and reaches GATE_FINDINGS 30 -> 0. On current repo it stops only
# because it assumed a non-existent docs/GATE_FINDINGS.md companion file.
r = run('python3', str(HERE / 'debt-zero-imports-close-v5.py'), str(ROOT), check=False)

gf = ROOT / 'docs/GATE_FINDINGS.json'
if not gf.exists():
    raise SystemExit(f'v5 failed before producing GATE_FINDINGS.json (exit={r.returncode})')
data = json.loads(gf.read_text())
if data.get('findings') != []:
    raise SystemExit(f'v5 failed before Debt Zero findings: {data.get("findings")}')
if data['contract']['configuredSources'] != 18 or data['contract']['attributableSources'] != 18:
    raise SystemExit(f'Gate attribution regressed: {data["contract"]}')
imports_source = next((s for s in data['sources'] if s.get('gate') == 'check:imports' and s.get('scope') == 'boutique'), None)
if not imports_source or imports_source.get('warningCount') != 0 or imports_source.get('errorCount') != 0:
    raise SystemExit(f'Imports source not clean: {imports_source}')

# Source-of-truth proof after the v5 stop point. There is intentionally no
# Markdown companion to update: GATE_FINDINGS.json is the repository artifact.
boutique = ROOT / 'public/boutique'
imports = run('npm', 'run', 'check:imports', cwd=boutique, capture=True)
print(imports.stdout)
if 'Exports non consommés [I-4]' in imports.stdout or 'export(s) non consommés [I-4]' in imports.stdout:
    raise SystemExit('I-4 noise returned')

run('node', 'scripts/gen-feature-360.js')
run('node', 'scripts/feature-360-check.js')
run('node', 'scripts/business-graph-gen.js', '--check', '--dash-root', 'public', '--boutique-root', 'public/boutique')
run('node', 'scripts/feature-guard.js', '--strict')
run('git', 'diff', '--check')

fresh = json.loads(gf.read_text())
assert fresh['findings'] == []
assert fresh['contract']['configuredSources'] == 18
assert fresh['contract']['attributableSources'] == 18
imports_source = next(s for s in fresh['sources'] if s['gate'] == 'check:imports' and s['scope'] == 'boutique')
assert imports_source['warningCount'] == 0 and imports_source['errorCount'] == 0
print('Debt Zero imports FINAL: 0 findings, 18/18 attributable sources')
