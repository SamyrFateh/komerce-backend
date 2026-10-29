#!/usr/bin/env node
'use strict';

/**
 * @komerce-arch
 * @role          repository-logic-risk-audit
 * @domain        infrastructure
 * @layer         tooling
 * @criticality   high
 * @inputs        tracked JS files, git base/HEAD, canonical governance gates
 * @outputs       JSON/Markdown findings, CI exit code
 * @depends       scripts/lib/logic-detectors.js, git, node
 * @used-by       package.json audit:logic, .github/workflows/pr-enforcement.yml
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      invariant_executable_non_speculatif
 *
 * Static findings are SUSPICIONS, not confirmed business bugs.
 * Never opens DATABASE_URL; DB checks are a separate explicit phase.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { scanSource } = require('./lib/logic-detectors');
const { runDataRules } = require('./lib/logic-data-detectors');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = name => { const i = argv.indexOf(name); return i < 0 ? null : argv[i + 1]; };
const flag = name => argv.includes(name);
function git(args, required = true) {
  const r = cp.spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 });
  if (r.status !== 0) {
    if (!required) return null;
    throw new Error('git ' + args[0] + ' impossible : ' + String(r.stderr).slice(0, 300));
  }
  return String(r.stdout).trim();
}
function included(p) {
  if (!/\.(?:cjs|js|mjs|ts)$/.test(p)) return false;
  if (/(^|\/)(?:node_modules|coverage|dist|artifacts|tests|docs|migrations|__tests__)(\/|$)/.test(p)) return false;
  // Independent auditor harnesses contain deliberately broken SQL/PSP fixtures.
  // They are tooling to TEST the business, not reachable application code.
  // Keep all services/routes and the rest of the repository in this scan.
  if (/^tools\/business-auditor\//.test(p)) return false;
  if (/\.min\.(?:js|mjs)$/.test(p)) return false;
  return true;
}
function trackedFiles() {
  return git(['ls-files', '-z']).split('\0').filter(included).sort();
}
function atBase(base, file) {
  return git(['show', base + ':' + file], false) || '';
}
function collectStatic(base) {
  const files = trackedFiles();
  const changed = new Set(git(['diff', '--name-only', base, 'HEAD']).split('\n').filter(Boolean));
  if (!files.length) throw new Error('Aucun fichier applicatif suivi : audit incomplet (fail-closed)');
  const findings = [];
  let scannedFiles = 0;
  for (const file of files) {
    let current;
    try { current = fs.readFileSync(path.join(ROOT, file), 'utf8'); }
    catch (error) { throw new Error('Fichier suivi illisible : ' + file + ' — ' + error.message); }
    scannedFiles++;
    const currentFindings = scanSource(current, file);
    if (!currentFindings.length) continue;
    const historical = changed.has(file)
      ? new Set(scanSource(atBase(base, file), file).map(x => x.fingerprint))
      : null;
    for (const finding of currentFindings) {
      findings.push({ ...finding, novelty: historical && !historical.has(finding.fingerprint) ? 'NEW' : 'KNOWN' });
    }
  }
  return { scannedFiles, trackedFiles: files.length, changedFiles: changed.size, findings };
}
const GATES = Object.freeze([
  ['Headers ↔ SQL', 'scripts/arch-header-sql-check.js'],
  ['Invariants Feature Cards (liens et cliquet)', 'scripts/feature-invariant-check.js'],
  ['Business graph ratchet', 'scripts/business-graph-ratchet-check.js'],
]);
function runGates(base) {
  return GATES.map(([name, script]) => {
    const extra = script.includes('feature-invariant-check.js') ? ['--strict', '--base', base] : [];
    const r = cp.spawnSync(process.execPath, [script, ...extra], {
      cwd: ROOT, encoding: 'utf8', timeout: 180000, maxBuffer: 10 * 1024 * 1024,
    });
    return {
      name, status: r.status === 0 ? 'PASS' : 'FAIL',
      message: r.error ? String(r.error.message) : String(r.stdout || r.stderr || '').split('\n').filter(Boolean).slice(-4).join(' | ').slice(0, 600),
    };
  });
}
function markdown(result) {
  const lines = [
    '# Komerce — Audit logique statique et invariants de données', '',
    'SHA : ' + result.sha, 'Base : ' + result.base, '',
    'Fichiers JavaScript/TypeScript suivis analysés : ' + result.scannedFiles + ' / ' + result.trackedFiles,
    'Répartition par règle : ' + Object.entries(result.byRule || {}).map(([rule, count]) => rule + '=' + count).join(' · '),
    'Fichiers modifiés depuis la base : ' + result.changedFiles,
    'Suspicion(s) statique(s) : ' + result.findings.length,
    'Nouvelles suspicions : ' + result.newFindings,
    '',
    '**Portée :** ce scanner ne confirme aucun bug métier. Les chemins tests, migrations, documents et artefacts générés ne sont pas analysés.',
    'Les contrôles PostgreSQL exigent --data, exécutent BEGIN READ ONLY et ne sont jamais implicites.', '',
    '## Invariants PostgreSQL', '',
    ...(Array.isArray(result.dataChecks)
      ? result.dataChecks.map(r => '- ' + r.rule + ' [' + r.category + '] ' +
          r.title + ' : au moins ' + r.detectedAtLeast +
          (r.sampleTruncated ? ' (échantillon tronqué)' : '') +
          ' — ' + r.status)
      : ['**NON EXÉCUTÉS** : ajouter --data avec une base autorisée.']),
    '',
    '## Contrôles canoniques', '',
    '| Gate | Verdict |', '|---|---|',
    ...result.gates.map(g => '| ' + g.name + ' | ' + g.status + ' |'),
    '', '## Détections statiques', '',
    '| Code | P | Domaine | État | Fichier | Ligne | Motif |',
    '|---|---|---|---|---|---:|---|',
    ...result.findings.map(f =>
      '| ' + f.rule + ' | ' + f.priority + ' | ' + f.category + ' | ' + f.novelty +
      ' | ' + f.file + ' | ' + f.line + ' | ' + f.snippet.replace(/[|]/g, '/') + ' |'),
    '', '## Limites', '',
    '- Heuristiques lexicales : faux positifs et faux négatifs possibles.',
    '- Le scanner ne prouve pas la cohérence d’une opération complète ni sa fréquence réelle.',
    '- Les nouveaux motifs critiques sont bloquants ; les motifs historiques restent visibles.',
  ];
  return lines.join('\n') + '\n';
}
async function readOnlyDataChecks(connection = null) {
  if (!process.env.DATABASE_URL) throw new Error('--data exige DATABASE_URL explicite (aucun fallback)');
  // Connection only after explicit --data, transaction-level enforcement by PostgreSQL.
  const db = connection || require('../db');
  let client;
  try {
    client = await db.connect();
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '15000ms'");
    return await runDataRules(client);
  } finally {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
    await db.pool.end();
  }
}
async function main() {
  if (flag('--data') && flag('--static-only')) {
    throw new Error('Modes --data et --static-only incompatibles');
  }
  const base = arg('--base') || git(['merge-base', 'HEAD', 'origin/main'], false);
  if (!base) throw new Error('Commit de base absent. Fournir --base <SHA> (fail-closed).');
  if (git(['cat-file', '-t', base]) !== 'commit') throw new Error('Base non vérifiable : ' + base);
  const sha = git(['rev-parse', 'HEAD']);
  const staticResult = collectStatic(base);
  const gates = flag('--static-only') ? [] : runGates(base);
  const dataChecks = flag('--data') ? await readOnlyDataChecks() : null;
  const result = {
    contract: 'komerce-audit-logic-v1', sha, base,
    scannedFiles: staticResult.scannedFiles,
    trackedFiles: staticResult.trackedFiles,
    byRule: Object.fromEntries([...new Set(staticResult.findings.map(f => f.rule))].sort().map(rule => [rule, staticResult.findings.filter(f => f.rule === rule).length])),
    changedFiles: staticResult.changedFiles,
    findings: staticResult.findings,
    newFindings: staticResult.findings.filter(x => x.novelty === 'NEW').length,
    gates,
    dataChecks: dataChecks || 'NOT_RUN',
    dataStatus: dataChecks ? 'EXECUTED_READ_ONLY' : 'NOT_RUN',
    verdict: 'NOT_CERTIFICATION',
  };
  const outDir = arg('--out') || path.join(os.tmpdir(), 'komerce-audit-logic-' + sha.slice(0, 9));
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'audit.json'), JSON.stringify(result, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'audit.md'), markdown(result));
  console.log('Audit logique Komerce — ' + result.scannedFiles + '/' + result.trackedFiles + ' fichiers suivis · ' +
    result.findings.length + ' suspicions (' + result.newFindings + ' nouvelles).');
  console.log('Gates : ' + (gates.length ? gates.map(x => x.name + '=' + x.status).join(', ') : 'non lancés (--static-only)'));
  if (dataChecks) {
    for (const rule of dataChecks) console.log('  ' + (rule.detectedAtLeast ? '!' : '✔') + ' ' +
      rule.rule + ' [' + rule.category + '] ' + rule.title + ' : au moins ' + rule.detectedAtLeast);
  }
  console.log('Rapports : ' + outDir);
  if (flag('--strict') && (result.newFindings || gates.some(x => x.status !== 'PASS') ||
    (dataChecks && dataChecks.some(x => x.detectedAtLeast > 0)))) process.exitCode = 1;
}
if (require.main === module) {
  main().catch(error => { console.error('audit:logic BLOQUÉ : ' + error.message); process.exitCode = 1; });
}
module.exports = { included, collectStatic, markdown, runGates, readOnlyDataChecks, main };
