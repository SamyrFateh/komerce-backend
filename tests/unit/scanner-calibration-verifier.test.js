'use strict';
/** @test-kind unit @test-runner node @test-requires none */
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {verify, requireProof} = require('../../scripts/audits/verify-calibration-evidence');
const {cases:CALIBRATIONS} = require('../../scripts/audits/calibration-cases.json');
const proof = (caseId,mode,pass) => ({
  caseId,mode,db:'POSTGRES_REAL',
  service: CALIBRATIONS.find(x=>x.caseId===caseId).service,
  stimulus: mode === 'DEVIATION' ? 'controlled contradiction' : undefined,
  expected:{owned:true,posted:0},observed:{owned:pass,posted:pass?0:1},invariantOK:pass
});
const sample = (guardedCase=null) => CALIBRATIONS.flatMap(c=>[
  proof(c.caseId,'NOMINAL',true),
  proof(c.caseId,'DEVIATION',c.caseId===guardedCase)
]);
const log = (...items) => items.map(x=>'CALIBRATION_EVIDENCE '+JSON.stringify(x)).join('\n');

test('manifest enrollment calibrates exactly one nominal and deviation per case',()=>{
  const result=verify([log(...sample())]);
  assert.equal(result.summary.requiredCases,CALIBRATIONS.length);
  assert.equal(result.summary.calibratedPairs,CALIBRATIONS.length);
  assert.equal(result.summary.reproducedBugs,CALIBRATIONS.length);
});
test('missing nominal, duplicate proof and missing adversarial proof fail closed',()=>{
  const items=sample();
  assert.throws(()=>verify([log(...items.filter(x=>!(x.caseId===CALIBRATIONS[0].caseId&&x.mode==='NOMINAL')))]),/exactly one NOMINAL/);
  assert.throws(()=>verify([log(items[0],...items)]),/exactly one NOMINAL/);
  assert.throws(()=>verify([log(...items.filter(x=>!(x.caseId===CALIBRATIONS[0].caseId&&x.mode==='DEVIATION')))]),/exactly one NOMINAL/);
});
test('a nominal path with broken invariant must be rejected',()=>{
  assert.throws(()=>requireProof(proof(CALIBRATIONS[0].caseId,'NOMINAL',false)),/Nominal business path/);
});
test('fabricated positive verdict conflicting with observed state is rejected',()=>{
  const fake=proof(CALIBRATIONS[0].caseId,'DEVIATION',false);
  fake.invariantOK=true;
  assert.throws(()=>requireProof(fake),/inconsistent/);
});
test('mock-only or stimulus-free deviations do not satisfy calibration',()=>{
  const mock=proof(CALIBRATIONS[0].caseId,'DEVIATION',false);
  mock.db='MOCKED_POSTGRES';
  assert.throws(()=>requireProof(mock),/Malformed/);
  const noStimulus=proof(CALIBRATIONS[0].caseId,'DEVIATION',false);
  delete noStimulus.stimulus;
  assert.throws(()=>requireProof(noStimulus),/Missing adversarial stimulus/);
});
test('a correctly guarded case is calibrated without falsely reporting a bug',()=>{
  const result=verify([log(...sample(CALIBRATIONS[0].caseId))]);
  assert.equal(result.summary.reproducedBugs,CALIBRATIONS.length-1);
  assert.equal(result.summary.guardedDeviations,1);
});
