'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');
const { pickSweepAction, sweep, verdictOf, isCandidate, isInFlight, GRACE_MS } = require('../../scripts/ci-pr-sweep');

const ROOT = path.resolve(__dirname, '../..');
const NOW = Date.parse('2026-10-04T14:00:00Z');
const OLD = '2026-10-01T11:00:00Z';
const green = [{ name: 'Required verdict', status: 'COMPLETED', conclusion: 'SUCCESS' }];

function pr(number, overrides = {}) {
  return {
    number, isDraft: false, isCrossRepository: false, mergeStateStatus: 'BEHIND',
    autoMergeRequest: { enabledAt: OLD }, headRefOid: 'sha' + number, updatedAt: OLD,
    labels: [], statusCheckRollup: green, ...overrides,
  };
}

describe('CI PR sweep — serial behind synchronization', () => {
  test('updates only the oldest eligible BEHIND PR', () => {
    expect(pickSweepAction([pr(30), pr(12), pr(20)], NOW)).toEqual({
      action: 'update', reason: 'oldest-behind-candidate', number: 12, headSha: 'sha12',
    });
  });

  test('ignores draft, fork and hold, but allows manually merged PRs', () => {
    const prs = [
      pr(1, { isDraft: true }), pr(2, { isCrossRepository: true }),
      pr(4, { labels: [{ name: 'Hold' }] }),
    ];
    expect(prs.some(isCandidate)).toBe(false);
    expect(pickSweepAction(prs, NOW)).toEqual({ action: 'idle', reason: 'no-eligible-candidate' });
    expect(isCandidate(pr(3, { autoMergeRequest: null }))).toBe(true);
  });

  test('green BEHIND without auto-merge is synchronized, never merged', () => {
    expect(pickSweepAction([pr(17, { autoMergeRequest: null })], NOW)).toEqual({
      action: 'update', reason: 'oldest-behind-candidate', number: 17, headSha: 'sha17',
    });
  });

  test('green CLEAN without auto-merge is left ready for human merge', () => {
    expect(pickSweepAction([pr(17, { mergeStateStatus: 'CLEAN', autoMergeRequest: null })], NOW)).toEqual({
      action: 'idle', reason: 'no-green-behind-candidate',
    });
    expect(pickSweepAction([pr(17, { mergeStateStatus: 'CLEAN', autoMergeRequest: null }), pr(18, { autoMergeRequest: null })], NOW)).toMatchObject({ action: 'update', number: 18 });
  });

  test('BEHIND with no green verdict never triggers update', () => {
    expect(pickSweepAction([pr(17, { statusCheckRollup: [] })], NOW)).toEqual({
      action: 'idle', reason: 'no-green-behind-candidate',
    });
  });

  test('waits while another eligible PR is in flight', () => {
    const running = pr(5, { mergeStateStatus: 'BLOCKED', statusCheckRollup: [{ name: 'Required verdict', status: 'IN_PROGRESS' }] });
    expect(pickSweepAction([running, pr(9)], NOW)).toEqual({ action: 'wait', reason: 'in-flight', number: 5 });
  });

  test('BEHIND with a pending verdict must finish before any update', () => {
    const nearGreen = pr(5, { statusCheckRollup: [{ name: 'Required verdict', status: 'IN_PROGRESS' }] });
    expect(isInFlight(nearGreen, NOW)).toBe(true);
    expect(pickSweepAction([nearGreen, pr(9)], NOW)).toEqual({
      action: 'wait', reason: 'in-flight', number: 5,
    });
  });

  test('red/conflicted PRs do not block the next behind candidate', () => {
    const red = pr(5, { mergeStateStatus: 'BLOCKED', statusCheckRollup: [{ name: 'Required verdict', status: 'COMPLETED', conclusion: 'FAILURE' }] });
    const conflict = pr(6, { mergeStateStatus: 'DIRTY' });
    const redBehind = pr(7, { statusCheckRollup: [{ name: 'Required verdict', status: 'COMPLETED', conclusion: 'FAILURE' }] });
    expect(pickSweepAction([red, conflict, redBehind, pr(8)], NOW).number).toBe(8);
  });

  test('stale blocked PR is not considered in flight', () => {
    const stale = pr(5, { mergeStateStatus: 'BLOCKED', updatedAt: OLD });
    expect(isInFlight(stale, NOW)).toBe(false);
    expect(isInFlight(pr(5, { mergeStateStatus: 'BLOCKED', updatedAt: new Date(NOW - GRACE_MS + 1000).toISOString() }), NOW)).toBe(true);
  });

  test('verdictOf distinguishes success, pending, failure and absence', () => {
    expect(verdictOf({})).toBe('none');
    expect(verdictOf({ statusCheckRollup: green })).toBe('success');
    expect(verdictOf({ statusCheckRollup: [{ context: 'Required verdict', state: 'PENDING' }] })).toBe('pending');
    expect(verdictOf({ statusCheckRollup: [{ name: 'Required verdict', status: 'COMPLETED', conclusion: 'CANCELLED' }] })).toBe('failure');
  });

  test('sweep issues exactly one update-branch call with expected head', () => {
    const calls = [];
    const responses = [
      { status: 0, stdout: JSON.stringify([pr(12)]) },
      { status: 0, stdout: '' },
    ];
    const decision = sweep({
      repo: 'o/r',
      dryRun: false,
      exec: args => { calls.push(args); return responses.shift(); },
      write: () => {},
    });
    expect(decision).toMatchObject({ action: 'update', number: 12 });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(['api', '--method', 'PUT', 'repos/o/r/pulls/12/update-branch', '-f', 'expected_head_sha=sha12']);
  });

  test('workflows have no github.token fallback for branch mutation', () => {
    const sweepWorkflow = fs.readFileSync(path.join(ROOT, '.github/workflows/pr-sweep-behind.yml'), 'utf8');
    const autoWorkflow = fs.readFileSync(path.join(ROOT, '.github/workflows/pr-auto-update.yml'), 'utf8');
    expect(sweepWorkflow).toContain('PR_SYNC_TOKEN');
    expect(sweepWorkflow).toMatch(/workflow_run:\s*\n\s*workflows: \[PR enforcement\]\s*\n\s*types: \[completed\]/);
    expect(sweepWorkflow).toContain('cancel-in-progress: false');
    for (const workflow of [sweepWorkflow, autoWorkflow]) {
      expect(workflow).not.toContain('GH_TOKEN: ${{ github.token }}');
      expect(workflow).not.toContain('|| github.token');
    }
    expect(autoWorkflow).not.toContain('pull_request_target:');
    expect(autoWorkflow).not.toContain('update-branch');
  });
});
