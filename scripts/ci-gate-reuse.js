#!/usr/bin/env node
'use strict';

/**
 * Reuse previous green scoped CI jobs when the latest PR-head delta does not
 * intersect the gate's proof surface.
 *
 * Fail-closed rules:
 * - previous head must be an ancestor of current head;
 * - current base must already be contained in previous head;
 * - only a previous job with conclusion=success is reusable;
 * - any ambiguous/missing evidence yields reuse=false;
 * - gate impact is computed from the latest delta with the canonical
 *   pr-enforcement scope classifier.
 */

const fs = require('fs');
const cp = require('child_process');
const { classifyDiff } = require('./pr-enforcement-scope');

const JOBS = Object.freeze({
  backend: 'Backend gates',
  migrations: 'Migration and schema gates',
  from_scratch: 'From-scratch DB + integration + E2E API',
  dashboard: 'Dashboard canonical gates',
  boutique: 'Boutique source gates',
  governance: 'Governance and feature-first gates',
  provider_contracts: 'Isolated provider contract proof gates',
});

function git(args) {
  const r = cp.spawnSync('git', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || 'git failed').trim());
  return String(r.stdout || '').trim();
}

function isAncestor(ancestor, descendant) {
  return cp.spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant]).status === 0;
}

function normalizeJobs(payload) {
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
  return jobs.map(job => ({
    name: String(job?.name || ''),
    conclusion: String(job?.conclusion || ''),
  }));
}

function previousJobGreen(jobs, key) {
  const name = JOBS[key];
  return Boolean(jobs.find(job => job.name === name && job.conclusion === 'success'));
}

function gateImpact(scope) {
  return {
    backend: Boolean(scope.backend || scope.golden),
    migrations: Boolean(scope.migrations),
    from_scratch: Boolean(
      scope.dbRebuildRequired || scope.integrationRequired || scope.e2eApiRequired
    ),
    dashboard: Boolean(scope.dashboard),
    boutique: Boolean(scope.boutique),
    governance: Boolean(scope.governance),
    provider_contracts: Boolean(scope.providerProofOnly),
  };
}

function computeReuse({
  previousHead,
  currentHead,
  currentBase,
  jobs,
  scope,
  ancestor = true,
  baseContained = true,
}) {
  const reuse = {};
  const reasons = {};

  for (const key of Object.keys(JOBS)) {
    reuse[key] = false;
    reasons[key] = 'not-proven';
  }

  if (!previousHead || !currentHead || !currentBase) {
    return { reuse, reasons, reason: 'missing-sha' };
  }
  if (!ancestor) {
    return { reuse, reasons, reason: 'previous-head-not-ancestor' };
  }
  if (!baseContained) {
    return { reuse, reasons, reason: 'current-base-not-contained-in-previous-head' };
  }

  const impact = gateImpact(scope);
  for (const key of Object.keys(JOBS)) {
    if (!previousJobGreen(jobs, key)) {
      reasons[key] = 'previous-job-not-green';
      continue;
    }
    if (impact[key]) {
      reasons[key] = 'latest-delta-impacts-gate';
      continue;
    }
    reuse[key] = true;
    reasons[key] = 'previous-green-proof-reused-no-delta-impact';
  }

  return {
    reuse,
    reasons,
    reason: 'per-gate-proof-evaluated',
    impact,
  };
}

function argValue(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}

function appendOutput(path, result) {
  if (!path) return;
  const lines = [];
  for (const key of Object.keys(JOBS)) {
    lines.push(`reuse_${key}=${result.reuse[key] ? 'true' : 'false'}`);
    lines.push(`reuse_${key}_reason=${result.reasons[key]}`);
  }
  lines.push(`reuse_previous_head=${result.previous_head || ''}`);
  fs.appendFileSync(path, lines.join('\n') + '\n', 'utf8');
}

function main(argv = process.argv.slice(2)) {
  const previousHead = argValue(argv, '--previous-head');
  const currentHead = argValue(argv, '--current-head');
  const currentBase = argValue(argv, '--current-base');
  const jobsPath = argValue(argv, '--jobs-json');
  const output = argValue(argv, '--github-output');

  let result;
  try {
    if (!previousHead || !currentHead || !currentBase) throw new Error('missing-sha');
    const jobs = jobsPath && fs.existsSync(jobsPath)
      ? normalizeJobs(JSON.parse(fs.readFileSync(jobsPath, 'utf8')))
      : [];
    const ancestor = isAncestor(previousHead, currentHead);
    const baseContained = isAncestor(currentBase, previousHead);
    const scope = classifyDiff(previousHead, currentHead);

    result = {
      ...computeReuse({
        previousHead,
        currentHead,
        currentBase,
        jobs,
        scope,
        ancestor,
        baseContained,
      }),
      previous_head: previousHead,
      current_head: currentHead,
      current_base: currentBase,
      changed_files: scope.changedFiles,
    };
  } catch (error) {
    result = {
      reuse: Object.fromEntries(Object.keys(JOBS).map(key => [key, false])),
      reasons: Object.fromEntries(Object.keys(JOBS).map(key => [key, 'proof-error'])),
      reason: `proof-error:${String(error.message || error)}`,
    };
  }

  appendOutput(output, result);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

if (require.main === module) main();

module.exports = {
  JOBS,
  normalizeJobs,
  previousJobGreen,
  gateImpact,
  computeReuse,
};
