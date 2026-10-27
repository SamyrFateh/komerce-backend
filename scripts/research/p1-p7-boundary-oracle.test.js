'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {MAP,PROCESS,evaluateP1P7}=require('./p1-p7-boundary-oracle');
const edge=id=>MAP.find(x=>x.id===id);
const proof=(id,sourceStatus='PROVED',targetStatus='PROVED',overrides={})=>{
 const b=edge(id);if(!b)throw Error('Unknown edge '+id);
 const ids=Object.fromEntries(b.keys.map(k=>[k,
   k==='market_code'?'KM':k==='sku_id'?'sku1':k==='product_id'?'prod1':
   k==='order_id'?'order1':k==='order_item_id'?'item1':k==='purchase_line_id'?'line1':'id1']));
 return {source:{authority:b.owner,status:sourceStatus,ids:{...ids}},
   target:{authority:b.consumer,status:targetStatus,ids:{...ids}},
   ...overrides};
};
test('official process map is seven processes and disconnected evidence cannot look green',()=>{
 assert.deepEqual(Object.keys(PROCESS),['P1','P2','P3','P4','P5','P6','P7']);
 const r=evaluateP1P7();
 assert.equal(r.verdict,'NOT_CERTIFICATION');
 assert.equal(r.totals.observed,0);
 assert.equal(r.totals.notWired,MAP.length);
 assert.ok(Object.values(r.coverage).every(c=>c.observed===0 && c.missing>0));
});
test('one observed nominal market seam does not imply P1-P7 certified',()=>{
 const e='P7_P2_CHECKOUT',p=proof(e);p.target.ids.market_code='km';
 const r=evaluateP1P7({[e]:p});
 assert.equal(r.totals.observed,1);
 assert.equal(r.totals.notWired,MAP.length-1);
 assert.equal(r.boundaries.find(b=>b.id===e).status,'NO_CONTRADICTION_OBSERVED');
 assert.equal(r.verdict,'NOT_CERTIFICATION');
});
test('P7 -> P2 detects selected KM versus persisted CM on equal nominal status',()=>{
 const e='P7_P2_CHECKOUT',p=proof(e);p.target.ids.market_code='CM';
 assert.deepEqual(evaluateP1P7({[e]:p}).boundaries.find(b=>b.id===e).contradictions,
   ['IDENTITY_CONTRADICTION:market_code']);
});
test('P7 readiness BLOCKED while P2 checkout proves acceptance is contradictory',()=>{
 const e='P7_P2_CHECKOUT',p=proof(e,'BLOCKED','PROVED');
 assert.ok(evaluateP1P7({[e]:p}).boundaries.find(b=>b.id===e)
   .contradictions.includes('BLOCKED_OWNER_VS_DOWNSTREAM_PROVED'));
});
test('P1 -> P2 detects wrong SKU even for same product and market',()=>{
 const e='P1_P2_SELLABLE_UNIT',p=proof(e);p.target.ids.sku_id='sku2';
 assert.deepEqual(evaluateP1P7({[e]:p}).boundaries.find(b=>b.id===e).contradictions,
   ['IDENTITY_CONTRADICTION:sku_id']);
});
test('P2 -> P3 identity is at order_item grain, not SKU price similarity',()=>{
 const e='P2_P3_PURCHASE_REQUIREMENT',p=proof(e);p.target.ids.order_item_id='item2';
 assert.ok(evaluateP1P7({[e]:p}).boundaries.find(b=>b.id===e).contradictions
   .includes('IDENTITY_CONTRADICTION:order_item_id'));
});
test('P3 -> P4 grouped PO follows purchase_line and SKU, not PO header market/order',()=>{
 const e='P3_P4_HUB_RECEIPT',p=proof(e);
 p.source.ids.po_order_id=null;p.target.ids.po_order_id='other-order';
 p.target.ids.carrier_order_id='shared-carrier-order';
 const r=evaluateP1P7({[e]:p});
 assert.equal(r.boundaries.find(b=>b.id===e).status,'NO_CONTRADICTION_OBSERVED');
});
test('P5 -> P2 blocks closure claimed PROVED against payment authority BLOCKED',()=>{
 const e='P5_P2_PAYMENT_CLOSURE';
 assert.ok(evaluateP1P7({[e]:proof(e,'BLOCKED','PROVED')})
   .boundaries.find(b=>b.id===e).contradictions.length>0);
});
test('P6 -> P1 explicit human-review gate catches unauthorized price write',()=>{
 const e='P6_P1_PRICE_REVIEW';
 const r=evaluateP1P7({[e]:proof(e,'BLOCKED','PROVED')});
 assert.equal(r.boundaries.find(b=>b.id===e).status,'CONTRADICTION_HYPOTHESIS');
});
test('missing authority or unknown readiness is a gap, not false clean or confirmed bug',()=>{
 const e='P1_P2_SELLABLE_UNIT';
 const p=proof(e,'UNKNOWN','PROVED');
 delete p.source.ids.sku_id;
 const b=evaluateP1P7({[e]:p}).boundaries.find(b=>b.id===e);
 assert.equal(b.status,'EVIDENCE_GAP');assert.deepEqual(b.contradictions,[]);
 assert.ok(b.gaps.includes('IDENTITY_NOT_LINKED:sku_id'));
});
test('unverified owner identity cannot be treated as a wired proof',()=>{
 const e='P7_P5_COUNTRY_SETTLEMENT',p=proof(e);
 p.source.authority='some-dashboard-count';
 const b=evaluateP1P7({[e]:p}).boundaries.find(b=>b.id===e);
 assert.equal(b.status,'INCOMPLETE');assert.equal(b.evidenceLevel,'NOT_VERIFIED');
});
test('fully supplied synthetic oracle fixtures still never return a P1-P7 GO',()=>{
 const all=Object.fromEntries(MAP.map(b=>[b.id,proof(b.id)]));
 const r=evaluateP1P7(all);
 assert.equal(r.totals.observed,MAP.length);
 assert.equal(r.totals.contradictions,0);
 assert.equal(r.verdict,'NOT_CERTIFICATION');
});
