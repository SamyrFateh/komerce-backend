'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {assessP7P5,collectP7P5Canonical}=require('./p7-p5-canonical-collector');
const {MAP,evaluateBoundary}=require('./p1-p7-boundary-oracle');
const edge=MAP.find(x=>x.id==='P7_P5_COUNTRY_SETTLEMENT');
const verdict=x=>evaluateBoundary(edge,x.proofs.P7_P5_COUNTRY_SETTLEMENT);
const plane={market:{id:'m1',code:'KM',currency:'KMF',is_active:true,lifecycle_status:'ACTIVE'},
 assignment:{id:'a1',status:'ACTIVE'}};
const settlement={id:'s1',market_id:'m1',assignment_id:'a1',assignment_market_id:'m1',
 assignment_status:'ACTIVE',amount:'12000',currency:'KMF',source:'CENTRAL_ATTESTATION',
 status:'READY',payment_reference:null,received_at:null};
const sample=x=>({plane,settlements:[settlement],...x});
test('market READY attestation not invented as paid country settlement',()=>{
 const r=assessP7P5(sample());
 assert.equal(verdict(r).status,'EVIDENCE_GAP');
 assert.ok(r.diagnostics.gaps.includes('READY_ATTESTATION_NOT_COUNTRY_PAYMENT'));
});
test('no market assignment / no settlement is not positive bank evidence',()=>{
 const r=assessP7P5(sample({plane:{market:plane.market,assignment:null},settlements:[]}));
 assert.equal(verdict(r).status,'EVIDENCE_GAP');
 assert.ok(r.diagnostics.gaps.includes('NO_COUNTRY_SETTLEMENT_ATTESTATION'));
});
test('settlement assignment from another market is a contradiction, no amount inference',()=>{
 const r=assessP7P5(sample({settlements:[{...settlement,assignment_market_id:'m2'}]}));
 assert.ok(verdict(r).contradictions.includes('OWNER_FACT:SETTLEMENT_ASSIGNMENT_FOREIGN_MARKET'));
});
test('settlement currency differs from server-resolved market native money',()=>{
 const r=assessP7P5(sample({settlements:[{...settlement,currency:'XAF'}]}));
 assert.ok(verdict(r).contradictions.includes('OWNER_FACT:SETTLEMENT_CURRENCY_NOT_MARKET_CURRENCY'));
});
test('settlement READY created for never-activated DRAFT mandate contradicts lifecycle',()=>{
 const r=assessP7P5(sample({settlements:[{...settlement,assignment_status:'DRAFT'}]}));
 assert.ok(verdict(r).contradictions.includes('OWNER_FACT:NEW_READY_SETTLEMENT_ON_INACTIVE_ASSIGNMENT'));
});
test('old READY settlement from ended assignment is a gap, not invented creation-time bug',()=>{
 const r=assessP7P5(sample({settlements:[{...settlement,assignment_status:'ENDED'}]}));
 assert.equal(verdict(r).status,'EVIDENCE_GAP');
 assert.deepEqual(r.diagnostics.contradictions,[]);
});
test('even country RECEIVED event does not establish a bank statement',()=>{
 const r=assessP7P5(sample({settlements:[{...settlement,status:'RECEIVED',
  payment_reference:'BANK-REF',received_at:'2026-10-27'}]}));
 assert.equal(verdict(r).status,'EVIDENCE_GAP');
 assert.ok(r.diagnostics.gaps.includes('COUNTRY_RECEIPT_NOT_EXTERNAL_BANK_PROOF'));
});
test('read-only exact market settlement SQL returns absence without inventing zero amount',async()=>{
 const calls=[],db={query:async(sql,params)=>{
  calls.push({sql,params});
  assert.ok(sql.startsWith('SELECT '));return {rows:[]};
 }};
 const r=await collectP7P5Canonical(db,{plane});
 assert.equal(verdict(r).status,'EVIDENCE_GAP');
 assert.deepEqual(calls[0].params,['m1']);
 assert.equal(r.facts.settlement_count,0);
});
