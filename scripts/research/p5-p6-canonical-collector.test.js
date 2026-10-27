'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {assessP5P6,collectP5P6Canonical}=require('./p5-p6-canonical-collector');
const {MAP,evaluateBoundary}=require('./p1-p7-boundary-oracle');
const boundary=MAP.find(x=>x.id==='P5_P6_CASH_REALITY');
const verdict=x=>evaluateBoundary(boundary,x.proofs.P5_P6_CASH_REALITY);
const order={id:'o1',market_id:'m1',relais_id:'r1',reference:'K-GOLDEN-ONE',
 payment_mode:'stripe_eur',payment_status:'paid',stripe_payment_id:null,total_kmf:25000};
const shadow={order_id:'o1',costs:{by_type:{payment:{state:'not_expected',
 real_kmf:null,estimated_kmf:0}}}};
const example=x=>({order,shadow,collections:[],allocations:[],paymentCosts:[],
 paymentGate:{status:'ANOMALIE'},provenance:'SYNTHETIC_GOLDEN_CREATE',...x});
test('synthetic Stripe Golden has no cash and no PSP proof: explicit gap, not fee=0 certified',()=>{
 const r=assessP5P6(example());
 assert.equal(verdict(r).status,'EVIDENCE_GAP');
 assert.ok(r.diagnostics.gaps.includes('SYNTHETIC_GOLDEN_PAYMENT_NOT_EXTERNAL_PROOF'));
 assert.ok(r.diagnostics.gaps.includes('PAYMENT_FEE_NOT_ACTUALLY_VALUED'));
 assert.equal(r.facts.actual_fee_allocations,0);
});
test('real Stripe paid with a PSP intent is still not external settlement proof',()=>{
 const r=assessP5P6(example({order:{...order,reference:'REAL-1',stripe_payment_id:'pi_fake'},
  provenance:null,paymentGate:{status:'PROVED'}}));
 assert.equal(verdict(r).status,'EVIDENCE_GAP');
 assert.ok(r.diagnostics.gaps.includes('PSP_REFERENCE_NOT_SIGNED_SETTLEMENT'));
});
test('a SQL cash collection on a Stripe rail is a contradiction hypothesis',()=>{
 const r=assessP5P6(example({collections:[{id:'c1',order_id:'o1',relais_id:'r1',amount_kmf:25000}]}));
 assert.ok(verdict(r).contradictions.includes('OWNER_FACT:STRIPE_ORDER_HAS_CASH_COLLECTION'));
});
test('cash paid with full collection is not final custody proof',()=>{
 const r=assessP5P6(example({order:{...order,reference:'REAL-CASH',payment_mode:'cash_relais'},
  provenance:null,paymentGate:{status:'PROVED'},
  collections:[{id:'c1',order_id:'o1',relais_id:'r1',amount_kmf:25000}]}));
 assert.equal(verdict(r).status,'EVIDENCE_GAP');
 assert.ok(r.diagnostics.gaps.includes('FINAL_CUSTODY_CONTROL_NOT_ORDER_ATTESTED'));
 assert.ok(r.diagnostics.gaps.includes('CASH_COLLECTION_NOT_CONFIRMED_BY_DEPOSIT'));
});
test('cash paid amount mismatch flagged at order grain',()=>{
 const r=assessP5P6(example({order:{...order,payment_mode:'cash_relais'},
  collections:[{id:'c1',order_id:'o1',relais_id:'r1',amount_kmf:24000}]}));
 assert.ok(verdict(r).contradictions.includes('OWNER_FACT:CASH_PAID_ORDER_COLLECTION_AMOUNT_MISMATCH'));
});
test('reconstructed deposit allocations do not discharge collector',()=>{
 const r=assessP5P6(example({order:{...order,payment_mode:'cash_relais'},
  collections:[{id:'c1',order_id:'o1',relais_id:'r1',amount_kmf:25000}],
  allocations:[{collection_id:'c1',market_id:'m1',allocation_basis:'RECONSTRUCTED',
   deposit_market_id:'m1',deposit_status:'verified',deposit_movement_kind:'LEGACY'}]}));
 assert.equal(verdict(r).status,'EVIDENCE_GAP');
 assert.ok(r.diagnostics.gaps.includes('RECONSTRUCTED_CASH_ALLOCATIONS_NOT_DISCHARGE'));
});
test('deposit allocation to a different market is independent contradiction',()=>{
 const r=assessP5P6(example({order:{...order,payment_mode:'cash_relais'},
  collections:[{id:'c1',order_id:'o1',relais_id:'r1',amount_kmf:25000}],
  allocations:[{collection_id:'c1',collection_order_id:'o1',market_id:'m2',
   deposit_market_id:'m2',allocation_basis:'CONFIRMED'}]}));
 assert.ok(verdict(r).contradictions.includes('OWNER_FACT:DEPOSIT_ALLOCATION_FOREIGN_MARKET'));
 assert.ok(verdict(r).contradictions.includes('OWNER_FACT:CASH_DEPOSIT_FOREIGN_MARKET'));
});
test('actual processing fee is distinct from gross customer collection',()=>{
 const r=assessP5P6(example({order:{...order,payment_mode:'cash_relais'},
  collections:[{id:'c1',order_id:'o1',relais_id:'r1',amount_kmf:25000}],
  paymentCosts:[{id:'fee1',order_id:'o1',order_item_id:'i1',item_order_id:'o1',
   amount_kmf:650,is_actual:true,provenance:'reçu banque'}],
  shadow:{...shadow,costs:{by_type:{payment:{state:'real',real_kmf:650}}}}}));
 assert.equal(verdict(r).status,'EVIDENCE_GAP');
 assert.deepEqual(r.diagnostics.contradictions,[]);
 assert.equal(r.facts.collection_kmf,25000);
 assert.equal(r.facts.actual_fee_kmf,650);
});
test('processing fee attributed to article of a foreign order is contradiction',()=>{
 const r=assessP5P6(example({
  paymentCosts:[{id:'fee1',order_id:'o1',order_item_id:'foreign',item_order_id:'o2',
   amount_kmf:500,is_actual:true,provenance:'FICTIF R&D'}],
  shadow:{...shadow,costs:{by_type:{payment:{state:'real',real_kmf:500}}}}}));
 assert.ok(verdict(r).contradictions.includes('OWNER_FACT:PAYMENT_COST_FOREIGN_ITEM_ORDER'));
});
test('real shadow fee different from real allocated fee is order-grain contradiction',()=>{
 const r=assessP5P6(example({paymentCosts:[{order_id:'o1',item_order_id:'o1',
  amount_kmf:800,is_actual:true,provenance:'FICTIF R&D'}],
  shadow:{...shadow,costs:{by_type:{payment:{state:'real',real_kmf:400}}}}}));
 assert.ok(verdict(r).contradictions.includes('OWNER_FACT:P6_PAYMENT_FEE_SHADOW_NOT_ALLOCATION_CONSISTENT'));
});
test('collector calls real shadow owner with same SQL transaction and exact order',async()=>{
 const queries=[],calls=[];
 const db={query:async(q,params)=>{
  queries.push({q,params});
  if(q.includes('FROM orders WHERE'))return {rows:[order]};
  if(q.includes('FROM cash_collections WHERE'))return {rows:[]};
  if(q.includes('FROM order_item_real_cost_allocations ca'))return {rows:[]};
  throw Error('Unexpected SQL '+q);
 }};
 const r=await collectP5P6Canonical(db,{item:{order_id:'o1'},
  upstream:{gates:[{key:'PAYMENT_FINAL_PROVED',status:'ANOMALIE'}],
   dossier:{provenance:'SYNTHETIC_GOLDEN_CREATE'}},
  readers:{realMargin:async(orderId,opt)=>{
   assert.equal(orderId,'o1');assert.equal(opt.client,db);
   calls.push('owner');return shadow;
  }}});
 assert.equal(verdict(r).status,'EVIDENCE_GAP');
 assert.deepEqual(calls,['owner']);assert.equal(queries.length,3);
 assert.ok(queries.every(x=>x.q.startsWith('SELECT ')));
 assert.ok(queries.every(x=>JSON.stringify(x.params)==='["o1"]'));
});
test('exact cash collection and its deposit allocations are read without assumed FIFO settled',async()=>{
 const db={query:async(q,params)=>{
  if(q.includes('FROM orders WHERE'))return {rows:[{...order,payment_mode:'cash_relais'}]};
  if(q.includes('FROM cash_collections WHERE'))return {rows:[{id:'c1',order_id:'o1',relais_id:'r1',amount_kmf:25000}]};
  if(q.includes('FROM cash_deposit_allocations da')){
   assert.deepEqual(params,[['c1']]);return {rows:[{collection_id:'c1',market_id:'m1',allocation_basis:'RECONSTRUCTED'}]};
  }
  if(q.includes('FROM order_item_real_cost_allocations ca'))return {rows:[]};
  throw Error('unexpected SQL');
 }};
 const r=await collectP5P6Canonical(db,{item:{order_id:'o1'},readers:{realMargin:async()=>shadow}});
 assert.equal(verdict(r).status,'EVIDENCE_GAP');
 assert.ok(r.diagnostics.gaps.includes('RECONSTRUCTED_CASH_ALLOCATIONS_NOT_DISCHARGE'));
});
