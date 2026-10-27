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
 assert.equal(a.summary.unresolvedOccurrences,1);
 assert.equal(a.summary.allCandidateOccurrences,4);
 assert.equal(a.summary.distinctUnresolvedCases,1);
 assert.equal(a.unresolvedEntries[0].verdict,'SCHEMA_TARGET_UNRESOLVED');
 assert.equal(a.entries.find(x=>x.file==='services/a.js').occurrenceCount,2);
 assert.equal(a.entries.find(x=>x.file==='services/b.js').verdict,'UNVERIFIED_STATIC_SIGNAL');
});
test('never upgrades raw static or incomplete external proof',()=>{
 assert.equal(assessProof({nominal:evt('ok','ok')}).verdict,'UNVERIFIED_STATIC_SIGNAL');
 assert.equal(assessProof({nominal:evt('ok','bad'),adversarial:evt('reject','accepted')}).verdict,'ATTESTED_NOMINAL_CONTROL_MISMATCH');
 assert.equal(assessProof({nominal:evt('ok','ok'),adversarial:evt('reject','reject')}).verdict,'ATTESTED_COUNTEREXAMPLE_NOT_OBSERVED');
});
test('paired control with deviation remains pending independent review',()=>{
 const proof={nominal:evt('ok','ok'),adversarial:evt('reject','accepted')};
 assert.equal(assessProof(proof).verdict,'ATTESTED_DEVIATION_PENDING_REVIEW');
 proof.independentReview={approved:true,reviewer:'domain-owner',issue:'#123'};
 assert.equal(assessProof(proof).verdict,'ATTESTED_DEVIATION_PENDING_TRUSTED_CI');
});
test('rejects stale and unknown external IDs rather than silently dropping them',()=>{
 assert.throws(()=>makeEvidenceLedger(inventory,{proofs:{'KBA-W-invalid':{}}}),/unknown finding/);
 assert.throws(()=>makeEvidenceLedger({writes:[]}),/Expected independently/);
});

test('stable IDs survive owner reclassification and shifted SQL source lines',()=>{
 const old=makeEvidenceLedger(inventory);
 const updated=structuredClone(inventory);
 for(const w of updated.writes){
  if(w.file==='services/a.js'){
   w.ownerResolution='OWNER_DOMAIN_MATCH_DECLARATION';
   w.declaredDomain='orders';w.line+=900;
  }
 }
 const changed=makeEvidenceLedger(updated);
 assert.equal(changed.entries.find(x=>x.file==='services/a.js').id,
  old.entries.find(x=>x.file==='services/a.js').id);
 assert.equal(changed.entries.find(x=>x.file==='services/a.js').reviewRequired,false);
});
test('unresolved targets are grouped with full occurrence conservation',()=>{
 const v=structuredClone(inventory);
 v.writes.push({...v.writes[3],line:88});
 const result=makeEvidenceLedger(v);
 assert.equal(result.summary.allCandidateOccurrences,5);
 assert.equal(result.summary.unresolvedOccurrences,2);
 assert.equal(result.unresolvedEntries.length,1);
 assert.equal(result.unresolvedEntries[0].occurrenceCount,2);
});
test('rejects inconsistent classification for the same writer/table identity',()=>{
 const v=structuredClone(inventory);
 v.writes[1].ownerResolution='OWNER_DOMAIN_MATCH_DECLARATION';
 assert.throws(()=>makeEvidenceLedger(v),/Conflicting owner classification/);
});
