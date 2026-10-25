'use strict';

const { summarize } = require('../../scripts/audit-logic-summary');

describe('audit:logic:report — observation only', () => {
  test('separates historical and new suspicions without asserting confirmed bugs', () => {
    const result = summarize({
      sha: 'abc', scannedFiles: 1418, trackedFiles: 1418, newFindings: 1,
      findings: [
        { rule: 'LS-03', priority: 'P1' },
        { rule: 'LS-04', priority: 'P1' },
      ],
      dataStatus: 'NOT_RUN', gates: [],
    });
    expect(result).toMatchObject({
      scanned: 1418, tracked: 1418, suspicions: 2, newSuspicions: 1,
      historicalSuspicions: 1, byRule: { 'LS-03': 1, 'LS-04': 1 },
      status: 'INVESTIGATION_REQUIRED', qualified: 0, gatesRun: 0,
      dataStatus: 'NOT_RUN',
    });
  });

  test('does not confuse no new static signal with certification', () => {
    expect(summarize({
      sha: 'abc', scannedFiles: 2, trackedFiles: 2, newFindings: 0,
      findings: [{ rule: 'LS-06', priority: 'P2' }],
      dataStatus: 'NOT_RUN', gates: [],
    })).toMatchObject({
      status: 'NO_NEW_STATIC_SIGNAL',
      historicalSuspicions: 1,
      qualified: 0,
    });
  });
});
