'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {assessP2P4,collectP2P4Canonical}=require('./p2-p4-canonical-collector');
const {evaluateBoundary,MAP}=require('./p1-p7-boundary-oracle');
const B=id=>MAP.find(x=>x.id===id);
const verdict=(a,id)=>evaluateBoundary(B(id),a.proofs[id]);
const item={order_item_id:'oi1',order_id:'o1',sku_id:'sku1'};
const line={id:'line1',order_item_id:'oi1',product_sku_id:'sku1',purchase_order_id:'po1',
 cancelled_at:null,po_order_id:null,po_status:'confirmed',supplier_id:'s1',po_supplier_id:'s1'};
const progress={line_id:'line1',effective_quantity:2,received_quantity:2,cancelled:false};
const allocation={id:'alloc1',order_id:'o1',order_item_id:'oi1',product_sku_id:'sku1',
 purchase_line_id:'line1',purchase_order_id:'po1'};
const inbound={verdict:'INBOUND_MATCHED',purchase_line_ids:['line1'],expected_quantity:2,received_quantity:2};
function sample(overrides={}){return {item,lines:[line],progress:[progress],allocations:[allocation],
 fulfillmentIds:['ful1'],inbound,paymentGate:{status:'PROVED'},...overrides};}
test('nominal P2->P3 and P3->P4 match on actual order-item and purchase-line identities',()=>{
 const a=assessP2P4(sample());
 for(const id of ['P2_P3_PURCHASE_REQUIREMENT','P3_P4_HUB_RECEIPT'])
  assert.equal(verdict(a,id).status,'NO_CONTRADICTION_OBSERVED');
 assert.deepEqual(a.diagnostics.contradictions,[]);
});
test('grouped purchase order has no order_id header; no false cross-order mismatch',()=>{
 const a=assessP2P4(sample());
 assert.equal(a.diagnostics.contradictions.length,0);
 assert.equal(a.proofs.P3_P4_HUB_RECEIPT.context.po_shape,'grouped');
});
test('historical purchase order must belong to sold order',()=>{
 const a=assessP2P4(sample({lines:[{...line,po_order_id:'foreign'}]}));
 assert.ok(a.diagnostics.contradictions.includes('PURCHASE_PO_FOREIGN_ORDER'));
});
test('P2/P3 SKU mismatch detected even if product and unit price appear equal',()=>{
 const a=assessP2P4(sample({lines:[{...line,product_sku_id:'sku2'}]}));
 assert.ok(verdict(a,'P2_P3_PURCHASE_REQUIREMENT').contradictions.includes('IDENTITY_CONTRADICTION:sku_id'));
});
test('P3/P4 SKU mismatch captured from actual Hub allocation',()=>{
 const a=assessP2P4(sample({allocations:[{...allocation,product_sku_id:'sku2'}]}));
 assert.ok(verdict(a,'P3_P4_HUB_RECEIPT').contradictions.includes('IDENTITY_CONTRADICTION:sku_id'));
});
test('physical allocation of a different order is not excused by correct SKU',()=>{
 const a=assessP2P4(sample({allocations:[{...allocation,order_id:'different-order'}]}));
 assert.ok(a.diagnostics.contradictions.includes('HUB_ALLOCATION_FOREIGN_ORDER'));
});
test('matched inbound but physically unusable quantity is a specific contradiction',()=>{
 const a=assessP2P4(sample({progress:[{...progress,received_quantity:0}]}));
 assert.ok(a.diagnostics.contradictions.includes('INBOUND_MATCHED_WITHOUT_FULL_USABLE_PHYSICAL_QUANTITY'));
 assert.equal(a.proofs.P3_P4_HUB_RECEIPT.target.status,'UNKNOWN');
});
test('supplier fulfillment shipment not Hub receipt',()=>{
 const a=assessP2P4(sample({progress:[{...progress,received_quantity:0}],allocations:[],
  inbound:{...inbound,verdict:'PENDING',reason:'HUB_INBOUND_NOT_RECEIVED'}}));
 assert.equal(verdict(a,'P3_P4_HUB_RECEIPT').status,'EVIDENCE_GAP');
 assert.equal(a.diagnostics.contradictions.length,0);
});
test('cancelled PO line, missing payment and missing fulfillment never pass',()=>{
 const a=assessP2P4(sample({lines:[{...line,cancelled_at:'2026-10-27'}],
  paymentGate:{status:'NON_PROUVE'},fulfillmentIds:[],inbound:null,allocations:[]}));
 assert.equal(verdict(a,'P2_P3_PURCHASE_REQUIREMENT').status,'EVIDENCE_GAP');
 assert.ok(a.diagnostics.gaps.includes('NO_SUPPLIER_FULFILLMENT_LINK'));
});
test('multi-line PO is not collapsed to the first line',()=>{
 const a=assessP2P4(sample({lines:[line,{...line,id:'line2'}]}));
 assert.equal(verdict(a,'P2_P3_PURCHASE_REQUIREMENT').status,'EVIDENCE_GAP');
 assert.ok(a.diagnostics.gaps.includes('PURCHASE_LINES_AMBIGUOUS_FOR_LINE_GRAIN'));
});
test('legacy allocation without purchase_line_id may be attributed by same PO AND item',()=>{
 const a=assessP2P4(sample({allocations:[{...allocation,purchase_line_id:null}]}));
 assert.equal(verdict(a,'P3_P4_HUB_RECEIPT').status,'NO_CONTRADICTION_OBSERVED');
});
test('legacy allocation for different PO is NOT attributed to current purchase line',()=>{
 const a=assessP2P4(sample({allocations:[{...allocation,purchase_line_id:null,purchase_order_id:'other'}]}));
 assert.equal(verdict(a,'P3_P4_HUB_RECEIPT').status,'CONTRADICTION_HYPOTHESIS');
});
test('read-only collector reads actual SQL and delegates Hub verdict to canonical owner',async()=>{
 const seen=[];
 const db={query:async(sql,params)=>{
  seen.push({sql,params});
  if(sql.includes('FROM purchase_lines pl'))return {rows:[line]};
  if(sql.includes('FROM v_purchase_line_progress'))return {rows:[progress]};
  if(sql.includes('FROM hub_purchase_allocations'))return {rows:[allocation]};
  if(sql.includes('FROM supplier_execution_fulfillments sf'))return {rows:[{id:'ful1'}]};
  throw Error('Unexpected SQL '+sql);
 }};
 const r=await collectP2P4Canonical(db,{item,upstream:{gates:[{key:'PAYMENT_FINAL_PROVED',status:'PROVED'}]},
  readers:{reconcileInbound:async(_,input)=>{assert.equal(input.supplierFulfillmentId,'ful1');return inbound;}}});
 assert.equal(r.facts.purchase_line_id,'line1');
 assert.equal(r.facts.inbound_verdict,'INBOUND_MATCHED');
 assert.equal(r.facts.po_shape,'grouped');
 assert.equal(seen.length,4);
 assert.ok(seen.every(x=>x.sql.trimStart().startsWith('SELECT')));
 assert.deepEqual(r.diagnostics.contradictions,[]);
});
