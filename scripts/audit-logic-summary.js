#!/usr/bin/env node
'use strict';

/**
 * @komerce-arch
 * @role          readable-static-logic-audit
 * @domain        infrastructure
 * @layer         tooling
 * @criticality   low
 * @inputs        scripts/audit-logic.js --static-only
 * @outputs       console summary and JSON/Markdown report paths
 * @depends       scripts/audit-logic.js, node
 * @used-by       npm audit:logic:report
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      invariant_executable_non_speculatif
 *
 * Observation only: never classify a static suspicion as a confirmed bug.
 */
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

function summarize(result) {
  const findings = result.findings || [];
  const byRule = {};
  const byPriority = {};
  for (const finding of findings) {
    byRule[finding.rule] = (byRule[finding.rule] || 0) + 1;
    byPriority[finding.priority] = (byPriority[finding.priority] || 0) + 1;
  }
  return {
    sha: result.sha,
    tracked: result.trackedFiles,
    scanned: result.scannedFiles,
    suspicions: findings.length,
    newSuspicions: result.newFindings,
    historicalSuspicions: findings.length - result.newFindings,
    byRule,
    byPriority,
    qualified: 0,
    status: result.newFindings > 0 ? 'INVESTIGATION_REQUIRED' : 'NO_NEW_STATIC_SIGNAL',
    dataStatus: result.dataStatus,
    gatesRun: result.gates.length,
  };
}

function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'komerce-audit-summary-'));
  const r = cp.spawnSync(process.execPath, [path.join(__dirname, 'audit-logic.js'), '--static-only', '--out', dir], {
    cwd: ROOT, encoding: 'utf8', timeout: 180000, maxBuffer: 10 * 1024 * 1024,
  });
  if (r.error || r.status !== 0) {
    process.stderr.write(r.stderr || r.stdout || String(r.error || 'Audit failed') + '\n');
    process.exitCode = 1;
    return;
  }
  const json = path.join(dir, 'audit.json');
  const report = summarize(JSON.parse(fs.readFileSync(json, 'utf8')));
  console.log('KOMERCE — AUDIT LOGIQUE (OBSERVATION)');
  console.log('SHA ' + report.sha);
  console.log('Fichiers analysés/éligibles : ' + report.scanned + '/' + report.tracked);
  console.log('Suspicions : ' + report.suspicions + ' (nouvelles ' + report.newSuspicions + ', historiques ' + report.historicalSuspicions + ')');
  console.log('Par priorité : ' + JSON.stringify(report.byPriority));
  console.log('Par règle : ' + JSON.stringify(report.byRule));
  console.log('Qualifications humaines : non réalisées par ce scanner');
  console.log('Gates : ' + report.gatesRun + ' ; données PostgreSQL : ' + report.dataStatus);
  console.log('Statut : ' + report.status + ' (ne certifie pas l\'absence de bugs)');
  console.log('Rapports : ' + json + ' ; ' + path.join(dir, 'audit.md'));
}

if (require.main === module) main();
module.exports = { summarize };
