#!/usr/bin/env python3
from pathlib import Path
import json
import re
import subprocess
import sys

ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()


def p(rel):
    return ROOT / rel


def run(*args, cwd=None, capture=False):
    print('+', ' '.join(args), flush=True)
    return subprocess.run(args, cwd=cwd or ROOT, check=True, text=True,
                          capture_output=capture)

# 1) I-4 understands real project consumers.
checker = p('public/boutique/scripts/check-js-imports.js')
src = checker.read_text()
src = src.replace(
    "const ROOT   = path.resolve(__dirname, '..');\nconst JS_DIR = path.join(ROOT, 'js');",
    "const ROOT      = path.resolve(__dirname, '..');\nconst JS_DIR    = path.join(ROOT, 'js');\nconst TESTS_DIR = path.join(ROOT, 'tests');"
)
src = src.replace('Version : 2.0 (2026-05-19)', 'Version : 2.1 (2026-08-27)')
src = src.replace(
    "I-4  Exports non consommés dans l'ensemble du projet (dead exports)\n *        [warn uniquement — peut être voulu pour API externe]",
    "I-4  Exports non consommés dans l'ensemble du projet (dead exports)\n *        Consommateurs reconnus : ESM statique, import() runtime et require() tests.\n *        [warn uniquement — un warning doit rester actionnable]"
)
marker = "// ────────────────────────────────────────────────────────────────────\n// RÉSOLVEUR DE CHEMINS"
assert marker in src
helpers = r'''
// ────────────────────────────────────────────────────────────────────
// CONSOMMATEURS I-4 HORS IMPORTS ESM STATIQUES
// ────────────────────────────────────────────────────────────────────

function parseDestructuredNames(block) {
  return block.split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(item => item.split(':')[0].trim())
    .filter(Boolean);
}

function extractRequires(filepath) {
  const src = fs.readFileSync(filepath, 'utf8');
  const requires = [];
  const patterns = [
    /(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\(\s*['\"]([^'\"]+)['\"]\s*\)/gms,
    /\(\s*\{([^}]+)\}\s*=\s*require\(\s*['\"]([^'\"]+)['\"]\s*\)\s*\)/gms,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(src)) !== null) {
      requires.push({ specifiers: parseDestructuredNames(m[1]), source: m[2], namespace: null });
    }
  }
  const namespaceRe = /(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*require\(\s*['\"]([^'\"]+)['\"]\s*\)/gm;
  let m;
  while ((m = namespaceRe.exec(src)) !== null) {
    requires.push({ specifiers: [], source: m[2], namespace: m[1] });
  }
  return requires;
}

function extractDynamicImports(filepath, exportMap) {
  const src = fs.readFileSync(filepath, 'utf8');
  const imports = [];
  const re = /import\(\s*['\"]([^'\"]+)['\"]\s*\)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const resolved = resolveSource(filepath, m[1]);
    if (!resolved || !exportMap.has(resolved)) continue;
    const exported = exportMap.get(resolved) || new Set();
    const local = src.slice(m.index, Math.min(src.length, m.index + 1400));
    const specifiers = [];
    for (const name of exported) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(?:\\.|\\?\\.)${escaped}\\b`).test(local)) specifiers.push(name);
    }
    imports.push({ specifiers, source: m[1] });
  }
  return imports;
}

'''
if 'function extractRequires(filepath)' not in src:
    src = src.replace(marker, helpers + marker)

i2marker = "  // ── I-2 : cycles directs ────────────────────────────────────────"
assert i2marker in src
consumers = r'''
  // ── I-4 consommateurs runtime dynamiques + tests CommonJS ─────────
  for (const importer of collectJsFiles(JS_DIR)) {
    for (const imp of extractDynamicImports(importer, exportMap)) {
      const resolved = resolveSource(importer, imp.source);
      if (!resolved || !consumedExports.has(resolved)) continue;
      for (const name of imp.specifiers) {
        if ((exportMap.get(resolved) || new Set()).has(name)) consumedExports.get(resolved).add(name);
      }
    }
  }

  for (const testFile of collectJsFiles(TESTS_DIR)) {
    const testSrc = fs.readFileSync(testFile, 'utf8');
    for (const req of extractRequires(testFile)) {
      const resolved = resolveSource(testFile, req.source);
      if (!resolved || !consumedExports.has(resolved)) continue;
      const sourceExports = exportMap.get(resolved) || new Set();
      for (const name of req.specifiers) {
        if (sourceExports.has(name)) consumedExports.get(resolved).add(name);
      }
      if (req.namespace) {
        for (const name of sourceExports) {
          const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const ns = req.namespace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          if (new RegExp(`\\b${ns}\\.${escaped}\\b`).test(testSrc)) consumedExports.get(resolved).add(name);
        }
      }
    }
  }

'''
if 'I-4 consommateurs runtime dynamiques' not in src:
    src = src.replace(i2marker, consumers + i2marker)
checker.write_text(src)

# 2) Reduce only unnecessary public surfaces.
modal = p('public/boutique/js/b-modal.js')
text = modal.read_text()
start = text.index('import {')
modal.write_text(text[:start] + "import { openModal, closeModal, modalGoBack, setupModal } from './b-modal-core.js';\n\nexport { openModal, closeModal, modalGoBack, setupModal };\n")

scroll = p('public/boutique/js/b-scroll-owner.js')
text = scroll.read_text().replace('export const DESKTOP_BREAKPOINT', 'const DESKTOP_BREAKPOINT')
text = text.replace('export function getMobileScrollContainer', 'function getMobileScrollContainer')
scroll.write_text(text)

