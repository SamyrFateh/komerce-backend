'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const {
  normalizeJobs,
  gateImpact,
  computeReuse,
} = require('../../scripts/ci-gate-reuse');

const greenJobs = normalizeJobs({ jobs: [
  { name:'Backend gates', conclusion:'failure' },
  { name:'Migration and schema gates', conclusion:'success' },
  { name:'From-scratch DB + integration + E2E API', conclusion:'success' },
  { name:'Dashboard canonical gates', conclusion:'success' },
  { name:'Boutique source gates', conclusion:'skipped' },
  { name:'Governance and feature-first gates', conclusion:'success' },
  { name:'Isolated provider contract proof gates', conclusion:'skipped' },
] });

describe('CI per-gate green proof reuse', () => {
  test('maps delta scope to gate impact', () => {
    expect(gateImpact({
      backend:true,
      golden:false,
      migrations:false,
      dbRebuildRequired:false,
      integrationRequired:false,
      e2eApiRequired:false,
      dashboard:false,
      boutique:false,
      governance:true,
      providerProofOnly:false,
    })).toEqual({
      backend:true,
      migrations:false,
      from_scratch:false,
      dashboard:false,
      boutique:false,
      governance:true,
      provider_contracts:false,
    });
  });

  test('reuses green DB gates after a backend-only repair delta', () => {
    const result = computeReuse({
      previousHead:'old',
      currentHead:'new',
      currentBase:'base',
      jobs:greenJobs,
      ancestor:true,
      baseContained:true,
      scope:{
        backend:true,
        golden:false,
        migrations:false,
        dbRebuildRequired:false,
        integrationRequired:false,
        e2eApiRequired:false,
        dashboard:false,
        boutique:false,
        governance:true,
        providerProofOnly:false,
      },
    });

    expect(result.reuse.backend).toBe(false);
    expect(result.reuse.migrations).toBe(true);
    expect(result.reuse.from_scratch).toBe(true);
    expect(result.reuse.dashboard).toBe(true);
    expect(result.reuse.governance).toBe(false);
  });

  test('never reuses a previously failed or skipped job', () => {
    const result = computeReuse({
      previousHead:'old',
      currentHead:'new',
      currentBase:'base',
      jobs:greenJobs,
      ancestor:true,
      baseContained:true,
      scope:{
        backend:false, golden:false, migrations:false,
        dbRebuildRequired:false, integrationRequired:false, e2eApiRequired:false,
        dashboard:false, boutique:false, governance:false, providerProofOnly:false,
      },
    });
    expect(result.reuse.backend).toBe(false);
    expect(result.reuse.boutique).toBe(false);
    expect(result.reuse.provider_contracts).toBe(false);
  });

  test('migration delta invalidates migration and from-scratch reuse', () => {
    const result = computeReuse({
      previousHead:'old',
      currentHead:'new',
      currentBase:'base',
      jobs:greenJobs,
      ancestor:true,
      baseContained:true,
      scope:{
        backend:false, golden:false, migrations:true,
        dbRebuildRequired:true, integrationRequired:true, e2eApiRequired:false,
        dashboard:false, boutique:false, governance:true, providerProofOnly:false,
      },
    });
    expect(result.reuse.migrations).toBe(false);
    expect(result.reuse.from_scratch).toBe(false);
  });

  test.each([
    ['previous-head-not-ancestor', false, true],
    ['current-base-not-contained-in-previous-head', true, false],
  ])('fails closed on ancestry proof: %s', (reason, ancestor, baseContained) => {
    const result = computeReuse({
      previousHead:'old',
      currentHead:'new',
      currentBase:'base',
      jobs:greenJobs,
      ancestor,
      baseContained,
      scope:{},
    });
    expect(result.reason).toBe(reason);
    expect(Object.values(result.reuse).every(value => value === false)).toBe(true);
  });
});


describe('CI coverage proof reuse', () => {
  const allGreenJobs = normalizeJobs({ jobs: [
    { name:'Backend gates', conclusion:'success' },
    { name:'Migration and schema gates', conclusion:'success' },
    { name:'From-scratch DB + integration + E2E API', conclusion:'success' },
    { name:'Dashboard canonical gates', conclusion:'success' },
    { name:'Boutique source gates', conclusion:'success' },
    { name:'Governance and feature-first gates', conclusion:'success' },
    { name:'Isolated provider contract proof gates', conclusion:'success' },
  ] });

  test('reuses coverage proof for test-only delta while backend itself still reruns', () => {
    const result = computeReuse({
      previousHead:'old', currentHead:'new', currentBase:'base',
      jobs:allGreenJobs, ancestor:true, baseContained:true,
      scope:{
        backend:true, backendSource:false, golden:false, migrations:false,
        dbRebuildRequired:false, integrationRequired:false, e2eApiRequired:false,
        dashboard:false, boutique:false, governance:true, providerProofOnly:false,
      },
    });
    expect(result.reuse.backend).toBe(false);
    expect(result.reuseCoverage).toBe(true);
    expect(result.coverageReason).toBe('previous-green-coverage-reused-no-source-delta');
  });

  test('never reuses coverage when instrumented backend source changed', () => {
    const result = computeReuse({
      previousHead:'old', currentHead:'new', currentBase:'base',
      jobs:allGreenJobs, ancestor:true, baseContained:true,
      scope:{
        backend:true, backendSource:true, golden:false, migrations:false,
        dbRebuildRequired:false, integrationRequired:false, e2eApiRequired:false,
        dashboard:false, boutique:false, governance:true, providerProofOnly:false,
      },
    });
    expect(result.reuseCoverage).toBe(false);
    expect(result.coverageReason).toBe('latest-delta-touches-instrumented-source');
  });

  test('fails closed for coverage without a previous green backend proof', () => {
    const result = computeReuse({
      previousHead:'old', currentHead:'new', currentBase:'base',
      jobs:greenJobs, ancestor:true, baseContained:true,
      scope:{ backend:true, backendSource:false },
    });
    expect(result.reuseCoverage).toBe(false);
    expect(result.coverageReason).toBe('previous-backend-not-green');
  });
});
