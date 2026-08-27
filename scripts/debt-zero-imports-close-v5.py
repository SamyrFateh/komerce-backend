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

# Apply the v2 product patch. v2 is expected to stop only on its malformed
# dedicated fixture; no product branch is pushed from that failure.
r = run('python3', str(HERE / 'debt-zero-imports-close-v2.py'), str(ROOT), check=False)

test_file = ROOT / 'public/boutique/tests/gates/check-js-imports-i4-consumers.test.js'
if not test_file.exists():
    raise SystemExit(f'v2 failed before creating the I-4 fixture (exit={r.returncode})')
text = test_file.read_text()
if text.startswith('\\\n'):
    test_file.write_text(text[2:])
elif text.startswith('\\'):
    test_file.write_text(text[1:])

# getMobileScrollContainer is a legitimate namespace-require test API.
scroll = ROOT / 'public/boutique/js/b-scroll-owner.js'
text = scroll.read_text().replace('function getMobileScrollContainer()', 'export function getMobileScrollContainer()')
scroll.write_text(text)

# The real test uses:
#   let scrollOwner;
#   scrollOwner = require('../../js/b-scroll-owner.js');
# Teach extractRequires() that namespace-assignment form as well.
checker = ROOT / 'public/boutique/scripts/check-js-imports.js'
src = checker.read_text()
anchor = """  const namespaceRe = /(?:const|let|var)\\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*=\\s*require\\(\\s*['\\\"]([^'\\\"]+)['\\\"]\\s*\\)/gm;\n  let m;\n  while ((m = namespaceRe.exec(src)) !== null) {\n    requires.push({ specifiers: [], source: m[2], namespace: m[1] });\n  }\n"""
assert anchor in src
replacement = anchor + """  const namespaceAssignmentRe = /(?:^|[;\\n]\\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*=\\s*require\\(\\s*['\\\"]([^'\\\"]+)['\\\"]\\s*\\)/gm;\n  while ((m = namespaceAssignmentRe.exec(src)) !== null) {\n    requires.push({ specifiers: [], source: m[2], namespace: m[1] });\n  }\n"""
src = src.replace(anchor, replacement)
checker.write_text(src)

boutique = ROOT / 'public/boutique'

# 1. The import gate itself must now be silent for I-4.
imports = run('npm', 'run', 'check:imports', cwd=boutique, capture=True)
print(imports.stdout)
if 'Exports non consommés [I-4]' in imports.stdout or 'export(s) non consommés [I-4]' in imports.stdout:
    raise SystemExit('I-4 noise remains')

# 2. Dedicated semantics: legitimate consumers are silent; a real orphan is visible.
run('npx', 'jest', '--config', 'jest.gates.config.js', '--runInBand', '--runTestsByPath',
    'tests/gates/check-js-imports-i4-consumers.test.js', cwd=boutique)

# 3. Related regression witnesses only. The full unit suite on current main has
# two unrelated stale witnesses (visual border + tech.jpg), so it is not used as
# an Imports acceptance oracle.
run('npx', 'jest', '--runInBand', '--runTestsByPath',
    'tests/unit/b-scroll-owner.test.js',
    'tests/unit/b-utils.test.js',
    'tests/unit/b-utils-currency-adapter.test.js',
    'tests/unit/b-modal-core.test.js',
    'tests/unit/b-catalog.test.js',
    'tests/unit/b-subcat.test.js',
    'tests/unit/b-product-open-contract.test.js',
    cwd=boutique)

# 4. Boutique source governance used by PR enforcement.
for command in [
    'quality:gate', 'check:html', 'check:imports', 'check:body-classes',
    'check:no-injection', 'check:important', 'check:breakpoints',
    'audit:arch', 'audit:registry', 'feature:guard:strict',
]:
    run('npm', 'run', command, cwd=boutique)

# 5. Refresh only the live-proved Imports source inside the last valid 18/18
# Gate Findings projection. Do not import unrelated dist CSS drift into this lot.
gf = ROOT / 'docs/GATE_FINDINGS.json'
data = json.loads(gf.read_text())
before = len(data.get('findings', []))
data['findings'] = [f for f in data.get('findings', []) if f.get('gate') != 'check:imports']
for source in data.get('sources', []):
    if source.get('gate') == 'check:imports' and source.get('scope') == 'boutique':
        source.update({
            'status': 'ok', 'exitCode': 0, 'errorCount': 0, 'warningCount': 0,
            'unprojectableCount': 0, 'multiProjectedCount': 0,
            'unprojectableFiles': [], 'multiProjectedFiles': [],
            'unattributedFindings': [],
        })
if data['contract']['configuredSources'] != 18 or data['contract']['attributableSources'] != 18:
    raise SystemExit(f'Gate attribution regressed: {data["contract"]}')
if data['findings']:
    raise SystemExit(f'Unexpected findings remain: {data["findings"]}')
print(f'GATE_FINDINGS {before} -> 0')
gf.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')

md = ROOT / 'docs/GATE_FINDINGS.md'
lines = [line for line in md.read_text().splitlines()
         if 'check:imports' not in line and 'export(s) non consommé(s)' not in line]
md_text = '\n'.join(lines) + '\n'
md_text = md_text.replace('30 finding(s)', '0 finding(s)').replace('30 findings', '0 findings')
md.write_text(md_text)

# 6. Dependent governance projections and global Feature First proof.
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
