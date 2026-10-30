'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {consolidate}=require('./v09-integration');
const sha='a'.repeat(40),meta={sha,runId:'123'};
function fixtures(){
 const inventory={contract:'komerce-business-writer-inventory/v1',
  summary:{candidateWrites:2,physicalTableCandidates:1,notProvenTableCandidates:1},
  writes:[
   {file:'services/orders.js',table:'orders',line:12,action:'UPDATE',
    physicalTableDeclared:true,declaredDomain:'orders',explicitOwners:['orders'],
    ownerResolution:'OWNER_DOMAIN_MATCH_DECLARATION',primaryGrainRules:[]},
   {file:'routes/dynamic.js',line:25,table:null,rawTarget:'dynamic',
    physicalTableDeclared:false,schemaEvidence:'DYNAMIC_TARGET_UNKNOWN'}
  ]};
 const audit={contract:'komerce-independent-business-auditor/v1',git:{sha},
  code:{writerInventory:inventory,writerQualification:{summary:{occurrences:2,
   physical:1,unresolved:1,reviewCases:1}}}};
 const sql={contract:'komerce-business-sql-calibration/v08',
  summary:{nominalPassed:7,adversarialDetected:7,rollbackPassed:7,
   businessWriterExecutions:0,confirmedBusinessBugs:0},
  results:Array.from({length:7},(_,i)=>({id:'KBA-00'+(i+1),
   nominal:'NO_SIGNAL_IN_TEMP_FIXTURE',
   adversarial:'INJECTED_COUNTEREXAMPLE_FOUND',rollbackRestored:true,
   proof:'REAL_POSTGRESQL_TEMP_SHADOW_TABLES_NOT_CANONICAL_WRITER'}))};
 const owner={contract:'komerce-business-owner-replay-evidence/v08',sha,
  runId:'123',testsPassed:3,provider:'MOCK_HTTP_NO_REAL_PSP',
  productionIncidentConfirmed:false,duplicateMoneyMovementProven:false};
 return {audit,sql,owner};
}
test('V0.9 reconciles all levels without certifying application correctness',()=>{
 const {audit,sql,owner}=fixtures();
 const r=consolidate(audit,sql,owner,meta);
 assert.equal(r.summary.candidateOccurrences,2);
 assert.equal(r.summary.distinctPhysicalCases,1);
 assert.equal(r.summary.distinctUnresolvedCases,1);
 assert.equal(r.summary.pairedSqlDetectors,7);
 assert.equal(r.summary.mockedOwnerTests,3);
 assert.equal(r.summary.productionIncidentsConfirmed,0);
 assert.equal(r.summary.caseCoverageComplete,false);
});
test('V0.9 rejects stale CI sources and missing calibration',()=>{
 const {audit,sql,owner}=fixtures();owner.runId='different';
 assert.throws(()=>consolidate(audit,sql,owner,meta),/different commit\/run/);
 owner.runId='123';sql.summary.nominalPassed=6;
 assert.throws(()=>consolidate(audit,sql,owner,meta),/calibration incomplete/);
});
test('V0.9 rejects dropped source occurrences and real-money overclaims',()=>{
 const {audit,sql,owner}=fixtures();
 audit.code.writerQualification.summary.unresolved=0;
 assert.throws(()=>consolidate(audit,sql,owner,meta),/candidate loss/);
 audit.code.writerQualification.summary.unresolved=1;
 owner.duplicateMoneyMovementProven=true;
 assert.throws(()=>consolidate(audit,sql,owner,meta),/proof incomplete/);
});
