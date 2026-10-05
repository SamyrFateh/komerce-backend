#!/usr/bin/env node
'use strict';

/**
 * @komerce-arch
 * @role          ci-rebase-no-impact-proof
 * @domain        infrastructure
 * @layer         tooling
 * @criticality   high
 * @inputs        previous green PR head, current synchronized head/base, previous CI jobs, arch:impact projection
 * @outputs       rebase_no_impact=true only when the previous green proof is safely reusable
 * @depends       scripts/agent-context.js, git
 * @used-by       .github/workflows/pr-enforcement.yml
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      fail_closed, proof_reuse_only_when_patch_and_impact_are_unchanged
 * @impact-areas  governance, ci, developer-workflow
 * @version       2026-10-v1
 */
const fs = require('fs');
const cp = require('child_process');
const crypto = require('crypto');
const { buildImpact } = require('./agent-context');

const GLOBAL_RISK = [
  /^\.github\//,
  /^migrations\//,
  /^docs\/db\//,
  /^features\//,
  /^package(?:-lock)?\.json$/,
  /^public\/boutique\/package(?:-lock)?\.json$/,
  /^db\.js$/,
  /^server\.js$/,
  /^bootstrap\//,
  /^config\//,
];

function norm(file) {
  return String(file || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
}
function sortedUnique(values) {
  return [...new Set((values || []).map(norm).filter(Boolean))].sort();
}
function sameSet(a, b) {
  return JSON.stringify(sortedUnique(a)) === JSON.stringify(sortedUnique(b));
}
function intersects(a, b) {
  const right = new Set(sortedUnique(b));
  return sortedUnique(a).filter(file => right.has(file));
}
function isGlobalRisk(file) {
  return GLOBAL_RISK.some(re => re.test(norm(file)));
}
function git(args, allowFailure = false) {
  const r = cp.spawnSync('git', args, { encoding: 'utf8' });
  if (r.status !== 0) {
    if (allowFailure) return null;
    throw new Error((r.stderr || r.stdout || 'git failed').trim());
  }
  return String(r.stdout || '').trim();
}
function diffFiles(base, head) {
  const out = git(['diff', '--name-only', base, head]);
  return out.split(/\r?\n/).map(norm).filter(Boolean);
}
function patchDigest(base, head) {
  const patch = git(['diff', '--no-ext-diff', '--binary', '--full-index', base, head]);
  return crypto.createHash('sha256').update(patch).digest('hex');
}
function pathLikeStrings(value, out = new Set()) {
  if (Array.isArray(value)) {
    value.forEach(item => pathLikeStrings(item, out));
    return out;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach(item => pathLikeStrings(item, out));
    return out;
  }
  if (typeof value !== 'string') return out;
  const clean = norm(value.replace(/ \(via .*\)$/, ''));
  if (/^[A-Za-z0-9_.\/-]+\.(?:js|cjs|mjs|ts|sql|json|md|html|css)$/.test(clean)) out.add(clean);
  return out;
}
function previousRunGreen(jobs) {
  const list = Array.isArray(jobs) ? jobs : [];
  const verdict = list.find(job => job && job.name === 'Required verdict');
  const scope = list.find(job => job && job.name === 'Detect PR scope');
  return Boolean(verdict && verdict.conclusion === 'success' && scope && scope.conclusion === 'success');
}
function qualifiesNoImpact({
  previousGreen,
  ancestor,
  previousPrFiles,
  currentPrFiles,
  baseDeltaFiles,
  previousPatchDigest,
  currentPatchDigest,
  impactPaths,
}) {
  if (!previousGreen) return { qualifies:false, reason:'previous-required-verdict-not-green' };
  if (!baseDeltaFiles.length) return { qualifies:false, reason:'no-base-delta-to-prove' };
  if (!sameSet(previousPrFiles, currentPrFiles)) return { qualifies:false, reason:'pr-file-set-changed' };
  if (previousPatchDigest !== currentPatchDigest) return { qualifies:false, reason:'pr-patch-changed' };
  const direct = intersects(previousPrFiles, baseDeltaFiles);
  if (direct.length) return { qualifies:false, reason:'base-touched-pr-file:' + direct[0] };
  const risky = sortedUnique(baseDeltaFiles).find(isGlobalRisk);
  if (risky) return { qualifies:false, reason:'base-global-risk:' + risky };
  const transitive = intersects(baseDeltaFiles, impactPaths);
  if (transitive.length) return { qualifies:false, reason:'base-touched-arch-impact:' + transitive[0] };
  return { qualifies:true, reason:'green-base-sync-patch-and-impact-unchanged' };
}
function argValue(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}
function appendOutput(path, result) {
  if (!path) return;
  fs.appendFileSync(path, [
    'rebase_no_impact=' + (result.qualifies ? 'true' : 'false'),
    'rebase_no_impact_reason=' + result.reason,
  ].join('\n') + '\n', 'utf8');
}
function main(argv = process.argv.slice(2)) {
  const previousHead = argValue(argv, '--previous-head');
  const currentHead = argValue(argv, '--current-head');
  const currentBase = argValue(argv, '--current-base');
  const jobsPath = argValue(argv, '--jobs-json');
  const output = argValue(argv, '--github-output');

  let result = { qualifies:false, reason:'proof-unavailable' };
  try {
    if (!previousHead || !currentHead || !currentBase) throw new Error('missing-sha');
    const jobs = jobsPath && fs.existsSync(jobsPath)
      ? (JSON.parse(fs.readFileSync(jobsPath, 'utf8')).jobs || [])
      : [];
    const previousBase = git(['merge-base', previousHead, currentBase], true);
    if (!previousBase) throw new Error('merge-base-unavailable');
    const ancestor = cp.spawnSync('git', ['merge-base', '--is-ancestor', previousHead, currentHead]).status === 0;
    const previousPrFiles = diffFiles(previousBase, previousHead);
    const currentPrFiles = diffFiles(currentBase, currentHead);
    const baseDeltaFiles = diffFiles(previousBase, currentBase);
    const impactPaths = new Set();
    for (const file of currentPrFiles) {
      if (!fs.existsSync(file)) continue;
      try {
        pathLikeStrings(buildImpact(file, { skipTests:true }), impactPaths);
      } catch (_) {
        impactPaths.add(file);
      }
    }
    result = qualifiesNoImpact({
      previousGreen: previousRunGreen(jobs),
      ancestor,
      previousPrFiles,
      currentPrFiles,
      baseDeltaFiles,
      previousPatchDigest: patchDigest(previousBase, previousHead),
      currentPatchDigest: patchDigest(currentBase, currentHead),
      impactPaths:[...impactPaths],
    });
    result = {
      ...result,
      previous_head:previousHead,
      previous_base:previousBase,
      pr_files:currentPrFiles,
      base_delta_files:baseDeltaFiles,
      impact_paths:[...impactPaths].sort(),
      previous_head_is_ancestor:ancestor,
    };
  } catch (error) {
    result = { qualifies:false, reason:'proof-error:' + String(error.message || error) };
  }
  appendOutput(output, result);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
if (require.main === module) main();

module.exports = {
  GLOBAL_RISK,
  intersects,
  isGlobalRisk,
  pathLikeStrings,
  previousRunGreen,
  qualifiesNoImpact,
  sameSet,
  sortedUnique,
};
