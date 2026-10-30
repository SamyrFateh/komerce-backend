'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {triage,certify,reportMarkdown}=require('./v10-engine');
const {ORACLES}=require('./v10-oracles');
const sha='a'.repeat(40),meta={sha,runId:'1234'};
function evidence(paypalStable=false,parcelAccurate=false){
 const qualification={contract:'komerce-business-writer-qualification/v1',
  cases:[{file:'services/x.js',table:'orders',status:'OWNER_MISSING',occurrences:2,owners:[],directQueryCandidates:1,needsReview:true},
   {file:'services/y.js',table:'parcels',status:'OWNER_DECLARED',occurrences:1,owners:['logistics'],directQueryCandidates:1,needsReview:false}],
  findings:[{},{},{}],summary:{occurrences:3,cases:2,reviewCases:1}};
 const audit={git:{sha},code:{writerInventory:{summary:{candidateWrites:3}},writerQualification:qualification}};
 const v09={contract:'komerce-independent-business-evidence/v09',sha,runId:'1234',
  summary:{candidateOccurrences:3,v07ReviewCases:1,caseCoverageComplete:false}};
 const proofs={};
 for(const oracle of ORACLES){
  const observation={contract:oracle.evidenceContract,scope:oracle.evidenceScope,
   oracle:oracle.observationOracle,...oracle.expectedControls,
   [oracle.observationField]:oracle.id.includes('PAYPAL')?paypalStable:parcelAccurate,
   ...oracle.id.includes('LOGISTICS')?{adversarialReported:parcelAccurate?0:1}:{}};
  const jest={success:true,numFailedTests:0,numPassedTests:1,testResults:[{
   name:'/test-repo/'+oracle.harness,assertionResults:[{title:oracle.testTitle,status:'passed'}]}]};
  proofs[oracle.id]={observation,jest};
 }
 return {audit,v09,proofs};
}
test('two real owner probes can demonstrate independently scoped test violations',()=>{
 const r=certify(evidence(false,false),meta);
 assert.equal(r.summary.calibratedRuntimeOracles,2);
 assert.equal(r.summary.controlledTestViolations,2);
 assert.equal(r.summary.productionIncidentsConfirmed,0);
 assert.equal(r.summary.reviewCases,1);
 assert.equal(r.findings.every(x=>x.verdict==='REPRODUCED_CONTROLLED_TEST_INVARIANT_VIOLATION'),true);
 assert.equal(r.findings.every(x=>x.productionIncidentConfirmed===false),true);
 assert.match(reportMarkdown(r),/KBA-V11-LOGISTICS-PARCEL-COUNT/);
});
test('a future fixed owner becomes satisfying without changing the independent oracle',()=>{
 const r=certify(evidence(true,true),meta);
 assert.equal(r.summary.controlledTestViolations,0);
 assert.equal(r.findings.every(x=>x.verdict==='CONTROLLED_TEST_INVARIANT_SATISFIED'),true);
});
test('partial evidence is rejected, not silently counted as lower coverage',()=>{
 const a=evidence();delete a.proofs['KBA-V11-LOGISTICS-PARCEL-COUNT'];
 assert.throws(()=>certify(a,meta),/exactly one paired/);
 const b=evidence();b.v09.runId='older';
 assert.throws(()=>certify(b,meta),/stale/);
 const c=evidence();c.proofs['KBA-V11-LOGISTICS-PARCEL-COUNT'].observation.adversarialSqlRowCount=1;
 assert.throws(()=>certify(c,meta),/calibration missing/);
 const d=evidence();d.proofs['KBA-V10-RC9-PAYPAL-RETRY'].observation.providerCallsReal=1;
 assert.throws(()=>certify(d,meta),/calibration missing/);
 const e=evidence();e.proofs['KBA-V11-LOGISTICS-PARCEL-COUNT'].jest.numPassedTests=0;
 assert.throws(()=>certify(e,meta),/Jest proof incomplete/);
 const g=evidence();g.proofs['KBA-V11-LOGISTICS-PARCEL-COUNT'].jest.testResults[0].assertionResults[0].title='forged';
 assert.throws(()=>certify(g,meta),/absent\/duplicated/);
});
test('V0.7 queue retains source occurrences; identifiers remain stable when order changes',()=>{
 const q=evidence().audit.code.writerQualification;
 const x=triage(q);
 assert.equal(x.totalOccurrences,3);assert.equal(x.totalCases,2);
 assert.equal(x.reviewCases,1);assert.equal(x.confirmedBugs,0);
 assert.equal(x.cases.every(c=>!c.verifiedCallPath&&!c.confirmedBug),true);
 const oldId=x.cases.find(c=>c.file==='services/x.js').id;
 const reordered=structuredClone(q);reordered.cases.reverse();
 assert.equal(triage(reordered).cases.find(c=>c.file==='services/x.js').id,oldId);
 const lost=structuredClone(q);lost.cases[0].occurrences=1;
 assert.throws(()=>triage(lost),/lost candidate/);
});
test('two competing classifications of one writer and table fail closed',()=>{
 const q=structuredClone(evidence().audit.code.writerQualification);
 q.cases[1].file=q.cases[0].file;q.cases[1].table=q.cases[0].table;
 assert.throws(()=>triage(q),/conflicting case identity/);
});
