#!/usr/bin/env node
'use strict';
/**
 * @komerce-arch
 * @role          resolve-staging-deploy-pin
 * @domain        logistics
 * @layer         tooling
 * @criticality   high
 * @inputs        STAGING_BASE_URL (/health/version), depot git complet (HEAD de main)
 * @outputs       E2E_EXPECTED_DEPLOY_SHA (GITHUB_ENV) + rapport JSON (deux SHA, fichiers differents)
 * @depends       git
 * @used-by       .github/workflows/hub-v1-http-actions-staging.yml
 * @db-read       none
 * @db-write      none
 * @doctrine      fail_closed_pin, only_undeployed_paths_may_differ
 * @impact-areas  staging, recette
 * @version       2026-11
 */
const { execFileSync } = require('child_process');
const fs = require('fs');

const SHA = /^[a-f0-9]{40}$/i;
// Chemins que Railway ne deploie pas : une difference limitee a eux ne change pas le code servi.
const NON_DEPLOYED = [/^\.github\//, /^docs\//, /^tests\//, /\.md$/i];

function decidePin({ stagingSha, headSha, isAncestor, changedFiles }) {
  const report = { staging_sha: stagingSha, head_sha: headSha, changed_files: changedFiles || [], decision: 'REFUSED', reason: null };
  if (!SHA.test(String(stagingSha || '')) || !SHA.test(String(headSha || ''))) { report.reason = 'SHA_INVALID'; return report; }
  if (stagingSha.toLowerCase() === headSha.toLowerCase()) { report.decision = 'ACCEPTED_EXACT'; return report; }
  if (!isAncestor) { report.reason = 'STAGING_NOT_ANCESTOR_OF_HEAD'; return report; }
  const deployed = (changedFiles || []).filter((f) => !NON_DEPLOYED.some((re) => re.test(f)));
  if (deployed.length) { report.reason = 'DEPLOYED_PATHS_DIFFER'; report.deployed_paths_differing = deployed; return report; }
  report.decision = 'ACCEPTED_NON_DEPLOYED_DIFF_ONLY'; return report;
}

function git(args) { return execFileSync('git', args, { encoding: 'utf8' }); }

async function main() {
  const base = String(process.env.STAGING_BASE_URL || '').replace(/\/$/, '');
  if (base !== 'https://komerce-backend-production.up.railway.app') throw new Error('BASE_URL_NOT_STAGING');
  const version = await (await fetch(base + '/health/version')).json();
  const stagingSha = String(version.commit || '');
  const headSha = git(['rev-parse', 'HEAD']).trim();
  let isAncestor = false; let changedFiles = [];
  if (SHA.test(stagingSha)) {
    try { git(['merge-base', '--is-ancestor', stagingSha, headSha]); isAncestor = true; } catch (_) { isAncestor = false; }
    if (isAncestor) changedFiles = git(['diff', '--name-only', `${stagingSha}..${headSha}`]).split('\n').filter(Boolean);
  }
  const report = decidePin({ stagingSha, headSha, isAncestor, changedFiles });
  fs.mkdirSync('test-results/hub-v1-http', { recursive: true });
  fs.writeFileSync('test-results/hub-v1-http/deploy-pin.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  if (report.decision === 'REFUSED') { console.error('STAGING_SHA_MISMATCH:' + report.reason); process.exitCode = 2; return; }
  if (process.env.GITHUB_ENV) fs.appendFileSync(process.env.GITHUB_ENV, `E2E_EXPECTED_DEPLOY_SHA=${stagingSha}\n`);
}
if (require.main === module) main().catch((e) => { console.error('PIN_REFUSED:' + String(e.message).slice(0, 200)); process.exitCode = 2; });
module.exports = { decidePin, NON_DEPLOYED };