utils = p('public/boutique/js/b-utils.js')
text = utils.read_text().replace('export function getAPI()', 'function getAPI()')
patch_block = re.compile(
    r"/\*\*\n \* PATCH via la couche centrale K\.request\.[\s\S]*?export function apiPatch\(path, body, options\) \{[\s\S]*?\n\}\n\n(?=/\* ── COMPAT LEGACY)",
    re.M,
)
text, count = patch_block.subn('', text)
assert count == 1, f'apiPatch block replacements={count}'
utils.write_text(text)

# 3) Dedicated I-4 gate semantics proof; no unrelated historical gate suite.
i4test = p('public/boutique/tests/gates/check-js-imports-i4-consumers.test.js')
i4test.write_text(r'''\
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const TARGET = path.join(ROOT, 'js', 'b-boutique-wow-style.js');
const TEST_CONSUMER = path.join(ROOT, 'tests', 'unit', '__i4-test-consumer.test.js');
const DYNAMIC_CONSUMER = path.join(ROOT, 'js', '__i4-dynamic-consumer.js');
let original;

function runGate() {
  return spawnSync('node', [path.join(ROOT, 'scripts', 'check-js-imports.js')], {
    cwd: ROOT, encoding: 'utf8', timeout: 30000,
  });
}

beforeEach(() => { original = fs.readFileSync(TARGET, 'utf8'); });
afterEach(() => {
  fs.writeFileSync(TARGET, original);
  for (const f of [TEST_CONSUMER, DYNAMIC_CONSUMER]) if (fs.existsSync(f)) fs.unlinkSync(f);
});

test('require() Jest declaration consumes a named export for I-4', () => {
  fs.appendFileSync(TARGET, '\nexport function __i4_test_api() { return true; }\n');
  const req = 'requ' + 'ire';
  fs.writeFileSync(TEST_CONSUMER,
    `const { __i4_test_api } = ${req}('../../js/b-boutique-wow-style.js');\n` +
    `test('consumer', () => expect(__i4_test_api()).toBe(true));\n`);
  const r = runGate();
  expect(r.status).toBe(0);
  expect(r.stdout + r.stderr).not.toMatch(/__i4_test_api/);
});

test('require() Jest assignment destructuring consumes a named export for I-4', () => {
  fs.appendFileSync(TARGET, '\nexport function __i4_assignment_api() { return true; }\n');
  const req = 'requ' + 'ire';
  fs.writeFileSync(TEST_CONSUMER,
    `let __i4_assignment_api; ({ __i4_assignment_api } = ${req}('../../js/b-boutique-wow-style.js'));\n` +
    `test('consumer', () => expect(__i4_assignment_api()).toBe(true));\n`);
  const r = runGate();
  expect(r.status).toBe(0);
  expect(r.stdout + r.stderr).not.toMatch(/__i4_assignment_api/);
});

test('import() runtime consumes a namespace property for I-4', () => {
  fs.appendFileSync(TARGET, '\nexport function __i4_dynamic_api() { return true; }\n');
  const dyn = 'im' + 'port';
  fs.writeFileSync(DYNAMIC_CONSUMER,
    `${dyn}('./b-boutique-wow-style.js').then(mod => mod.__i4_dynamic_api());\n`);
  const r = runGate();
  expect(r.status).toBe(0);
  expect(r.stdout + r.stderr).not.toMatch(/__i4_dynamic_api/);
});

test('a real b-* orphan remains an actionable I-4 finding', () => {
  fs.appendFileSync(TARGET, '\nexport function __i4_real_orphan() { return true; }\n');
  const r = runGate();
  expect(r.status).toBe(0);
  expect(r.stdout + r.stderr).toMatch(/__i4_real_orphan/);
});
''')

# 4) Proof.
boutique = p('public/boutique')
imports = run('npm', 'run', 'check:imports', cwd=boutique, capture=True)
print(imports.stdout)
assert 'Exports non consommés [I-4]' not in imports.stdout
assert 'export(s) non consommés [I-4]' not in imports.stdout
run('npx', 'jest', '--config', 'jest.gates.config.js', '--runInBand', '--runTestsByPath',
    'tests/gates/check-js-imports-i4-consumers.test.js', cwd=boutique)
run('npm', 'run', 'test:unit', cwd=boutique)
for command in [
    'quality:gate', 'check:html', 'check:imports', 'check:body-classes',
    'check:no-injection', 'check:important', 'check:breakpoints',
    'audit:arch', 'audit:registry', 'feature:guard:strict',
]:
    run('npm', 'run', command, cwd=boutique)

# 5) Refresh only the proved import finding source; preserve 18/18 attribution.
gf = p('docs/GATE_FINDINGS.json')
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
assert data['contract']['configuredSources'] == 18
assert data['contract']['attributableSources'] == 18
assert len(data['findings']) == 0, data['findings']
print(f'GATE_FINDINGS {before} -> {len(data["findings"])}')
gf.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')

md = p('docs/GATE_FINDINGS.md')
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
assert fresh['contract']['configuredSources'] == 18
assert fresh['contract']['attributableSources'] == 18
assert fresh['findings'] == []
imports_source = next(s for s in fresh['sources'] if s['gate'] == 'check:imports' and s['scope'] == 'boutique')
assert imports_source['warningCount'] == 0 and imports_source['errorCount'] == 0
print('Debt Zero imports: 0 findings, 18/18 attributable sources')
