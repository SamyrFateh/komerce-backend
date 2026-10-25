'use strict';
/** @test-kind unit @test-runner node @test-requires none */
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {verify, requireProof} = require('../../scripts/audits/verify-calibration-evidence');

const proof = (caseId,mode,pass) => ({
  caseId,mode,db:'POSTGRES_REAL',
  service: caseId === 'INVENTORY_CROSS_ORDER' ? 'inventory.receiveItem' : 'auto-parcel.distributeOrder',
  stimulus: mode === 'DEVIATION' ? 'controlled contradiction' : undefined,
  expected:{owned:true,posted:0},observed:{owned:pass,posted: pass?0:1},invariantOK:pass
});
function log(...records) {
  return records.map(x=>'CALIBRATION_EVIDENCE '+JSON.stringify(x)).join('\n');
}
test('calibration requires two separate proven modes for each domain',()=>{
  const items=[
    proof('INVENTORY_CROSS_ORDER','NOMINAL',true),
    proof('INVENTORY_CROSS_ORDER','DEVIATION',false),
    proof('AUTO_PARCEL_SILENT_CONFLICT','NOMINAL',true),
    proof('AUTO_PARCEL_SILENT_CONFLICT','DEVIATION',false),
  ];
  const result=verify([log(...items.slice(0,2)),log(...items.slice(2))]);
  assert.equal(result.summary.calibratedPairs,2);
  assert.equal(result.summary.reproducedBugs,2);
});
test('missing nominal, duplicate or absent deviation evidence fail closed',()=>{
  const a=proof('INVENTORY_CROSS_ORDER','NOMINAL',true);
  const b=proof('INVENTORY_CROSS_ORDER','DEVIATION',false);
  const c=proof('AUTO_PARCEL_SILENT_CONFLICT','NOMINAL',true);
  const d=proof('AUTO_PARCEL_SILENT_CONFLICT','DEVIATION',false);
  assert.throws(()=>verify([log(b,c,d)]),/exactly one NOMINAL/);
  assert.throws(()=>verify([log(a,a,b,c,d)]),/exactly one NOMINAL/);
  assert.throws(()=>verify([log(a,c,d)]),/exactly one NOMINAL/);
});
test('a nominal path with broken invariant must be rejected',()=>{
  assert.throws(()=>requireProof(proof('INVENTORY_CROSS_ORDER','NOMINAL',false)),/Nominal business path/);
});
test('an invented positive verdict inconsistent with observations must be rejected',()=>{
  const fake=proof('AUTO_PARCEL_SILENT_CONFLICT','DEVIATION',false);
  fake.invariantOK=true;
  assert.throws(()=>requireProof(fake),/inconsistent/);
});
test('mock-only evidence or a deviation without stimulus cannot count as calibrated',()=>{
  const mock=proof('INVENTORY_CROSS_ORDER','DEVIATION',false);
  mock.db='MOCKED_POSTGRES';
  assert.throws(()=>requireProof(mock),/Malformed/);
  const noStimulus=proof('INVENTORY_CROSS_ORDER','DEVIATION',false);
  delete noStimulus.stimulus;
  assert.throws(()=>requireProof(noStimulus),/Missing adversarial stimulus/);
});
test('a correctly guarded deviation remains calibrated but is not a reproduced bug',()=>{
  const items=[
    proof('INVENTORY_CROSS_ORDER','NOMINAL',true),
    proof('INVENTORY_CROSS_ORDER','DEVIATION',true),
    proof('AUTO_PARCEL_SILENT_CONFLICT','NOMINAL',true),
    proof('AUTO_PARCEL_SILENT_CONFLICT','DEVIATION',false),
  ];
  const result=verify([log(...items)]);
  assert.equal(result.summary.reproducedBugs,1);
  assert.equal(result.summary.guardedDeviations,1);
});
