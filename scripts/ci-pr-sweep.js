#!/usr/bin/env node
'use strict';

/**
 * @komerce-arch
 * @role          ci-pr-sweep
 * @domain        infrastructure
 * @layer         tooling
 * @criticality   medium
 * @inputs        open PR list, attributable GH token
 * @outputs       at most one update-branch call
 * @depends       gh CLI
 * @used-by       .github/workflows/pr-sweep-behind.yml
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      serial_sync_one_pr_at_a_time, no_fan_out, hold_label_wins
 * @impact-areas  governance, ci, developer-workflow
 * @version       2026-10-v1
 */
const cp = require('child_process');
const fs = require('fs');

const VERDICT = 'Required verdict';
const HOLD_LABEL = 'hold';
const GRACE_MS = 15 * 60 * 1000;
const MERGE_IMMINENT = new Set(['CLEAN', 'HAS_HOOKS', 'UNSTABLE']);
const PENDING_STATUS = new Set(['QUEUED', 'IN_PROGRESS', 'PENDING', 'WAITING', 'REQUESTED']);
const LIST_FIELDS = 'number,isDraft,isCrossRepository,mergeStateStatus,autoMergeRequest,headRefOid,updatedAt,labels,statusCheckRollup';

function verdictOf(pr) {
  const checks = (pr.statusCheckRollup || []).filter(c => (c.name || c.context) === VERDICT);
  if (!checks.length) return 'none';
  if (checks.some(c => c.conclusion === 'SUCCESS' || c.state === 'SUCCESS')) return 'success';
  if (checks.some(c => PENDING_STATUS.has(c.status) || c.state === 'PENDING')) return 'pending';
  return 'failure';
}

function isCandidate(pr) {
  if (pr.isDraft || pr.isCrossRepository || !pr.autoMergeRequest) return false;
  return !(pr.labels || []).some(l => String(l.name || l).toLowerCase() === HOLD_LABEL);
}

function isInFlight(pr, nowMs) {
  const state = pr.mergeStateStatus;
  if (state === 'BEHIND' || state === 'DIRTY') return false;
  if (MERGE_IMMINENT.has(state)) return true;
  const verdict = verdictOf(pr);
  if (verdict === 'pending') return true;
  if (verdict === 'failure') return false;
  const updated = Date.parse(pr.updatedAt);
  if (Number.isNaN(updated)) return false;
  return nowMs - updated < GRACE_MS;
}

function pickSweepAction(prs, nowMs = Date.now()) {
  const candidates = (prs || []).filter(isCandidate).sort((a, b) => a.number - b.number);
  if (!candidates.length) return { action: 'idle', reason: 'no-auto-merge-candidate' };
  const busy = candidates.find(pr => isInFlight(pr, nowMs));
  if (busy) return { action: 'wait', reason: 'in-flight', number: busy.number };
  const target = candidates.find(pr => pr.mergeStateStatus === 'BEHIND' && verdictOf(pr) !== 'failure');
  if (!target) return { action: 'idle', reason: 'no-behind-candidate' };
  return { action: 'update', reason: 'oldest-behind-candidate', number: target.number, headSha: target.headRefOid };
}

/* istanbul ignore next */
function gh(args) {
  return cp.spawnSync('gh', args, { encoding: 'utf8' });
}

/* istanbul ignore next */
function report(line) {
  process.stdout.write(line + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, line + '\n');
}

function sweep({ repo, dryRun, exec, write }) {
  const list = exec(['pr', 'list', '--repo', repo, '--state', 'open', '--base', 'main', '--limit', '100', '--json', LIST_FIELDS]);
  if (list.status !== 0) {
    write('::warning::gh pr list failed: ' + String(list.stderr || '').trim());
    return null;
  }
  const decision = pickSweepAction(JSON.parse(list.stdout || '[]'));
  write('pr-sweep: ' + JSON.stringify(decision));
  if (decision.action !== 'update' || dryRun) return decision;
  const update = exec(['api', '--method', 'PUT', `repos/${repo}/pulls/${decision.number}/update-branch`, '-f', `expected_head_sha=${decision.headSha}`]);
  if (update.status !== 0) {
    write(`::warning::update-branch #${decision.number} refused: ${String(update.stderr || '').trim()}`);
  }
  return decision;
}

/* istanbul ignore next */
function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) {
    process.stderr.write('GITHUB_REPOSITORY missing\n');
    process.exit(1);
  }
  if (!process.env.GH_TOKEN) {
    process.stderr.write('GH_TOKEN missing: refusing update-branch without attributable token\n');
    process.exit(2);
  }
  sweep({ repo, dryRun: process.argv.includes('--dry-run'), exec: gh, write: report });
}

if (require.main === module) main();

module.exports = { GRACE_MS, HOLD_LABEL, isCandidate, isInFlight, pickSweepAction, sweep, verdictOf };
