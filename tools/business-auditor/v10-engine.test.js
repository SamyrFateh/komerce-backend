'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {triage,certify,reportMarkdown}=require('./v10-engine');
const {ORACLES}=require('./v10-oracles');
const sha='a'.repeat(40),meta={sha,runId:'1234'},oracle=ORACLES[0];
function evidence(keysEqual=false){
 const qualification={contract:'komerce-business-writer-qualification/v1',
  cases:[{file:'services/x.js',table:'orders',status:'OWNER_MISSING',
   occurrences:2,owners:[],directQueryCandidates:1,needsReview:true,
   priority:'MEDIUM'},
   {file:'services/y.js',table:'parcels',status:'OWNER_DECLARED',
    occurrences:1,owners:['logistics'],directQueryCandidates:1,needsReview:false}],
  findings:[{},{},{}],
  summary:{occurrences:3,cases:2,reviewCases:1}};
 const audit={git:{sha},code:{writerInventory:{summary:{candidateWrites:3}},
  writerQualification:qualification}};
 const v09={contract:'komerce-independent-business-evidence/v09',sha,runId:'1234',
  summary:{candidateOccurrences:3,v07ReviewCases:1,caseCoverageComplete:false}};
 const jest={success:true,numFailedTests:0,numPassedTests:1,testResults:[{
  name:'/test-repo/'+oracle.harness,
  assertionResults:[{title:oracle.testTitle,status:'passed'}]}]};
 const observation={contract:oracle.evidenceContract,scope:oracle.evidenceScope,
  oracle:'SAME_LOGICAL_REFUND_RETRY_REQUIRES_STABLE_PROVIDER_REQUEST_KEY',
  ownerRetries:2,clientControlRetries:2,samePayload:true,ownerKeysEqual:keysEqual,
  durableClientKeysEqual:true,fakeTimeouts:4,localRefundWrites:0,
  providerCallsReal:0,realMoneyMovementObserved:false,productionIncidentProven:false};
 return {audit,v09,jest,observation};
}
test('a controlled deviation becomes a scoped test finding, never a production incident',()=>{
 const r=certify(evidence(false),meta);
 assert.equal(r.summary.controlledTestViolations,1);
 assert.equal(r.summary.productionIncidentsConfirmed,0);
 assert.equal(r.summary.reviewCases,1);
 assert.equal(r.findings[0].verdict,'REPRODUCED_CONTROLLED_TEST_INVARIANT_VIOLATION');
 assert.equal(r.findings[0].duplicateExternalRefundConfirmed,false);
 assert.match(reportMarkdown(r),/CONTROLLED_TEST_INVARIANT_VIOLATION/);
});
test('a later fixed owner yields a normal verdict without making CI fail',()=>{
 const r=certify(evidence(true),meta);
 assert.equal(r.summary.controlledTestViolations,0);
 assert.equal(r.findings[0].verdict,'CONTROLLED_TEST_INVARIANT_SATISFIED');
});
test('stale, missing or faked test proof fails closed',()=>{
 const a=evidence();
 a.jest.testResults[0].assertionResults[0].title='Fake test';
 assert.throws(()=>certify(a,meta),/absent\/duplicated/);
 const b=evidence();b.v09.runId='older';
 assert.throws(()=>certify(b,meta),/stale/);
 const c=evidence();c.observation.durableClientKeysEqual=false;
 assert.throws(()=>certify(c,meta),/calibration missing/);
 const d=evidence();d.observation.providerCallsReal=1;
 assert.throws(()=>certify(d,meta),/calibration missing/);
 const e=evidence();e.jest.numPassedTests=0;
 assert.throws(()=>certify(e,meta),/Jest proof incomplete/);
});
test('V0.7 queue preserves every occurrence and never promotes static hints',()=>{
 const input=evidence().audit.code.writerQualification;
 const q=triage(input);
 assert.equal(q.totalOccurrences,3);assert.equal(q.totalCases,2);
 assert.equal(q.reviewCases,1);assert.equal(q.confirmedBugs,0);
 assert.equal(q.cases.every(x=>x.verifiedCallPath===false&&x.confirmedBug===false),true);
 const bad=structuredClone(input);bad.cases[0].occurrences=1;
 assert.throws(()=>triage(bad),/lost candidate/);
});
