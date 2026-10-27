'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {collectP1P7Canonical}=require('./p1-p7-canonical-collector');
const OI='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const P='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SKU='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const MID='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
function fixture({orderMarket='KM',skuProduct=P,checkoutStatus='NON_PROUVE',marketActive=true,
 deliveryProven=true,exposure='ENABLED',price=true,readiness=true,skuActive=true}={}) {
 const sql=[],called=[];
 const db={query:async(query,params)=>{
  sql.push({query,params});
  if(/FROM order_items oi/.test(query))return {rows:[{
    order_item_id:OI,order_id:OTHER,product_id:P,sku_id:SKU,reference:'CUSTOMER-001',
    simulation_scope:'RCT1',market_id:MID,order_market_code:orderMarket
  }]};
  if(/FROM product_skus WHERE/.test(query))return {rows:[{id:SKU,product_id:skuProduct,is_active:skuActive}]};
  throw Error('Unrecognised SQL read '+query);
 }};
 const owners={
  controlPlane:async(_db,code)=>{called.push('market:'+code);return {market:{
    id:MID,code, is_active:marketActive,lifecycle_status:marketActive?'ACTIVE':'PROVISIONING'
   },deliveryProof:{proven:deliveryProven},readiness:{ready_for_activation:readiness}};},
  exposure:async(_id,_market,_db)=>{called.push('exposure');return exposure;},
  pricing:async(_db,{marketId,productId})=>{
    assert.equal(marketId,MID);assert.equal(productId,P);called.push('pricing');
    return price?{source:'LOCAL_ACTIVE',effective_unit_price_kmf:10000}:null;
  },
  upstream:async(_db,{productId,marketCode,orderReference,fetchImpl})=>{
    assert.equal(productId,P);assert.equal(marketCode,'KM');
    assert.equal(orderReference,'CUSTOMER-001');
    assert.equal(fetchImpl,null);
    called.push('golden-checkout');
    return {gates:[{key:'CATALOG_RELEASE_PROVED',status:'PROVED'},
     {key:'CHECKOUT_ORIGIN_PROVED',status:checkoutStatus,
      evidence:{market_code:orderMarket}}]};
  },
 };
 return {db,owners,sql,called,args:{productId:P,marketCode:'KM',orderReference:'CUSTOMER-001',orderItemId:OI}};
}
const edge=(r,id)=>r.boundaries.find(b=>b.id===id);
test('connects 4/13 edges with real owner adapters and explicit rest',async()=>{
 const f=fixture({checkoutStatus:'PROVED'});
 const r=await collectP1P7Canonical(f.db,f.args,f.owners);
 assert.equal(r.wired_edges.length,4);
 assert.equal(r.totals.notWired,9);assert.equal(r.totals.observed,4);
 assert.equal(r.verdict,'NOT_CERTIFICATION');
 assert.equal(edge(r,'P1_P2_SELLABLE_UNIT').status,'NO_CONTRADICTION_OBSERVED');
 assert.equal(edge(r,'P7_P2_CHECKOUT').status,'NO_CONTRADICTION_OBSERVED');
 assert.deepEqual(f.called,['market:KM','exposure','pricing','golden-checkout']);
 assert.equal(f.sql.length,2);
 assert.ok(f.sql.every(x=>x.query.trimStart().startsWith('SELECT')));
 assert.deepEqual(f.sql[0].params,['CUSTOMER-001',OI]);
 assert.deepEqual(f.sql[1].params,[SKU]);
 assert.equal(r.stagingCertified,false);assert.equal(r.liveCheckoutCertified,false);
});
test('persisted CM order is NOT hidden by selected KM: both market borders catch it',async()=>{
 const f=fixture({orderMarket:'CM',checkoutStatus:'ANOMALIE'});
 const r=await collectP1P7Canonical(f.db,f.args,f.owners);
 for(const id of ['P1_P2_SELLABLE_UNIT','P7_P2_CHECKOUT'])
  assert.ok(edge(r,id).contradictions.includes('IDENTITY_CONTRADICTION:market_code'));
 assert.equal(r.context.selected_market,'KM');
 assert.equal(r.context.persisted_order_market,'CM');
});
test('sold SKU from other product is detected without joining source by requested product',async()=>{
 const f=fixture({skuProduct:OTHER,checkoutStatus:'PROVED'});
 const r=await collectP1P7Canonical(f.db,f.args,f.owners);
 assert.ok(edge(r,'P1_P2_SELLABLE_UNIT').contradictions.includes('IDENTITY_CONTRADICTION:product_id'));
});
test('missing market exposure and LOCAL_ACTIVE price do not report sellability',async()=>{
 const f=fixture({exposure:'DISABLED',price:false,checkoutStatus:'PROVED'});
 const r=await collectP1P7Canonical(f.db,f.args,f.owners);
 assert.ok(edge(r,'P1_P2_SELLABLE_UNIT').contradictions.includes('BLOCKED_OWNER_VS_DOWNSTREAM_PROVED'));
 assert.equal(edge(r,'P7_P1_MARKET_EXPOSURE').status,'NO_CONTRADICTION_OBSERVED');
 assert.equal(edge(r,'P7_P1_MARKET_PRICING').status,'NO_CONTRADICTION_OBSERVED');
});
test('missing checkout origin is not promoted to proof because the order was inserted',async()=>{
 const f=fixture();
 const r=await collectP1P7Canonical(f.db,f.args,f.owners);
 assert.equal(edge(r,'P1_P2_SELLABLE_UNIT').status,'EVIDENCE_GAP');
 assert.ok(edge(r,'P7_P2_CHECKOUT').gaps.includes('UNKNOWN_OWNER_OR_CONSUMER_VERDICT'));
});
test('blocked market delivery conflicts with independently proved checkout',async()=>{
 const f=fixture({deliveryProven:false,checkoutStatus:'PROVED'});
 const r=await collectP1P7Canonical(f.db,f.args,f.owners);
 assert.ok(edge(r,'P7_P2_CHECKOUT').contradictions.includes('BLOCKED_OWNER_VS_DOWNSTREAM_PROVED'));
 assert.equal(r.verdict,'NOT_CERTIFICATION');
});
test('missing team-readiness is UNKNOWN, not automatic P7 green',async()=>{
 const f=fixture({readiness:false,checkoutStatus:'PROVED'});
 const r=await collectP1P7Canonical(f.db,f.args,f.owners);
 assert.equal(edge(r,'P7_P2_CHECKOUT').status,'EVIDENCE_GAP');
});
test('market owner SQL failure is explicit and no synthetic fallback to order market',async()=>{
 const f=fixture({orderMarket:'CM',checkoutStatus:'ANOMALIE'});
 f.owners.controlPlane=async()=>{throw Object.assign(Error('db down'),{code:'READ_DOWN'})};
 const r=await collectP1P7Canonical(f.db,f.args,f.owners);
 assert.deepEqual(r.owner_read_errors,[{owner:'services/market-control-plane.getControlPlane',code:'READ_DOWN'}]);
 assert.equal(edge(r,'P7_P2_CHECKOUT').status,'CONTRADICTION_HYPOTHESIS');
 assert.ok(edge(r,'P7_P2_CHECKOUT').gaps.includes('UNKNOWN_OWNER_OR_CONSUMER_VERDICT'));
 assert.equal(r.context.selected_market,'KM');
});
test('no arbitrary order item and invalid identity input; fail closed',async()=>{
 const f=fixture();f.db.query=async()=>({rows:[]});
 await assert.rejects(()=>collectP1P7Canonical(f.db,f.args,f.owners),/Exact order item missing/);
 await assert.rejects(()=>collectP1P7Canonical(f.db,{...f.args,orderItemId:null},f.owners),/Exact productId/);
});
test('simulated scope is preserved; NOT_RUN staging never becomes accepted',async()=>{
 const f=fixture({checkoutStatus:'PROVED'});
 const r=await collectP1P7Canonical(f.db,f.args,f.owners);
 assert.equal(r.context.simulation_scope,'RCT1');
 assert.equal(r.financeCertified,false);
});
