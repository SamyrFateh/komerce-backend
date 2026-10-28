'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {makeEvidenceLedger,assessProof}=require('./evidence-ledger');
const base=(owner='orders')=>({contract:'komerce-business-writer-inventory/v1',writes:[
 {file:'routes/orders.js',line:20,table:'orders',physicalTableDeclared:true,
  ownerResolution:'OWNER_DOMAIN_MATCH_DECLARATION',declaredDomain:owner,
  explicitOwners:['orders'],primaryGrainRules:[],binding:'DIRECT_QUERY_ARGUMENT',action:'UPDATE'},
 {file:'routes/orders.js',line:40,table:'orders',physicalTableDeclared:true,
  ownerResolution:'OWNER_DOMAIN_MATCH_DECLARATION',declaredDomain:owner,
  explicitOwners:['orders'],primaryGrainRules:[],binding:'DIRECT_QUERY_ARGUMENT',action:'UPDATE'},
 {file:'routes/dynamic.js',line:30,table:'set',rawTarget:'set',physicalTableDeclared:false,
  schemaEvidence:'NOT_IN_CHECKED_IN_SCHEMA_REVIEW'}]});
test('V0.9 conserves grouped physical and unresolved candidate occurrences',()=>{
 const a=makeEvidenceLedger(base());
 assert.equal(a.summary.sourceOccurrences,2);
 assert.equal(a.summary.unresolvedOccurrences,1);
 assert.equal(a.summary.allCandidateOccurrences,3);
 assert.equal(a.summary.distinctCases,1);
 assert.equal(a.summary.distinctUnresolvedCases,1);
 assert.equal(a.entries[0].occurrenceCount,2);
 assert.equal(a.unresolvedEntries[0].occurrenceCount,1);
 assert.equal(a.summary.confirmedProductionIncidents,0);
});
test('case ID persists across domain declaration changes',()=>{
 const id=makeEvidenceLedger(base()).entries[0].id;
 assert.equal(makeEvidenceLedger(base('billing')).entries[0].id,id);
});
test('no untrusted self-reported pair can be certified as a confirmed bug',()=>{
 const e=(expected,observed)=>({environment:'LOCAL_DISPOSABLE_TEST',
  test:'tests/example.js',commit:'a'.repeat(40),executed:true,observation:'reported',
  expected,observed});
 const input={nominal:e('ok','ok'),adversarial:e('reject','accepted'),
  independentReview:{approved:true,reviewer:'owner',issue:'#1'}};
 assert.equal(assessProof(input).verdict,'ATTESTED_DEVIATION_PENDING_TRUSTED_CI');
 assert.equal(assessProof({}).verdict,'UNVERIFIED_STATIC_SIGNAL');
});
test('unknown proof IDs fail closed',()=>{
 assert.throws(()=>makeEvidenceLedger(base(),{proofs:{unknown:{}}}),/unknown finding IDs/);
});
