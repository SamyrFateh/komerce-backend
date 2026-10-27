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
  // The older four-edge tests isolate P1/P2/P7; P2/P3/P4 has its own
  // canonical SQL suite and is exercised in the real disposable PG Goldens.
  p2p4:async()=>({proofs:{},diagnostics:{gaps:['MOCK_NOT_WIRED']}}),
  p4p2:async()=>({proofs:{},diagnostics:{gaps:['MOCK_NOT_WIRED']}}),
  p5p2:async()=>({proofs:{},diagnostics:{gaps:['MOCK_NOT_WIRED']}}),
  p3p6:async()=>({proofs:{},diagnostics:{gaps:['MOCK_NOT_WIRED']}}),
  p4p6:async()=>({proofs:{},diagnostics:{gaps:['MOCK_NOT_WIRED']}}),
  p5p6:async()=>({proofs:{},diagnostics:{gaps:['MOCK_NOT_WIRED']}}),
  p6p1:async()=>({proofs:{},diagnostics:{gaps:['MOCK_NOT_WIRED']}}),
  p7p5:async()=>({proofs:{},diagnostics:{gaps:['MOCK_NOT_WIRED']}}),
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
 assert.equal(edge(r,'P7_P1_MARKET_EXPOSURE').status,'EVIDENCE_GAP');
 assert.equal(edge(r,'P7_P1_MARKET_PRICING').status,'EVIDENCE_GAP');
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

test('catalog provenance missing makes unit provenance unknown even if local price and exposure exist',async()=>{
 const f=fixture({checkoutStatus:'PROVED'});
 f.owners.upstream=async()=>({gates:[{key:'CHECKOUT_ORIGIN_PROVED',status:'PROVED'},
   {key:'CATALOG_RELEASE_PROVED',status:'NON_PROUVE'}]});
 const r=await collectP1P7Canonical(f.db,f.args,f.owners);
 assert.equal(edge(r,'P1_P2_SELLABLE_UNIT').status,'EVIDENCE_GAP');
});
test('two matching BLOCKED decisions are not a positive P1/P2 proof',async()=>{
 const f=fixture({checkoutStatus:'ANOMALIE',exposure:'DISABLED',price:false});
 const r=await collectP1P7Canonical(f.db,f.args,f.owners);
 assert.equal(edge(r,'P1_P2_SELLABLE_UNIT').status,'EVIDENCE_GAP');
 assert.ok(edge(r,'P1_P2_SELLABLE_UNIT').gaps.includes('BLOCKED_OWNER_OR_CONSUMER'));
});

test('integrates two more seams from explicitly injected P2-P4 owner facts',async()=>{
 const {assessP2P4}=require('./p2-p4-canonical-collector');
 const f=fixture({checkoutStatus:'PROVED'});
 f.owners.p2p4=async(_db,{item,upstream})=>{
  assert.equal(item.order_item_id,OI);
  assert.ok(upstream.gates);
  return assessP2P4({
   item:{order_item_id:OI,order_id:OTHER,sku_id:SKU},
   lines:[{id:'line1',order_item_id:OI,product_sku_id:SKU,
    purchase_order_id:'po1',po_order_id:null,po_status:'confirmed'}],
   progress:[{effective_quantity:1,received_quantity:1,cancelled:false}],
   allocations:[{id:'alloc1',order_id:OTHER,order_item_id:OI,purchase_line_id:'line1',
    purchase_order_id:'po1',product_sku_id:SKU}],
   inbound:{verdict:'INBOUND_MATCHED',purchase_line_ids:['line1']},
   fulfillmentIds:['f1'],paymentGate:{status:'PROVED'},
  });
 };
 const r=await collectP1P7Canonical(f.db,f.args,f.owners);
 assert.equal(r.wired_edges.length,6);
 assert.equal(r.totals.notWired,7);
 assert.equal(r.totals.contradictions,0);
 assert.equal(edge(r,'P2_P3_PURCHASE_REQUIREMENT').status,'NO_CONTRADICTION_OBSERVED');
 assert.equal(edge(r,'P3_P4_HUB_RECEIPT').status,'NO_CONTRADICTION_OBSERVED');
});

