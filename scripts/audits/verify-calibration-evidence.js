#!/usr/bin/env node
'use strict';
/**
 * @komerce-arch
 * @role          paired-business-calibration-verifier
 * @domain        infrastructure
 * @layer         tooling
 * @criticality   high
 * @inputs        CI logs from real PostgreSQL nominal + adversarial service tests
 * @outputs       fail-closed paired JSON/Markdown calibration record
 * @depends       node:fs, node:path
 * @used-by       .github/workflows/governance-graph-discovery.yml
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      invariant_executable_non_speculatif
 *
 * Diagnostic records don't imply that a bug is fixed.
 * Tests must assert actual DB/service state before emitting evidence.
 */
const fs = require('node:fs');
const path = require('node:path');
const MANIFEST = require('./calibration-cases.json');
if (MANIFEST.contract !== 'komerce-calibration-cases-v1'
    || !Array.isArray(MANIFEST.cases) || !MANIFEST.cases.length) {
  throw Error('Invalid or empty scanner calibration manifest');
}
const CASES = Object.freeze(MANIFEST.cases.map(x => x.caseId));
if (new Set(CASES).size !== CASES.length) throw Error('Duplicate calibration case in manifest');
const MODES = new Set(['NOMINAL', 'DEVIATION']);

function equal(a,b) { return JSON.stringify(a) === JSON.stringify(b); }
function requireProof(x) {
  if (!x || !CASES.includes(x.caseId) || !MODES.has(x.mode)
      || x.db !== 'POSTGRES_REAL' || typeof x.service !== 'string' || !x.service
      || !x.expected || !x.observed || !Object.keys(x.expected).length
      || !equal(Object.keys(x.expected).sort(), Object.keys(x.observed).sort())
      || typeof x.invariantOK !== 'boolean') {
    throw Error('Malformed or unrecognized real-Postgres calibration evidence: ' + JSON.stringify(x));
  }
  const registered = MANIFEST.cases.find(c => c.caseId === x.caseId);
  if (!registered || x.service !== registered.service || x.db !== registered.db)
    throw Error('Unregistered calibration service/database for ' + x.caseId);
  if (x.mode === 'DEVIATION' && !x.stimulus) throw Error('Missing adversarial stimulus: ' + x.caseId);
  const actualMatches = equal(x.expected, x.observed);
  if (x.invariantOK !== actualMatches) throw Error('Evidence verdict inconsistent with observed state: ' + x.caseId + '/' + x.mode);
  if (x.mode === 'NOMINAL' && !x.invariantOK) throw Error('Nominal business path is broken: ' + x.caseId);
}

function verify(logs) {
  const evidence = [];
  for (const log of logs) {
    for (const line of log.split(/\r?\n/)) {
      const marker = 'CALIBRATION_EVIDENCE ';
      const pos = line.indexOf(marker);
      if (pos < 0) continue;
      const x = JSON.parse(line.slice(pos + marker.length).trim());
      requireProof(x);
      evidence.push(x);
    }
  }
  const pairs = CASES.map(caseId => {
    const items = evidence.filter(e => e.caseId === caseId);
    if (items.length !== 2 || new Set(items.map(e => e.mode)).size !== 2)
      throw Error('Calibration requires exactly one NOMINAL and one DEVIATION proof: ' + caseId);
    const nominal = items.find(e => e.mode === 'NOMINAL');
    const deviation = items.find(e => e.mode === 'DEVIATION');
    if (nominal.service !== deviation.service) throw Error('Different services in calibration pair: ' + caseId);
    return { caseId, pattern: MANIFEST.cases.find(c => c.caseId === caseId).pattern,
      service: nominal.service,
      verdict: deviation.invariantOK ? 'ADVERSARIAL_GUARD_VALIDATED' : 'BUSINESS_BUG_REPRODUCED',
      nominal, deviation };
  });
  return {
    contract: 'komerce-business-calibration-v1',
    enrolledPatterns: [...new Set(MANIFEST.cases.map(c => c.pattern))],
    sha: process.env.GITHUB_SHA || 'UNSPECIFIED',
    database: 'ISOLATED_REAL_POSTGRES_ROLLBACK',
    meaning: 'Diagnostic paired proofs. Green tests do not certify application correctness.',
    pairs,
    summary: { requiredCases: CASES.length, calibratedPairs: pairs.length,
      reproducedBugs: pairs.filter(x => x.verdict === 'BUSINESS_BUG_REPRODUCED').length,
      guardedDeviations: pairs.filter(x => x.verdict === 'ADVERSARIAL_GUARD_VALIDATED').length }
  };
}

function render(report) {
  const out = [
    '# Komerce — Etalonnage du scanner métier', '',
    'SHA : ' + report.sha,
    'DB : ' + report.database, '',
    '**Un passage vert valide les preuves, pas une application corrigée.**', '',
    '| Cas | Preuve nominale | Ecart provoqué | Verdict |',
    '|---|---|---|---|'
  ];
  for (const p of report.pairs) {
    out.push('| ' + p.caseId + ' | OK PostgreSQL réel | ' +
      (p.deviation.invariantOK ? 'Garde respectée' : 'Invariant rompu') + ' | ' + p.verdict + ' |',
      '',
      '### ' + p.caseId, '',
      'Service réel : ' + p.service, '',
      'Nominal attendu : `' + JSON.stringify(p.nominal.expected) + '`',
      'Nominal observé : `' + JSON.stringify(p.nominal.observed) + '`', '',
      'Perturbation : ' + p.deviation.stimulus, '',
      'Ecart attendu (protection) : `' + JSON.stringify(p.deviation.expected) + '`',
      'Ecart observé : `' + JSON.stringify(p.deviation.observed) + '`', '');
  }
  return out.join('\n') + '\n';
}
function main() {
  const args = process.argv.slice(2);
  const outPos = args.indexOf('--out');
  const out = outPos >= 0 ? args[outPos + 1] : 'audit-results/calibration';
  const paths = args.filter((x,i)=>x !== '--out' && i !== outPos + 1);
  if (!paths.length || !out) throw Error('Usage: verify-calibration-evidence.js <one or more *.log> --out DIR');
  const logs = paths.map(p => fs.readFileSync(p, 'utf8'));
  const report = verify(logs);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out,'calibration.json'), JSON.stringify(report,null,2)+'\n');
  fs.writeFileSync(path.join(out,'calibration.md'), render(report));
  console.log('CALIBRATION_SUMMARY ' + JSON.stringify(report.summary));
}
if (require.main === module) {
  try { main(); } catch (error) { console.error('CALIBRATION_REJECTED '+error.message); process.exitCode = 1; }
}
module.exports = { verify, requireProof, render };
