'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {analyzeGoldenTrail}=require('./golden-identity-trail');
const fixture=()=>{
 const O='o1',item='oi1',sku='sku-A',product='prod1',po='po1',line='pl1',
  alloc='ha1',parcel='par1',market='KM';
 return {
  order:{id:O,market_id:market},items:[{id:item,order_id:O,sku_id:sku,product_id:product}],
  purchaseLines:[{id:line,order_item_id:item,product_sku_id:sku,
     purchase_order_id:po,supplier_id:'sup1',po_order_id:null,po_supplier_id:'sup1'}],
  executionLines:[{purchase_line_id:line,supplier_execution_order_id:'seo1',purchase_order_id:po}],
  supplierPayments:[{id:'sp1',supplier_execution_order_id:'seo1'}],
  fulfillments:[{id:'sf1',supplier_execution_order_id:'seo1'}],
  allocations:[{id:alloc,order_id:O,order_item_id:item,purchase_line_id:line,
    product_sku_id:sku,purchase_order_id:po,market_id:market,supplier_id:'sup1'}],
  placements:[{id:'hp1',allocation_id:alloc,physical_unit_id:'hu1'}],
  parcels:[{id:'pi1',parcel_id:parcel,order_item_id:item,product_id:product,
    carrier_order_id:O,status:'collected'}],
  scans:[{id:'sc1',order_id:O,parcel_id:parcel,step:'collected'}],
 };
};
test('nominal coherent chain retains identical item and SKU from sale to handoff',()=>{
 const r=analyzeGoldenTrail(fixture());
 assert.equal(r.status,'NO_IDENTITY_CONTRADICTION_OBSERVED');
 assert.equal(r.issues.length,0);assert.equal(r.gaps.length,0);
 assert.deepEqual(r.observed.itemIds,['oi1']);
 assert.deepEqual(r.observed.purchaseLineIds,['pl1']);
 assert.deepEqual(r.observed.scanIds,['sc1']);
 assert.equal(r.certifiedE2E,false);
});
test('cross-SKU purchase is detected even when all quantities are identical',()=>{
 const f=fixture();f.purchaseLines[0].product_sku_id='sku-B';
 const r=analyzeGoldenTrail(f);
 assert.equal(r.status,'IDENTITY_CONTRADICTION_HYPOTHESIS');
 assert.deepEqual(r.issues.map(x=>x.code),['PURCHASE_SKU_SUBSTITUTION','HUB_ALLOCATION_SKU_MISMATCH']);
});
test('hub allocation points to different order item: independent mismatch',()=>{
 const f=fixture();f.allocations[0].order_item_id='oi-other';
 const r=analyzeGoldenTrail(f);
 assert.ok(r.issues.some(x=>x.code==='HUB_UNKNOWN_ORDER_OR_PURCHASE_LINE'));
});
test('supplier execution references another PO despite correct purchase line',()=>{
 const f=fixture();f.executionLines[0].purchase_order_id='po-other';
 const r=analyzeGoldenTrail(f);
 assert.ok(r.issues.some(x=>x.code==='SUPPLIER_EXECUTION_PO_MISMATCH'));
});
test('shared parcel carrier order may differ from item owner without false positive',()=>{
 const f=fixture();f.parcels[0].carrier_order_id='o-other';
 const r=analyzeGoldenTrail(f);
 assert.equal(r.status,'NO_IDENTITY_CONTRADICTION_OBSERVED');
});
test('a missing pickup scan is an evidence gap, not an invented wrong handoff',()=>{
 const f=fixture();f.scans=[];
 const r=analyzeGoldenTrail(f);
 assert.equal(r.status,'MISSING_IDENTITY_EVIDENCE');
 assert.equal(r.gaps[0].code,'NO_CUSTOMER_HANDOFF_SCAN');
});
test('scan from a foreign order never authenticates this order',()=>{
 const f=fixture();f.scans[0].order_id='o-other';
 const r=analyzeGoldenTrail(f);
 assert.ok(r.issues.some(x=>x.code==='HANDOFF_FOREIGN_ORDER_SCAN'));
});
test('colliding market at Hub contradicts original order market',()=>{
 const f=fixture();f.allocations[0].market_id='CM';
 const r=analyzeGoldenTrail(f);
 assert.ok(r.issues.some(x=>x.code==='HUB_ALLOCATION_MARKET_MISMATCH'));
});
