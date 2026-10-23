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
  const findings = [];
  for (const file of files) {
    let current;
    try { current = fs.readFileSync(path.join(ROOT, file), 'utf8'); } catch { continue; }
    const currentFindings = scanSource(current, file);
    if (!currentFindings.length) continue;
    const historical = changed.has(file)
      ? new Set(scanSource(atBase(base, file), file).map(x => x.fingerprint))
      : null;
    for (const finding of currentFindings) {
      findings.push({ ...finding, novelty: historical && !historical.has(finding.fingerprint) ? 'NEW' : 'KNOWN' });
    }
  }
  return { scannedFiles: files.length, changedFiles: changed.size, findings };
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
    '# Komerce — Audit logique statique', '',
    'SHA : ' + result.sha, 'Base : ' + result.base, '',
    'Fichiers JavaScript/TypeScript suivis analysés : ' + result.scannedFiles,
    'Fichiers modifiés depuis la base : ' + result.changedFiles,
    'Suspicion(s) statique(s) : ' + result.findings.length,
    'Nouvelles suspicions : ' + result.newFindings,
    '',
    '**Portée :** ce scanner ne confirme aucun bug métier. Les chemins tests, migrations, documents et artefacts générés ne sont pas analysés.',
    'Le contrôle des données vivantes requiert un audit PostgreSQL explicite et distinct.', '',
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
function main() {
  if (flag('--data')) throw new Error('Contrôle des données non activé dans cette étape : jamais de connexion DB implicite.');
  const base = arg('--base') || git(['merge-base', 'HEAD', 'origin/main'], false);
  if (!base) throw new Error('Commit de base absent. Fournir --base <SHA> (fail-closed).');
  if (git(['cat-file', '-t', base]) !== 'commit') throw new Error('Base non vérifiable : ' + base);
  const sha = git(['rev-parse', 'HEAD']);
  const staticResult = collectStatic(base);
  const gates = flag('--static-only') ? [] : runGates(base);
  const result = {
    contract: 'komerce-audit-logic-v1', sha, base,
    scannedFiles: staticResult.scannedFiles,
    changedFiles: staticResult.changedFiles,
    findings: staticResult.findings,
    newFindings: staticResult.findings.filter(x => x.novelty === 'NEW').length,
    gates, dataChecks: 'NOT_RUN',
    verdict: 'NOT_CERTIFICATION',
  };
  const outDir = arg('--out') || path.join(os.tmpdir(), 'komerce-audit-logic-' + sha.slice(0, 9));
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'audit.json'), JSON.stringify(result, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'audit.md'), markdown(result));
  console.log('Audit logique Komerce — ' + result.scannedFiles + ' fichiers · ' +
    result.findings.length + ' suspicions (' + result.newFindings + ' nouvelles).');
  console.log('Gates : ' + (gates.length ? gates.map(x => x.name + '=' + x.status).join(', ') : 'non lancés (--static-only)'));
  console.log('Rapports : ' + outDir);
  if (flag('--strict') && (result.newFindings || gates.some(x => x.status !== 'PASS'))) process.exitCode = 1;
}
if (require.main === module) {
  try { main(); } catch (error) { console.error('audit:logic BLOQUÉ : ' + error.message); process.exitCode = 1; }
}
module.exports = { included, collectStatic, markdown, runGates, main };
