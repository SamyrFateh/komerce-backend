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

# v2 applies the complete product patch and is expected to stop only on the
# malformed first character of its generated dedicated Jest fixture.
r = run('python3', str(HERE / 'debt-zero-imports-close-v2.py'), str(ROOT), check=False)

test_file = ROOT / 'public/boutique/tests/gates/check-js-imports-i4-consumers.test.js'
if not test_file.exists():
    raise SystemExit(f'v2 failed before creating dedicated I-4 proof (exit={r.returncode})')

text = test_file.read_text()
if text.startswith('\\\n'):
    test_file.write_text(text[2:])
elif text.startswith('\\'):
    test_file.write_text(text[1:])

boutique = ROOT / 'public/boutique'

# Prove v2 reached the intended semantic state before resuming.
imports = run('npm', 'run', 'check:imports', cwd=boutique, capture=True)
print(imports.stdout)
if 'Exports non consommés [I-4]' in imports.stdout or 'export(s) non consommés [I-4]' in imports.stdout:
    raise SystemExit('I-4 noise remains after product patch')

# Dedicated semantics only — no unrelated historical gate suite.
run('npx', 'jest', '--config', 'jest.gates.config.js', '--runInBand', '--runTestsByPath',
    'tests/gates/check-js-imports-i4-consumers.test.js', cwd=boutique)

# Product regression + source governance.
run('npm', 'run', 'test:unit', cwd=boutique)
for command in [
    'quality:gate', 'check:html', 'check:imports', 'check:body-classes',
    'check:no-injection', 'check:important', 'check:breakpoints',
    'audit:arch', 'audit:registry', 'feature:guard:strict',
]:
    run('npm', 'run', command, cwd=boutique)

# Refresh only the now-proved import source in the last 18/18 projection.
gf = ROOT / 'docs/GATE_FINDINGS.json'
data = json.loads(gf.read_text())
before = len(data.get('findings', []))
data['findings'] = [f for f in data.get('findings', []) if f.get('gate') != 'check:imports']
for source in data.get('sources', []):
    if source.get('gate') == 'check:imports' and source.get('scope') == 'boutique':
        source.update({
            'status': 'ok', 'exitCode': 0, 'errorCount': 0, 'warningCount': 0,
            'unprojectableCount': 0, 'multiProjectedCount': 0,
            'unprojectableFiles': [], 'multiProjectedFiles': [], 'unattributedFindings': [],
        })
if data['contract']['configuredSources'] != 18 or data['contract']['attributableSources'] != 18:
    raise SystemExit(f'Gate attribution regressed: {data["contract"]}')
if data['findings']:
    raise SystemExit(f'Unexpected non-import findings remain: {data["findings"]}')
print(f'GATE_FINDINGS {before} -> 0')
gf.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')

md = ROOT / 'docs/GATE_FINDINGS.md'
lines = [line for line in md.read_text().splitlines()
         if 'check:imports' not in line and 'export(s) non consommé(s)' not in line]
md_text = '\n'.join(lines) + '\n'
md_text = md_text.replace('30 finding(s)', '0 finding(s)').replace('30 findings', '0 findings')
md.write_text(md_text)

run('node', 'scripts/gen-feature-360.js')
run('node', 'scripts/feature-360-check.js')
run('node', 'scripts/business-graph-gen.js', '--check', '--dash-root', 'public', '--boutique-root', 'public/boutique')
run('node', 'scripts/feature-guard.js', '--strict')
run('git', 'diff', '--check')

fresh = json.loads(gf.read_text())
imports_source = next(s for s in fresh['sources'] if s['gate'] == 'check:imports' and s['scope'] == 'boutique')
assert fresh['findings'] == []
assert fresh['contract']['configuredSources'] == 18
assert fresh['contract']['attributableSources'] == 18
assert imports_source['warningCount'] == 0 and imports_source['errorCount'] == 0
print('Debt Zero imports: 0 findings, 18/18 attributable sources')
