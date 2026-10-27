'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {makeEvidenceLedger,assessProof}=require('./evidence-ledger');
const sha='a'.repeat(40);
const evt=(expected,observed)=>({environment:'LOCAL_DISPOSABLE_TEST',test:'tests/physical.test.js',
 commit:sha,executed:true,observation:'real PostgreSQL response',expected,observed});
const inventory={contract:'komerce-business-writer-inventory/v1',writes:[
 {file:'services/a.js',table:'orders',physicalTableDeclared:true,line:10,action:'UPDATE',
  binding:'DIRECT_QUERY_ARGUMENT',ownerResolution:'CROSS_DOMAIN_WRITE_REVIEW',
  declaredDomain:'payments',explicitOwners:['orders'],primaryGrainRules:['KBA-001']},
 {file:'services/a.js',table:'orders',physicalTableDeclared:true,line:20,action:'UPDATE',
  ownerResolution:'CROSS_DOMAIN_WRITE_REVIEW',declaredDomain:'payments',
  explicitOwners:['orders'],primaryGrainRules:[]},
 {file:'services/b.js',table:'orders',physicalTableDeclared:true,line:40,
  ownerResolution:'OWNER_DOMAIN_MATCH_DECLARATION',declaredDomain:'orders',explicitOwners:['orders']},
 {file:'services/c.js',table:'set',physicalTableDeclared:false,line:1},
]};
test('groups occurrences deterministically and distinguishes review from authorization',()=>{
 const a=makeEvidenceLedger(inventory),b=makeEvidenceLedger(inventory);
 assert.deepEqual(a,b);assert.equal(a.summary.sourceOccurrences,3);
 assert.equal(a.summary.distinctCases,2);assert.equal(a.summary.reviewCases,1);
 assert.equal(a.summary.confirmedTestCounterexamples,0);
 assert.equal(a.entries.find(x=>x.file==='services/a.js').occurrenceCount,2);
 assert.equal(a.entries.find(x=>x.file==='services/b.js').verdict,'UNVERIFIED_STATIC_SIGNAL');
});
test('never upgrades raw static or incomplete external proof',()=>{
 assert.equal(assessProof({nominal:evt('ok','ok')}).verdict,'UNVERIFIED_STATIC_SIGNAL');
 assert.equal(assessProof({nominal:evt('ok','bad'),adversarial:evt('reject','accepted')}).verdict,'NOMINAL_CONTROL_FAILED');
 assert.equal(assessProof({nominal:evt('ok','ok'),adversarial:evt('reject','reject')}).verdict,'COUNTEREXAMPLE_NOT_REPRODUCED');
});
test('paired control with deviation remains pending independent review',()=>{
 const proof={nominal:evt('ok','ok'),adversarial:evt('reject','accepted')};
 assert.equal(assessProof(proof).verdict,'COUNTEREXAMPLE_REPRODUCED_PENDING_REVIEW');
 proof.independentReview={approved:true,reviewer:'domain-owner',issue:'#123'};
 assert.equal(assessProof(proof).verdict,'CONFIRMED_TEST_COUNTEREXAMPLE');
});
test('rejects stale and unknown external IDs rather than silently dropping them',()=>{
 assert.throws(()=>makeEvidenceLedger(inventory,{proofs:{'KBA-W-invalid':{}}}),/unknown finding/);
 assert.throws(()=>makeEvidenceLedger({writes:[]}),/Expected independently/);
});