test('seven-edge assembly uses explicit owner handoff and never parcel header as order identity',async()=>{
 const {assessP4P2}=require('./p4-p2-canonical-collector');
 const f=fixture({checkoutStatus:'PROVED'});
 f.owners.p4p2=async(_db,{item})=>assessP4P2({
  item:{...item,relais_id:MID},
  memberParcels:[{id:'parcel1',order_id:'other-carrier'}],
  itemParcels:[{id:'parcel1',order_id:'other-carrier',
   order_item_id:OI,line_owner_order_id:OTHER}],
  scans:[{order_id:OTHER,parcel_id:'parcel1',pickup_relais_id:MID}],
  handoff:{order_id:OTHER,verdict:'HANDOFF_MATCHED',
   collected_parcel_count:1,proofs:[{parcel_id:'parcel1'}]}
 });
 const r=await collectP1P7Canonical(f.db,f.args,f.owners);
 assert.equal(r.totals.observed,5);
 assert.equal(r.totals.notWired,8);
 assert.equal(edge(r,'P4_P2_RELAY_HANDOFF').status,'NO_CONTRADICTION_OBSERVED');
 assert.equal(r.physical_handoff.facts.shared_carrier_parcels,1);
});

test('eight-edge assembly accepts independent P5-P2 finance owner while checkout remains noncertified',async()=>{
 const {assessP5P2}=require('./p5-p2-canonical-collector');
 const f=fixture({checkoutStatus:'PROVED'});
 f.owners.p5p2=async(_db,{item})=>{
   assert.equal(item.order_id,OTHER);
   return assessP5P2({order:{id:OTHER,reference:'CUSTOMER-001',
     status:'collected',payment_status:'paid',payment_mode:'stripe_eur',
     stripe_payment_id:'pi_123',total_kmf:25000},
     paymentGate:{status:'PROVED'},
     closure:{order_id:OTHER,verdict:'FINANCIAL_CLOSE_MATCHED',mode:'normal'}});
 };
 const r=await collectP1P7Canonical(f.db,f.args,f.owners);
 assert.equal(r.totals.observed,5);assert.equal(r.totals.notWired,8);
 assert.equal(edge(r,'P5_P2_PAYMENT_CLOSURE').status,'EVIDENCE_GAP');
 assert.equal(r.customer_finance.facts.closure_verdict,'FINANCIAL_CLOSE_MATCHED');
 assert.equal(r.customer_finance.owner_provenance.provider_confirmed,false);
});

test('ninth boundary keeps exact real-cost lineage distinct from purchase confirmation',async()=>{
 const {assessP3P6}=require('./p3-p6-canonical-collector');
 const f=fixture({checkoutStatus:'NON_PROUVE'});
 f.owners.p3p6=async(_db,{item})=>assessP3P6({
  item,
  lines:[{id:'pl1',order_item_id:OI,purchase_order_id:'po1',
   po_status:'confirmed',cancelled_at:null}],
  costs:[{id:'cost1',order_id:OTHER,order_item_id:OI,cost_type:'product_purchase',
   amount_kmf:'7000.00',is_actual:true,source:'supplier_execution_payment'}],
  orderItemCount:1,
  shadow:{order_id:OTHER,purchase:{state:'estimated_only',real_kmf:null,
   flags:['no_settlement_recorded'],supplier_payments:{count:1,debit_verified:1}}},
 });
 const r=await collectP1P7Canonical(f.db,f.args,f.owners);
 assert.equal(r.totals.observed,5);
 assert.equal(r.totals.notWired,8);
 assert.equal(edge(r,'P3_P6_PURCHASE_COST').status,'EVIDENCE_GAP');
 assert.ok(r.supplier_cost.diagnostics.gaps.includes('ACTUAL_ALLOCATION_WITHOUT_SETTLEMENT_PROOF'));
});

