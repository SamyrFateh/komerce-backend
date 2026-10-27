'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {assessP5P2,collectP5P2Canonical}=require('./p5-p2-canonical-collector');
const {MAP,evaluateBoundary}=require('./p1-p7-boundary-oracle');
const B=MAP.find(e=>e.id==='P5_P2_PAYMENT_CLOSURE');
const status=r=>evaluateBoundary(B,r.proofs.P5_P2_PAYMENT_CLOSURE);
const order={id:'o1',reference:'ORDER-REAL',status:'collected',payment_status:'paid',
 payment_mode:'stripe_eur',stripe_payment_id:'pi_test_existing',total_kmf:25000,total_eur:50};
const closure={order_id:'o1',verdict:'FINANCIAL_CLOSE_MATCHED',
 mode:'normal',handoff_verdict:'HANDOFF_MATCHED',reason:null};
const fact=(extra={})=>({order,paymentGate:{status:'PROVED'},closure,...extra});
test('valid Stripe reference plus payment gate still cannot prove external PSP settlement from DB',()=>{
 const x=assessP5P2(fact());
 assert.equal(status(x).status,'EVIDENCE_GAP');
 assert.ok(x.diagnostics.gaps.includes('PSP_REFERENCE_NOT_EXTERNAL_SETTLEMENT_PROOF'));
 assert.equal(x.owner_provenance.provider_confirmed,false);
 assert.equal(x.facts.closure_verdict,'FINANCIAL_CLOSE_MATCHED');
});
test('non synthetic paid Stripe order missing payment intent yet CLOSED is contradiction hypothesis',()=>{
 const x=assessP5P2(fact({order:{...order,stripe_payment_id:null},
  paymentGate:{status:'ANOMALIE'}}));
 assert.equal(status(x).status,'CONTRADICTION_HYPOTHESIS');
 assert.ok(status(x).contradictions.includes('BLOCKED_OWNER_VS_DOWNSTREAM_PROVED'));
 assert.ok(status(x).contradictions.includes('OWNER_FACT:CLOSE_MATCHED_WITHOUT_STRIPE_REFERENCE'));
});
test('nominal SQL Golden is synthetic paid with no PSP reference: not a production bug',()=>{
 const x=assessP5P2(fact({order:{...order,reference:'K-GOLDEN-XYZ',stripe_payment_id:null},
  paymentGate:{status:'ANOMALIE'},checkoutProvenance:'SYNTHETIC_GOLDEN_CREATE'}));
 assert.equal(status(x).status,'EVIDENCE_GAP');
 assert.deepEqual(x.diagnostics.contradictions,[]);
 assert.ok(x.diagnostics.gaps.includes('SYNTHETIC_PAYMENT_NOT_PSP_PROOF'));
});
test('finance closure matched with payment gate unknown stays a gap, not a GO',()=>{
 const x=assessP5P2(fact({paymentGate:{status:'NON_PROUVE'}}));
 assert.equal(status(x).status,'EVIDENCE_GAP');
});
test('payment not paid and closure mismatch are consistent rejection, not evidence of theft',()=>{
 const x=assessP5P2(fact({order:{...order,payment_status:'pending'},
  paymentGate:{status:'ANOMALIE'},closure:{...closure,verdict:'FINANCIAL_CLOSE_MISMATCH',
  reason:'FINANCIAL_CLOSE_CUSTOMER_PAYMENT_NOT_PAID'}}));
 assert.equal(status(x).status,'EVIDENCE_GAP');
 assert.deepEqual(x.diagnostics.contradictions,[]);
});
test('cash collection is not per-order final remittance even if total collected',()=>{
 const x=assessP5P2(fact({order:{...order,payment_mode:'cash_relais',stripe_payment_id:null},
  cash:{collection_count:1,collected_kmf:25000},
  closure:{...closure,verdict:'FINANCIAL_CLOSE_PENDING',mode:'financial'}}));
 assert.equal(status(x).status,'EVIDENCE_GAP');
 assert.ok(x.diagnostics.gaps.includes('CASH_FINAL_REMITTANCE_NOT_ORDER_ATTRIBUTABLE'));
 assert.equal(x.facts.closure_verdict,'FINANCIAL_CLOSE_PENDING');
});
test('cash paid and claimed closed is not proved without final attributable custody',()=>{
 const x=assessP5P2(fact({order:{...order,payment_mode:'cash_relais',stripe_payment_id:null},
  cash:{collection_count:1,collected_kmf:25000}}));
 assert.equal(status(x).status,'EVIDENCE_GAP');
 assert.ok(x.diagnostics.gaps.includes('CASH_FINAL_REMITTANCE_NOT_ORDER_ATTRIBUTABLE'));
});
test('wrong order identity from closure is reported regardless of Stripe proof',()=>{
 const x=assessP5P2(fact({closure:{...closure,order_id:'foreign'}}));
 assert.ok(status(x).contradictions.includes('IDENTITY_CONTRADICTION:order_id'));
 assert.ok(status(x).contradictions.includes('OWNER_FACT:FINANCIAL_CLOSE_FOREIGN_ORDER'));
});
test('cancel/refund closure not positive customer collection',()=>{
 for(const mode of ['cancel','refund']){
  const x=assessP5P2(fact({closure:{...closure,mode}}));
  assert.ok(x.diagnostics.gaps.includes('REFUND_OR_CANCELLATION_NOT_POSITIVE_CUSTOMER_COLLECTION'));
 }
});
test('SQL real owner collector reads exact order once then asks same-order finance reconciliation',async()=>{
 const sql=[],calls=[];
 const db={query:async(q,params)=>{sql.push({q,params});
  if(q.includes('FROM orders WHERE'))return {rows:[order]};
  throw Error('unexpected SQL '+q);
 }};
 const x=await collectP5P2Canonical(db,{item:{order_id:'o1'},
  upstream:{gates:[{key:'PAYMENT_FINAL_PROVED',status:'PROVED'}]},
  readers:{closure:async(executor,{orderId})=>{
   assert.equal(executor,db);assert.equal(orderId,'o1');calls.push('closure');return closure;
  }}});
 assert.deepEqual(calls,['closure']);
 assert.equal(sql.length,1);assert.ok(sql[0].q.startsWith('SELECT '));
 assert.deepEqual(sql[0].params,['o1']);
 assert.equal(x.facts.psp_reference_present,true);
});
test('cash branch inspects its own order collections and never promotes to settled',async()=>{
 const db={query:async(q,params)=>{
  assert.deepEqual(params,['o1']);
  if(q.includes('FROM orders WHERE'))return {rows:[{...order,payment_mode:'cash_relais'}]};
  if(q.includes('FROM cash_collections WHERE'))return {rows:[{collection_count:1,collected_kmf:'25000'}]};
  throw Error('unexpected');
 }};
 const x=await collectP5P2Canonical(db,{item:{order_id:'o1'},readers:{
  closure:async()=>({...closure,verdict:'FINANCIAL_CLOSE_PENDING',mode:'financial'})}});
 assert.equal(x.facts.cash_collection_count,1);
 assert.equal(status(x).status,'EVIDENCE_GAP');
});
test('missing or ambiguous order is not silently converted to paid',async()=>{
 const db={query:async()=>({rows:[]})};
 await assert.rejects(()=>collectP5P2Canonical(db,{item:{order_id:'o1'},readers:{closure:async()=>closure}}),
  /FINANCE_ORDER_NOT_UNIQUE_OR_MISSING/);
});
