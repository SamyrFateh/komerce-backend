#!/usr/bin/env node
'use strict';

/**
 * scripts/feature-reliability-report.js — Projection de fiabilité par feature.
 *
 * NE CRÉE AUCUNE CARTOGRAPHIE. Joint deux choses qui existent déjà :
 *   1. features/*.feature.js  (files.tests, invariants, status)  = source de vérité métier
 *   2. les rapports --json de Jest                               = preuve réellement exécutée
 *
 * Sémantique stricte (mission §8/§15) :
 *   PASS         le fichier a été exécuté et est vert
 *   FAIL         le fichier a été exécuté et est rouge
 *   NOT_RUN      le fichier existe, est rattaché, mais aucune campagne ne l'a exécuté
 *   NONE         la feature ne déclare aucun test de ce niveau
 *   MISSING_FILE le manifest déclare un test qui n'existe plus sur disque
 *
 * NOT_RUN n'est jamais compté comme PASS. Un niveau NONE n'est jamais compté
 * comme une réussite.
 *
 * Usage :
 *   node scripts/feature-reliability-report.js --results a.json,b.json [--json]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');

function argValue(name) {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

// ── 1. Résultats réellement exécutés ────────────────────────────────────────
function loadResults(files) {
  const byFile = new Map();
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    const report = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const suite of report.testResults || []) {
      const rel = path.relative(ROOT, suite.name).replace(/\\/g, '/');
      const failed = (suite.assertionResults || []).filter((a) => a.status === 'failed');
      byFile.set(rel, {
        status: suite.status === 'failed' || failed.length ? 'FAIL' : 'PASS',
        failedTests: failed.map((a) => a.fullName),
        total: (suite.assertionResults || []).length,
      });
    }
  }
  return byFile;
}

// ── 2. Classement d'un test par son emplacement (convention existante) ──────
// C'est la convention de répertoires du repo qui porte déjà le niveau de
// preuve — on ne réinvente pas de taxonomie.
function levelOf(testPath) {
  if (testPath.startsWith('tests/unit/')) return 'unit';
  if (testPath.startsWith('tests/integration/')) return 'integration';
  if (testPath.startsWith('tests/e2e-api/')) return 'e2e';
  if (testPath.startsWith('tests/invariants/')) return 'invariant';
  if (testPath.startsWith('tests/contract/')) return 'contract';
  if (testPath.startsWith('tests/notifications/')) return 'unit';
  return 'other';
}

// ── 3. Agrégation d'un niveau ───────────────────────────────────────────────
function aggregate(files, results) {
  if (!files.length) return { verdict: 'NONE', files: [], fails: [] };
  let anyFail = false;
  let anyNotRun = false;
  let anyMissing = false;
  const fails = [];
  for (const f of files) {
    if (!fs.existsSync(path.join(ROOT, f))) { anyMissing = true; continue; }
    const r = results.get(f);
    if (!r) { anyNotRun = true; continue; }
    if (r.status === 'FAIL') { anyFail = true; fails.push({ file: f, tests: r.failedTests }); }
  }
  let verdict;
  if (anyFail) verdict = 'FAIL';
  else if (anyMissing) verdict = 'MISSING_FILE';
  else if (anyNotRun) verdict = 'NOT_RUN';
  else verdict = 'PASS';
  return { verdict, files, fails };
}

// ── 4. Verdict de fiabilité ─────────────────────────────────────────────────
// Le niveau de preuve exigible dépend de ce que fait la feature : on ne
// fabrique pas une obligation E2E universelle (mission §2). La règle est
// uniquement : un FAIL domine ; une preuve déclarée mais non exécutée
// dégrade ; une absence totale de preuve dégrade.
function verdictFor(levels, isCritical, feature) {
  // Un manifest `deprecated` volontairement vidé (périmètre transféré à
  // d'autres features) est une pierre tombale, pas une feature non prouvée :
  // il n'a plus de runtime propre à prouver. Le confondre avec UNPROVEN
  // fabrique une fausse alerte — exactement ce que la mission interdit.
  if (feature && feature.status === 'deprecated'
      && !(feature.files && Object.keys(feature.files).length)) {
    return 'DEPRECATED_TOMBSTONE';
  }
  const vals = Object.values(levels).map((l) => l.verdict);
  if (vals.includes('FAIL')) return 'AT_RISK';
  if (vals.includes('MISSING_FILE')) return 'AT_RISK';
  const real = Object.entries(levels).filter(([, l]) => l.verdict !== 'NONE');
  if (!real.length) return 'UNPROVEN';
  if (vals.includes('NOT_RUN')) return 'PARTIAL';
  // Preuve exécutée et verte partout où elle est déclarée.
  if (isCritical) {
    const deep = ['integration', 'e2e', 'invariant']
      .some((k) => levels[k] && levels[k].verdict === 'PASS');
    return deep ? 'PROVEN' : 'PARTIAL';
  }
  return 'PROVEN';
}

// Features dont un invariant porte sur de l'argent, du stock ou une
// transition d'état irréversible : le vert unitaire seul n'y suffit pas.
const CRITICAL = new Set([
  'orders', 'payments', 'wallet', 'refunds', 'inventory', 'loyalty',
  'wallet-loyalty', 'purchasing', 'shared-cart', 'economic-engine', 'customs',
]);

function main() {
  const resultFiles = (argValue('results') || '').split(',').filter(Boolean);
  const results = loadResults(resultFiles);

  const manifests = fs.readdirSync(path.join(ROOT, 'features'))
    .filter((n) => n.endsWith('.feature.js')).sort();

  const rows = [];
  for (const m of manifests) {
    const feature = require(path.join(ROOT, 'features', m));
    // Un manifest rattache ses tests par DEUX canaux : files.tests et
    // invariants[].test. Ils ne sont pas synchronisés dans le repo (constat
    // 2026-08) — un invariant exécutable peut n'exister que dans le second.
    // On lit donc les deux, sans en privilégier un : ce sont deux
    // déclarations d'appartenance également valides.
    const fromFiles = (feature.files && feature.files.tests) || [];
    const fromInvariants = (feature.invariants || [])
      .filter((i) => i && typeof i === 'object' && i.test).map((i) => i.test);
    const declared = [...new Set([...fromFiles, ...fromInvariants])];
    const buckets = { unit: [], integration: [], e2e: [], invariant: [], contract: [], other: [] };
    for (const t of declared) (buckets[levelOf(t)] || buckets.other).push(t);

    const levels = {};
    for (const [k, v] of Object.entries(buckets)) levels[k] = aggregate(v, results);

    // Invariants exécutables déclarés dans le manifest (statement + test).
    const execInvariants = (feature.invariants || [])
      .filter((i) => i && typeof i === 'object' && i.test)
      .map((i) => ({ statement: i.statement, test: i.test, ran: results.has(i.test) }));

    rows.push({
      name: feature.name || m.replace('.feature.js', ''),
      status: feature.status,
      declaredTests: declared.length,
      missing: declared.filter((t) => !fs.existsSync(path.join(ROOT, t))),
      notRun: declared.filter((t) => fs.existsSync(path.join(ROOT, t)) && !results.has(t)),
      levels,
      execInvariants,
      verdict: verdictFor(levels, CRITICAL.has(feature.name), feature),
    });
  }

  if (JSON_OUT) { console.log(JSON.stringify(rows, null, 2)); return; }

  const cell = (l) => (l.verdict === 'NONE' ? '—' : l.verdict);
  const pad = (s, n) => String(s).padEnd(n);
  console.log('feature              | tests | unit     | integ    | e2e      | invariant| verdict');
  console.log('-'.repeat(92));
  for (const r of rows) {
    console.log(
      `${pad(r.name, 20)} | ${pad(r.declaredTests, 5)} | ${pad(cell(r.levels.unit), 8)} | ` +
      `${pad(cell(r.levels.integration), 8)} | ${pad(cell(r.levels.e2e), 8)} | ` +
      `${pad(cell(r.levels.invariant), 9)} | ${r.verdict}`
    );
  }

  console.log('\n── Preuves déclarées mais NON EXÉCUTÉES ──');
  for (const r of rows) {
    if (r.notRun.length) console.log(`  ${r.name}: ${r.notRun.length}\n    ${r.notRun.join('\n    ')}`);
  }
  console.log('\n── Tests déclarés au manifest mais ABSENTS du disque ──');
  for (const r of rows) {
    if (r.missing.length) console.log(`  ${r.name}: ${r.missing.join(', ')}`);
  }
  console.log('\n── Invariants métier exécutables ──');
  for (const r of rows) {
    for (const i of r.execInvariants) {
      console.log(`  [${i.ran ? 'EXÉCUTÉ' : 'NON EXÉCUTÉ'}] ${r.name} — ${i.test}`);
    }
  }
  console.log('\n── FAILURES réelles ──');
  for (const r of rows) {
    for (const l of Object.values(r.levels)) {
      for (const f of l.fails) console.log(`  ${r.name} — ${f.file}\n    ${f.tests.join('\n    ')}`);
    }
  }
}

main();
