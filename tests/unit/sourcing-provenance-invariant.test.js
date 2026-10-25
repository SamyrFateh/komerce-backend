'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * Same evaluator for price, category, weight, volume, margin and future
 * objects. Explicit negative controls distinguish missing evidence from bugs.
 */
const { evaluateAuthorityTrace } = require('../../scripts/audits/evaluate-provenance-invariant');
const e = (id, action, value, authority, scan = value) => ({
  id, action, snapshot: { value, authority, scan },
});
const run = (sequence, extras = {}) => evaluateAuthorityTrace({
  entity: 'generic-object', field: 'value', sourceField: 'authority',
  sequence, ...extras,
});

describe('generic authority precedence — governance as an executable fact', () => {
  it('preserves a manually owned field over repeat supplier imports', () => {
    const r = run([e('s0','supplier_reimport',30,'supplier'),
      e('h1','human_override',55,'manual'),
      e('s1','supplier_reimport',55,'manual'),
      e('s2','supplier_reimport',55,'manual')]);
    expect(r).toMatchObject({verdict:'INVARIANT_OBSERVED', violations:[]});
  });

  it('finds the FIRST loss of authority, before the value disappears', () => {
    const r=run([e('h1','human_override',55,'manual'),
      e('s1','supplier_reimport',55,'supplier',32),
      e('s2','supplier_reimport',33,'supplier',33)]);
    expect(r.verdict).toBe('CONTRADICTION_OBSERVED');
    expect(r.firstViolation).toMatchObject({kind:'AUTHORITY_MARKER_OVERWRITTEN',at:'s1'});
    expect(r.violations.map(x=>x.kind)).toContain('MANUAL_VALUE_OVERWRITTEN');
    expect(r.observations).toEqual(expect.arrayContaining([
      expect.objectContaining({kind:'SOURCE_SCAN_DIFFERS_FROM_EFFECTIVE_VALUE',classification:'REVIEW_REQUIRED'})
    ]));
  });

  it('allows an authorized SECOND human edit to become the current authority', () => {
    const r=run([e('h1','human_override',55,'manual'),
      e('s1','supplier_reimport',55,'manual'),
      e('h2','human_override',65,'manual'),
      e('s2','supplier_reimport',65,'manual')]);
    expect(r).toMatchObject({verdict:'INVARIANT_OBSERVED',manualValue:65,violations:[]});
  });

  it('does not flag supplier refresh without any human override', () => {
    expect(run([e('s0','supplier_reimport',30,'supplier'),
      e('s1','supplier_reimport',32,'supplier')])).toMatchObject({
      verdict:'NO_MANUAL_ASSERTION',violations:[]
    });
  });

  it('a human action without its provenance is insufficient to infer the lock', () => {
    expect(run([e('h1','human_override',55,'supplier'),
      e('s1','supplier_reimport',32,'supplier')])).toMatchObject({
      verdict:'NO_MANUAL_ASSERTION',violations:[]
    });
  });

  it('reports incomplete snapshots explicitly instead of fabricating results', () => {
    expect(run([e('h1','human_override',null,'manual'),
      e('s1','supplier_reimport',32,'supplier')]).verdict).toBe('INSUFFICIENT_EVIDENCE');
    const r=run([e('h1','human_override',55,'manual'),
      {id:'s1',action:'supplier_reimport',snapshot:null}]);
    expect(r.violations[0].kind).toBe('MISSING_POST_ACTION_EVIDENCE');
  });

  it('treats a raw supplier scan versus effective manual value as REVIEW, not a bug', () => {
    const r=run([e('h1','human_override',55,'manual'),
      e('s1','supplier_reimport',55,'manual',32)],{scanField:'scan'});
    expect(r.verdict).toBe('INVARIANT_OBSERVED');
    expect(r.observations[0]).toMatchObject({
      kind:'SOURCE_SCAN_DIFFERS_FROM_EFFECTIVE_VALUE',classification:'REVIEW_REQUIRED',
    });
  });

  it('rejects a derived scan discrepancy only when governed as effective', () => {
    const r=run([e('h1','human_override',55,'manual'),
      e('s1','supplier_reimport',55,'manual',32)],{scanField:'scan',scanSemantics:'effective'});
    expect(r).toMatchObject({verdict:'CONTRADICTION_OBSERVED'});
    expect(r.firstViolation.kind).toBe('DERIVED_SCAN_DISAGREES_WITH_PERSISTED_FIELD');
  });
});