test('tenth seam assembler retains physical parcel and cost lineage without false mismatch',async()=>{
 const {assessP4P6}=require('./p4-p6-canonical-collector');
 const f=fixture({checkoutStatus:'NON_PROUVE'});
 f.owners.p4p6=async(_db,{item})=>assessP4P6({item,
  memberParcels:[{id:'box1',order_id:'other-carrier'}],
  itemParcels:[{parcel_id:'box1',carrier_order_id:'other-carrier',line_order_id:OTHER}],
  costs:[{id:'c1',order_id:OTHER,order_item_id:OI,parcel_id:'box1',shipment_id:'ship1',
   cost_type:'freight',amount_kmf:'1500',is_actual:true,source:'customs_shipments'},
   {id:'c2',order_id:OTHER,order_item_id:OI,parcel_id:'box1',shipment_id:'ship1',
   cost_type:'customs',amount_kmf:'2500',is_actual:true,source:'customs_shipments'}],
  shipments:[{shipment_id:'ship1',parcel_id:'box1'}],orderItemCount:1,
  shadow:{order_id:OTHER,costs:{by_type:{
   freight:{state:'real',real_kmf:1500},customs:{state:'real',real_kmf:2500}}}}});
 const r=await collectP1P7Canonical(f.db,f.args,f.owners);
 assert.equal(r.wired_edges.length,5);assert.equal(r.totals.notWired,8);
 assert.equal(edge(r,'P4_P6_LOGISTICS_COST').status,'NO_CONTRADICTION_OBSERVED');
 assert.equal(r.logistics_cost.facts.shared_carrier_parcels,1);
});

test('eleventh seam adds real shadow payment fees without inventing PSP collection proof',async()=>{
 const {assessP5P6}=require('./p5-p6-canonical-collector');
 const f=fixture({checkoutStatus:'NON_PROUVE'});
 f.owners.p5p6=async(_db,{item})=>assessP5P6({
  order:{id:item.order_id,market_id:MID,relais_id:MID,reference:'K-GOLDEN-FAKE',
    payment_mode:'stripe_eur',payment_status:'paid',stripe_payment_id:null,total_kmf:25000},
  shadow:{order_id:item.order_id,costs:{by_type:{
   payment:{state:'not_expected',real_kmf:null,estimated_kmf:0}}}},
  paymentGate:{status:'ANOMALIE'},provenance:'SYNTHETIC_GOLDEN_CREATE',
 });
 const r=await collectP1P7Canonical(f.db,f.args,f.owners);
 assert.equal(r.totals.observed,5);assert.equal(r.totals.notWired,8);
 assert.equal(edge(r,'P5_P6_CASH_REALITY').status,'EVIDENCE_GAP');
 assert.equal(r.funds_cost.facts.collections,0);
 assert.ok(r.funds_cost.diagnostics.gaps.includes('SYNTHETIC_GOLDEN_PAYMENT_NOT_EXTERNAL_PROOF'));
});

test('all thirteen seams can be assembled with exact human pricing and market settlement owners',async()=>{
 const {assessP6P1}=require('./p6-p1-canonical-collector');
 const {assessP7P5}=require('./p7-p5-canonical-collector');
 const f=fixture({checkoutStatus:'NON_PROUVE'});
 f.owners.p6p1=async(_db,{item,market})=>assessP6P1({
   item,market,shadow:{margin:{shadow_pct:8,basis:'real'}},draft:null,events:[]});
 f.owners.p7p5=async(_db,{plane})=>assessP7P5({plane,settlements:[]});
 const r=await collectP1P7Canonical(f.db,f.args,f.owners);
 assert.ok(r.wired_edges.includes('P6_P1_PRICE_REVIEW'));
 assert.ok(r.wired_edges.includes('P7_P5_COUNTRY_SETTLEMENT'));
 assert.equal(r.wired_edges.length,6); // other test owner seams intentionally mocked
 assert.equal(r.totals.notWired,7);
 assert.equal(edge(r,'P6_P1_PRICE_REVIEW').status,'EVIDENCE_GAP');
 assert.equal(edge(r,'P7_P5_COUNTRY_SETTLEMENT').status,'EVIDENCE_GAP');
 assert.equal(r.verdict,'NOT_CERTIFICATION');
});
