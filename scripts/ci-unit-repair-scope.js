#!/usr/bin/env node
'use strict';

/**
 * CI repair fast-path classifier.
 *
 * This is deliberately fail-closed. A synchronize push qualifies only when:
 * - the delta from the previous PR head changes unit-test files only;
 * - the previous PR-enforcement run failed only in Backend gates;
 * - the failed Backend step was exactly "Unit test coverage threshold";
 * - Jest named the failing unit-test files in that failed job log;
 * - the repair delta covers every failing test file.
 *
 * Any missing/ambiguous evidence returns qualifies=false, which makes CI fall
 * back to the normal full scoped workflow.
 */

const fs = require('fs');
const cp = require('child_process');

function norm(file) {
  return String(file || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function isSafeUnitTestFile(file) {
  return /^tests\/unit\/[A-Za-z0-9._/-]+\.(?:test|spec)\.(?:js|cjs|mjs|ts)$/i.test(norm(file));
}

function diffFiles(base, head) {
  if (!base || !head) return [];
  const r = cp.spawnSync('git', ['diff', '--name-only', base, head], { encoding:'utf8' });
  if (r.status !== 0) return [];
  return r.stdout.split(/\r?\n/).map(norm).filter(Boolean);
}

function extractFailedUnitTests(logText) {
  const out = new Set();
  const re = /\bFAIL\s+(tests\/unit\/[A-Za-z0-9._/-]+\.(?:test|spec)\.(?:js|cjs|mjs|ts))/gi;
  let match;
  while ((match = re.exec(String(logText || ''))) !== null) out.add(norm(match[1]));
  return [...out].sort();
}

function normalizeJobs(jobsJson) {
  const raw = jobsJson && typeof jobsJson === 'object' ? jobsJson : {};
  return (Array.isArray(raw.jobs) ? raw.jobs : []).map(job => ({
    id:job.id || null,
    name:String(job.name || ''),
    conclusion:String(job.conclusion || ''),
    steps:(Array.isArray(job.steps) ? job.steps : []).map(step => ({
      name:String(step.name || ''),
      conclusion:String(step.conclusion || ''),
    })),
  }));
}

function qualifiesUnitRepair({ changedFiles, failedTests, jobs, golden = false }) {
  const changed = [...new Set((changedFiles || []).map(norm).filter(Boolean))].sort();
  const failed = [...new Set((failedTests || []).map(norm).filter(Boolean))].sort();
  const previousJobs = Array.isArray(jobs) ? jobs : [];

  if (golden) return { qualifies:false, reason:'golden-scope-needs-full-backend-job', files:[] };
  if (!changed.length || !changed.every(isSafeUnitTestFile)) {
    return { qualifies:false, reason:'latest-delta-is-not-unit-tests-only', files:[] };
  }
  if (!failed.length || !failed.every(isSafeUnitTestFile)) {
    return { qualifies:false, reason:'previous-failing-unit-tests-not-provable', files:[] };
  }
  if (!failed.every(file => changed.includes(file))) {
    return { qualifies:false, reason:'latest-delta-does-not-cover-all-failing-tests', files:[] };
  }

  const backend = previousJobs.find(job => job.name === 'Backend gates');
  const scope = previousJobs.find(job => job.name === 'Detect PR scope');
  if (!backend || backend.conclusion !== 'failure') {
    return { qualifies:false, reason:'previous-backend-gate-was-not-the-failure', files:[] };
  }
  if (!scope || scope.conclusion !== 'success') {
    return { qualifies:false, reason:'previous-scope-detection-not-successful', files:[] };
  }

  const failedSteps = (backend.steps || []).filter(step => step.conclusion === 'failure').map(step => step.name);
  if (failedSteps.length !== 1 || failedSteps[0] !== 'Unit test coverage threshold') {
    return { qualifies:false, reason:'previous-backend-failure-is-not-unit-coverage-step', files:[] };
  }

  const ignored = new Set(['Backend gates', 'Required verdict']);
  const badOther = previousJobs.find(job =>
    !ignored.has(job.name)
    && !['success', 'skipped'].includes(job.conclusion)
  );
  if (badOther) {
    return {
      qualifies:false,
      reason:`another-previous-job-was-not-green:${badOther.name}:${badOther.conclusion}`,
      files:[],
    };
  }

  return { qualifies:true, reason:'safe-targeted-unit-repair', files:changed };
}

function argValue(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}

function appendOutput(path, result) {
  if (!path) return;
  fs.appendFileSync(path, [
    `unit_repair_only=${result.qualifies ? 'true' : 'false'}`,
    `unit_repair_files=${result.files.join(',')}`,
    `unit_repair_reason=${result.reason}`,
  ].join('\n') + '\n', 'utf8');
}

function main(argv = process.argv.slice(2)) {
  const base = argValue(argv, '--base');
  const head = argValue(argv, '--head');
  const jobsPath = argValue(argv, '--jobs-json');
  const logPath = argValue(argv, '--failed-log');
  const golden = argValue(argv, '--golden') === 'true';
  const output = argValue(argv, '--github-output');

  const changedFiles = diffFiles(base, head);
  const jobs = jobsPath && fs.existsSync(jobsPath)
    ? normalizeJobs(JSON.parse(fs.readFileSync(jobsPath, 'utf8')))
    : [];
  const failedTests = logPath && fs.existsSync(logPath)
    ? extractFailedUnitTests(fs.readFileSync(logPath, 'utf8'))
    : [];

  const result = qualifiesUnitRepair({ changedFiles, failedTests, jobs, golden });
  appendOutput(output, result);
  process.stdout.write(JSON.stringify({ ...result, changedFiles, failedTests }, null, 2) + '\n');
}

if (require.main === module) main();

module.exports = {
  norm,
  isSafeUnitTestFile,
  diffFiles,
  extractFailedUnitTests,
  normalizeJobs,
  qualifiesUnitRepair,
};
