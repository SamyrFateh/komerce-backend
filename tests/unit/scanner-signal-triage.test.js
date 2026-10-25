'use strict';
/** @test-kind unit @test-runner node @test-requires none */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {classify,triage}=require('../../scripts/audits/triage-discovery-signals');
test('cross-owner flagged debt is not misrepresented as novel bug',()=>{
 const c=classify({kind:'WRITE_HEADER_OUTSIDE_EXCLUSIVE_OWNER',table:'products',file:'services/hub-operations.js',declaredBy:['logistics'],evidenceTier:'DIRECT_SQL_TEXT_HINT'});
 assert.equal(c.assessment,'REGISTERED_CROSS_OWNER_DEBT');
 assert.match(c.debtStatus,/légitime/);
 assert.equal(c.confidence,'GOVERNANCE_SIGNAL_ONLY');
});
test('declared writer header without SQL does not become bug',()=>{
 const c=classify({kind:'WRITE_HEADER_OUTSIDE_EXCLUSIVE_OWNER',table:'orders',file:'services/payment-stripe.js',declaredBy:['payments'],evidenceTier:'HEADER_ONLY_UNVERIFIED'});
 assert.equal(c.assessment,'DECLARATIVE_HEADER_ONLY');
});
test('unregistered direct SQL remains review, not confirmed',()=>{
 const c=classify({kind:'WRITE_HEADER_OUTSIDE_EXCLUSIVE_OWNER',table:'parcels',file:'services/novel-direct-write.js',declaredBy:['ops'],evidenceTier:'DIRECT_SQL_TEXT_HINT'});
 assert.equal(c.assessment,'UNREGISTERED_SQL_WRITE_REVIEW');
 const summary=triage([c]).summary;
 assert.equal(summary.claimedRuntimeBugs,0);
});
test('business invariant gaps are separated from runtime bugs',()=>{
 const s=triage([
  {kind:'INVARIANT_WITHOUT_EXECUTABLE_PROOF',feature:'test',invariant:'no executable proof'},
  {kind:'DB_INVARIANT_PROVED_BY_MOCK_ONLY',feature:'test',invariant:'mock-only'},
  {kind:'SILENT_CONFLICT_COUNT_AS_SUCCESS',severity:'REVIEW',file:'services/x.js'}
 ]).summary;
 assert.equal(s.byAssessment.INVARIANT_EVIDENCE_GAP,2);
 assert.equal(s.byAssessment.CODE_PATTERN_REQUIRES_REAL_DB,1);
 assert.equal(s.claimedRuntimeBugs,0);
});
