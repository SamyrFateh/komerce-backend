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
