'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {evaluateAuthorityTrace}=require('./evaluate-provenance-invariant');

const event=(id,action,value,source,scan=value)=>({id,action,snapshot:{value,provenance:source,scan}});
const evaluate=sequence=>evaluateAuthorityTrace({
  entity:'candidate-1',field:'value',sourceField:'provenance',
  scanField:'scan',sequence,
});

test('preserved manual field and compatible derived scan: no bug',()=>{
  const r=evaluate([
    event('initial','supplier_reimport',30,'supplier'),
    event('human','human_override',55,'manual',55),
    event('one','supplier_reimport',55,'manual',55),
    event('two','supplier_reimport',55,'manual',55),
  ]);
  assert.equal(r.verdict,'INVARIANT_OBSERVED');
  assert.equal(r.violations.length,0);
});

test('authority marker overwritten first, then the value: both transitions identifiable',()=>{
  const r=evaluate([
    event('initial','supplier_reimport',30,'supplier'),
    event('human','human_override',55,'manual',55),
    event('one','supplier_reimport',55,'supplier',32),
    event('two','supplier_reimport',33,'supplier',33),
  ]);
  assert.equal(r.verdict,'CONTRADICTION_OBSERVED');
  assert.deepEqual(r.violations.map(x=>x.kind),[
    'AUTHORITY_MARKER_OVERWRITTEN',
    'AUTHORITY_MARKER_OVERWRITTEN','MANUAL_VALUE_OVERWRITTEN',
  ]);
  assert.equal(r.observations[0].kind,'SOURCE_SCAN_DIFFERS_FROM_EFFECTIVE_VALUE');
  assert.equal(r.observations[0].classification,'REVIEW_REQUIRED');
  assert.equal(r.firstViolation.at,'one');
});

test('supplier refresh without manual edit is not a false-positive',()=>{
  const r=evaluate([
    event('initial','supplier_reimport',30,'supplier'),
    event('one','supplier_reimport',32,'supplier'),
  ]);
  assert.equal(r.verdict,'NO_MANUAL_ASSERTION');
  assert.equal(r.violations.length,0);
});

test('missing explicit manual provenance is NOT proof of a broken override',()=>{
  const r=evaluate([
    event('initial','supplier_reimport',30,'supplier'),
    event('human','human_override',55,'supplier'),
    event('one','supplier_reimport',32,'supplier'),
  ]);
  assert.equal(r.verdict,'NO_MANUAL_ASSERTION');
});

test('no actual manual value means insufficient evidence, not bug',()=>{
  const r=evaluate([
    event('human','human_override',null,'manual'),
    event('one','supplier_reimport',32,'supplier'),
  ]);
  assert.equal(r.verdict,'INSUFFICIENT_EVIDENCE');
});

test('a second explicit human edit supersedes the previous human value',()=>{
  const r=evaluate([
    event('initial','supplier_reimport',30,'supplier'),
    event('human-one','human_override',55,'manual'),
    event('supplier-one','supplier_reimport',55,'manual'),
    event('human-two','human_override',65,'manual'),
    event('supplier-two','supplier_reimport',65,'manual'),
  ]);
  assert.equal(r.verdict,'INVARIANT_OBSERVED');
  assert.equal(r.manualValue,65);
  assert.equal(r.violations.length,0);
});

test('supplier-origin scan differing from manual decision is a review signal, not a proven invariant breach',()=>{
  const r=evaluate([
    event('initial','supplier_reimport',30,'supplier'),
    event('human','human_override',55,'manual'),
    event('supplier','supplier_reimport',55,'manual',32),
  ]);
  assert.equal(r.verdict,'INVARIANT_OBSERVED');
  assert.equal(r.violations.length,0);
  assert.equal(r.observations[0].kind,'SOURCE_SCAN_DIFFERS_FROM_EFFECTIVE_VALUE');
});

test('scan explicitly governed as effective must still match effective candidate value',()=>{
  const r=evaluateAuthorityTrace({
    entity:'candidate-1',field:'value',sourceField:'provenance',
    scanField:'scan',scanSemantics:'effective',
    sequence:[
      event('human','human_override',55,'manual'),
      event('supplier','supplier_reimport',55,'manual',32),
    ],
  });
  assert.equal(r.verdict,'CONTRADICTION_OBSERVED');
  assert.equal(r.violations[0].kind,'DERIVED_SCAN_DISAGREES_WITH_PERSISTED_FIELD');
});
