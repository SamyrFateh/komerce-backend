'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const {
  isSafeUnitTestFile,
  extractFailedUnitTests,
  normalizeJobs,
  qualifiesUnitRepair,
} = require('../../scripts/ci-unit-repair-scope');

function jobs({
  backendConclusion = 'failure',
  failedStep = 'Unit test coverage threshold',
  dashboardConclusion = 'success',
  governanceConclusion = 'success',
  fromScratchConclusion = 'success',
} = {}) {
  return [
    { name:'Detect PR scope', conclusion:'success', steps:[] },
    {
      name:'Backend gates',
      conclusion:backendConclusion,
      steps:[
        { name:'Related unit tests', conclusion:'success' },
        { name:'Unit test coverage threshold', conclusion:failedStep === 'Unit test coverage threshold' ? 'failure' : 'success' },
        ...(failedStep && failedStep !== 'Unit test coverage threshold'
          ? [{ name:failedStep, conclusion:'failure' }]
          : []),
      ],
    },
    { name:'Dashboard canonical gates', conclusion:dashboardConclusion, steps:[] },
    { name:'From-scratch DB + integration + E2E API', conclusion:fromScratchConclusion, steps:[] },
    { name:'Governance and feature-first gates', conclusion:governanceConclusion, steps:[] },
    { name:'Migration and schema gates', conclusion:'skipped', steps:[] },
    { name:'Boutique source gates', conclusion:'skipped', steps:[] },
    { name:'Isolated provider contract proof gates', conclusion:'skipped', steps:[] },
    { name:'Required verdict', conclusion:'failure', steps:[] },
  ];
}

describe('CI targeted unit repair classifier', () => {
  test('recognizes only root unit-test files as safe repair delta', () => {
    expect(isSafeUnitTestFile('tests/unit/foo.test.js')).toBe(true);
    expect(isSafeUnitTestFile('tests/unit/a/b.spec.ts')).toBe(true);
    expect(isSafeUnitTestFile('services/foo.js')).toBe(false);
    expect(isSafeUnitTestFile('tests/integration/foo.test.js')).toBe(false);
    expect(isSafeUnitTestFile('.github/workflows/pr-enforcement.yml')).toBe(false);
  });

  test('extracts exact failing Jest unit files from logs', () => {
    const log = [
      '2026-09-29T17:12:09.0000000Z PASS tests/unit/ok.test.js',
      '2026-09-29T17:13:52.0000000Z FAIL tests/unit/canonical-dashboard-boundary.test.js',
      '2026-09-29T17:13:52.1000000Z   ● suite › case',
      '2026-09-29T17:13:53.0000000Z FAIL tests/unit/import-runtime-journey.test.js',
    ].join('\n');
    expect(extractFailedUnitTests(log)).toEqual([
      'tests/unit/canonical-dashboard-boundary.test.js',
      'tests/unit/import-runtime-journey.test.js',
    ]);
  });

  test('normalizes GitHub jobs payload including failed steps', () => {
    const model = normalizeJobs({ jobs:[{
      id:123,
      name:'Backend gates',
      conclusion:'failure',
      steps:[{ name:'Unit test coverage threshold', conclusion:'failure' }],
    }] });
    expect(model).toEqual([{
      id:123,
      name:'Backend gates',
      conclusion:'failure',
      steps:[{ name:'Unit test coverage threshold', conclusion:'failure' }],
    }]);
  });

  test('allows exact unit-test-only repair after the sole backend coverage failure', () => {
    expect(qualifiesUnitRepair({
      changedFiles:['tests/unit/canonical-dashboard-boundary.test.js'],
      failedTests:['tests/unit/canonical-dashboard-boundary.test.js'],
      jobs:jobs(),
    })).toEqual({
      qualifies:true,
      reason:'safe-targeted-unit-repair',
      files:['tests/unit/canonical-dashboard-boundary.test.js'],
    });
  });

  test('requires every previous failing unit test to be covered by the repair delta', () => {
    expect(qualifiesUnitRepair({
      changedFiles:['tests/unit/a.test.js'],
      failedTests:['tests/unit/a.test.js','tests/unit/b.test.js'],
      jobs:jobs(),
    })).toMatchObject({
      qualifies:false,
      reason:'latest-delta-does-not-cover-all-failing-tests',
    });
  });

  test.each([
    [['services/orders.js'], 'latest-delta-is-not-unit-tests-only'],
    [['tests/unit/a.test.js','services/orders.js'], 'latest-delta-is-not-unit-tests-only'],
  ])('runtime delta %j always falls back to full CI', (changedFiles, reason) => {
    expect(qualifiesUnitRepair({
      changedFiles,
      failedTests:['tests/unit/a.test.js'],
      jobs:jobs(),
    })).toMatchObject({ qualifies:false, reason });
  });

  test('another red scoped job forbids targeted repair', () => {
    expect(qualifiesUnitRepair({
      changedFiles:['tests/unit/a.test.js'],
      failedTests:['tests/unit/a.test.js'],
      jobs:jobs({ dashboardConclusion:'failure' }),
    })).toMatchObject({
      qualifies:false,
      reason:'another-previous-job-was-not-green:Dashboard canonical gates:failure',
    });
  });

  test('a backend failure outside the full unit coverage step forbids targeted repair', () => {
    expect(qualifiesUnitRepair({
      changedFiles:['tests/unit/a.test.js'],
      failedTests:['tests/unit/a.test.js'],
      jobs:jobs({ failedStep:'Quality gate' }),
    })).toMatchObject({
      qualifies:false,
      reason:'previous-backend-failure-is-not-unit-coverage-step',
    });
  });

  test('golden scope never uses the unit-repair shortcut', () => {
    expect(qualifiesUnitRepair({
      changedFiles:['tests/unit/a.test.js'],
      failedTests:['tests/unit/a.test.js'],
      jobs:jobs(),
      golden:true,
    })).toMatchObject({
      qualifies:false,
      reason:'golden-scope-needs-full-backend-job',
    });
  });
});
