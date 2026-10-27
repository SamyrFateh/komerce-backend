'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {assessP3P6,collectP3P6Canonical}=require('./p3-p6-canonical-collector');
const {MAP,evaluateBoundary}=require('./p1-p7-boundary-oracle');
const boundary=MAP.find(x=>x.id==='P3_P6_PURCHASE_COST');
const verdict=r=>evaluateBoundary(boundary,r.proofs.P3_P6_PURCHASE_COST);
const item={order_id:'o1',order_item_id:'i1'};
const line={id:'l1',order_item_id:'i1',purchase_order_id:'po1',po_status:'confirmed',cancelled_at:null};
const cost={id:'c1',order_id:'o1',order_item_id:'i1',cost_type:'product_purchase',
 amount_kmf:'7000.00',is_actual:true,source:'supplier_execution_payment',allocation_method:'direct'};
const shadow={order_id:'o1',purchase:{state:'real',real_kmf:7000,flags:[],
 supplier_payments:{count:1,debit_verified:1}}};
const facts=opt=>({item,lines:[line],costs:[cost],shadow,orderItemCount:1,...opt});
test('real debit KMF and exact one-item cost allocation agree: no contradiction',()=>{
 const r=assessP3P6(facts());
 assert.equal(verdict(r).status,'NO_CONTRADICTION_OBSERVED');
 assert.deepEqual(r.diagnostics.contradictions,[]);
 assert.equal(r.facts.comparable_single_item,true);
});
test('verified settlements differ from actual purchase cost: one-item contradiction',()=>{
 const r=assessP3P6(facts({costs:[{...cost,amount_kmf:'8000.00'}]}));
 assert.ok(verdict(r).contradictions.includes(
 'OWNER_FACT:SINGLE_ITEM_REAL_SETTLEMENT_DIFFERS_FROM_ACTUAL_COST_ALLOCATION'));
});
test('supplier real cost missing despite "is_actual" allocation is evidence gap',()=>{
 const r=assessP3P6(facts({shadow:{order_id:'o1',purchase:{
  state:'estimated_only',real_kmf:null,flags:['no_settlement_recorded'],
  supplier_payments:{count:1,debit_verified:1}}}}));
 assert.equal(verdict(r).status,'EVIDENCE_GAP');
 assert.ok(r.diagnostics.gaps.includes('ACTUAL_ALLOCATION_WITHOUT_SETTLEMENT_PROOF'));
});
test('real costs may never be taken from catalog estimate',()=>{
 const r=assessP3P6(facts({costs:[{...cost,source:'catalog_estimate:products.cost_kmf',is_actual:false}]}));
 assert.equal(verdict(r).status,'EVIDENCE_GAP');
 assert.equal(r.facts.product_purchase_actual_count,0);
});
test('wrong order id persisted on cost row is detected at real item grain',()=>{
 const r=assessP3P6(facts({costs:[{...cost,order_id:'foreign-order'}]}));
 assert.ok(verdict(r).contradictions.includes('OWNER_FACT:COST_ALLOCATION_FOREIGN_ORDER'));
});
test('wrong item in cost row cannot become matched because amount equals',()=>{
 const r=assessP3P6(facts({costs:[{...cost,order_item_id:'foreign-item'}]}));
 assert.ok(verdict(r).contradictions.includes('IDENTITY_CONTRADICTION:order_item_id'));
});
test('grouped PO multi-item cannot compare entire order net debit to a single item cost',()=>{
 const r=assessP3P6(facts({orderItemCount:2,costs:[{...cost,amount_kmf:'3000.00'}]}));
 assert.equal(verdict(r).status,'EVIDENCE_GAP');
 assert.equal(r.facts.comparable_single_item,false);
 assert.ok(!r.diagnostics.contradictions.includes(
   'SINGLE_ITEM_REAL_SETTLEMENT_DIFFERS_FROM_ACTUAL_COST_ALLOCATION'));
});
test('two legitimate purchase lines for one sold item are not collapsed to first',()=>{
 const r=assessP3P6(facts({lines:[line,{...line,id:'l2'}]}));
 assert.equal(verdict(r).status,'EVIDENCE_GAP');
 assert.ok(r.diagnostics.gaps.includes('MULTIPLE_PURCHASE_LINES_NEED_AGGREGATION'));
});
test('missing supplier payment is not free purchase cost',()=>{
 const r=assessP3P6(facts({shadow:{order_id:'o1',purchase:{state:'confirmed_unvalued',
 real_kmf:null,flags:['no_supplier_payment'],supplier_payments:{count:0,debit_verified:0}}},
 costs:[]}));
 assert.equal(verdict(r).status,'EVIDENCE_GAP');
 assert.ok(r.diagnostics.gaps.includes('SUPPLIER_SETTLEMENT_REAL_KMF_NOT_PROVED'));
});
test('wrong order scope from margin owner is caught independently',()=>{
 const r=assessP3P6(facts({shadow:{...shadow,order_id:'foreign-order'}}));
 assert.ok(verdict(r).contradictions.includes('OWNER_FACT:REAL_MARGIN_SHADOW_FOREIGN_ORDER'));
});
test('read-only collector delegates settlement to the actual owner shadow with same transaction',async()=>{
 const queries=[],calls=[];
 const db={query:async(q,p)=>{
  queries.push({q,p});
  if(q.includes('FROM purchase_lines pl'))return {rows:[line]};
  if(q.includes('FROM order_item_real_cost_allocations'))return {rows:[cost]};
  if(q.includes('COUNT(*)::int AS item_count FROM order_items'))return {rows:[{item_count:1}]};
  throw Error('Unexpected SQL '+q);
 }};
 const r=await collectP3P6Canonical(db,{item,readers:{
  realMargin:async(orderId,opts)=>{
   calls.push('real-margin');assert.equal(orderId,'o1');assert.equal(opts.client,db);
   return shadow;
  }}});
 assert.deepEqual(calls,['real-margin']);assert.equal(queries.length,3);
 assert.ok(queries.every(x=>x.q.startsWith('SELECT ')));
 assert.equal(verdict(r).status,'NO_CONTRADICTION_OBSERVED');
});
test('full source process absent is a gap rather than a valid purchase with zero cost',()=>{
 const r=assessP3P6(facts({lines:[],costs:[],shadow:null,orderItemCount:1}));
 assert.equal(verdict(r).status,'EVIDENCE_GAP');
});
