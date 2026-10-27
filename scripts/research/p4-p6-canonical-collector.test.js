'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {assessP4P6,collectP4P6Canonical}=require('./p4-p6-canonical-collector');
const {MAP,evaluateBoundary}=require('./p1-p7-boundary-oracle');
const edge=MAP.find(x=>x.id==='P4_P6_LOGISTICS_COST');
const status=x=>evaluateBoundary(edge,x.proofs.P4_P6_LOGISTICS_COST);
const item={order_id:'o1',order_item_id:'i1'};
const parcel={id:'box1',order_id:'o1'};
const parcelLine={parcel_id:'box1',carrier_order_id:'o1',line_order_id:'o1'};
const costs=[
 {id:'c1',order_id:'o1',order_item_id:'i1',parcel_id:'box1',shipment_id:'ship1',
  cost_type:'freight',amount_kmf:'1500.00',is_actual:true,source:'customs_shipments'},
 {id:'c2',order_id:'o1',order_item_id:'i1',parcel_id:'box1',shipment_id:'ship1',
  cost_type:'customs',amount_kmf:'2500.00',is_actual:true,source:'customs_shipments'},
];
const shadow={order_id:'o1',costs:{by_type:{
 freight:{state:'real',real_kmf:1500},customs:{state:'real',real_kmf:2500}}}};
const facts=overrides=>({item,memberParcels:[parcel],itemParcels:[parcelLine],costs,
 shipments:[{shipment_id:'ship1',parcel_id:'box1'}],shadow,orderItemCount:1,...overrides});
test('one item with declared shipment actual freight and duty agrees with economic owner',()=>{
 const x=assessP4P6(facts());
 assert.equal(status(x).status,'NO_CONTRADICTION_OBSERVED');
 assert.equal(x.diagnostics.gaps.length,0);
 assert.equal(x.facts.compared_owner_cost_types,2);
 assert.equal(x.facts.allocated_kmf.freight,1500);
 assert.equal(x.facts.allocated_kmf.customs,2500);
});
test('shared carrier header another order is legitimate when parcel line belongs here',()=>{
 const x=assessP4P6(facts({memberParcels:[{...parcel,order_id:'carrier-order'}],
  itemParcels:[{...parcelLine,carrier_order_id:'carrier-order'}]}));
 assert.equal(status(x).status,'NO_CONTRADICTION_OBSERVED');
 assert.equal(x.facts.shared_carrier_parcels,1);
});
test('wrong order id on freight allocation creates hypothesis irrespective of amount',()=>{
 const x=assessP4P6(facts({costs:[{...costs[0],order_id:'foreign'},costs[1]]}));
 assert.ok(status(x).contradictions.includes('OWNER_FACT:LOGISTICS_COST_FOREIGN_ORDER'));
});
test('wrong item id on duty cost row contradicts order item lineage',()=>{
 const x=assessP4P6(facts({costs:[costs[0],{...costs[1],order_item_id:'foreign'}]}));
 assert.ok(status(x).contradictions.includes('OWNER_FACT:LOGISTICS_COST_FOREIGN_ITEM'));
});
test('customs cost allocated to parcel that does not contain this sold item',()=>{
 const x=assessP4P6(facts({costs:[costs[0],{...costs[1],parcel_id:'other'}]}));
 assert.ok(status(x).contradictions.includes('OWNER_FACT:LOGISTICS_COST_FOREIGN_PARCEL'));
 assert.ok(status(x).contradictions.includes('OWNER_FACT:LOGISTICS_COST_PARCEL_NOT_CONTAINING_ITEM'));
});
test('shipment must actually include attributed parcel, not just be declared elsewhere',()=>{
 const x=assessP4P6(facts({shipments:[{shipment_id:'other',parcel_id:'box1'}]}));
 assert.ok(status(x).contradictions.includes('OWNER_FACT:LOGISTICS_COST_SHIPMENT_PARCEL_UNLINKED'));
});
test('shadow overreports cost on exact one-item order: independent amount contradiction',()=>{
 const x=assessP4P6(facts({shadow:{...shadow,costs:{by_type:{
  freight:{state:'real',real_kmf:2400},customs:{state:'real',real_kmf:2500}}}}}));
 assert.ok(status(x).contradictions.includes('OWNER_FACT:SHADOW_FREIGHT_DIFFERS_FROM_ACTUAL_ALLOCATION'));
});
test('multi-item shared parcel does not compare order aggregated totals to one line',()=>{
 const x=assessP4P6(facts({orderItemCount:2,
  memberParcels:[{...parcel,order_id:'foreign-carrier'}],
  itemParcels:[{...parcelLine,carrier_order_id:'foreign-carrier'}]}));
 assert.equal(status(x).status,'EVIDENCE_GAP');
 assert.equal(x.facts.compared_owner_cost_types,0);
 assert.equal(x.diagnostics.contradictions.length,0);
 assert.ok(x.diagnostics.gaps.includes('MULTI_ITEM_SHADOW_AGGREGATE_NOT_ITEM_COMPARABLE'));
});
test('estimated fallback cannot be considered actual freight even when amount matches',()=>{
 const x=assessP4P6(facts({costs:[{...costs[0],is_actual:false},costs[1]],
  shadow:{...shadow,costs:{by_type:{
   freight:{state:'estimated_only',real_kmf:null},customs:{state:'real',real_kmf:2500}}}}}));
 assert.equal(status(x).status,'EVIDENCE_GAP');
 assert.ok(x.diagnostics.gaps.includes('FREIGHT_NON_ACTUAL_ALLOCATION_NOT_REAL'));
});
test('missing declaration remains gap and cannot be silently substituted with estimated customs',()=>{
 const x=assessP4P6(facts({costs:[costs[0]],
  shadow:{...shadow,costs:{by_type:{
   freight:{state:'real',real_kmf:1500},customs:{state:'unknown',real_kmf:null}}}}}));
 assert.equal(status(x).status,'EVIDENCE_GAP');
 assert.ok(x.diagnostics.gaps.includes('CUSTOMS_REAL_VALUE_NOT_COMPARABLE'));
});
test('canonical P4 and economic owner readers see same transaction, only SELECT SQL',async()=>{
 const queries=[],owners=[];
 const db={query:async(sql,args)=>{
  queries.push({sql,args});
  if(sql.includes('FROM parcel_items pi'))return {rows:[parcelLine]};
  if(sql.includes('FROM order_item_real_cost_allocations'))return {rows:costs};
  if(sql.includes('FROM customs_shipment_parcels'))return {rows:[{shipment_id:'ship1',parcel_id:'box1'}]};
  if(sql.includes('COUNT(*)::int AS n'))return {rows:[{n:1}]};
  throw Error('Unexpected SQL '+sql);
 }};
 const result=await collectP4P6Canonical(db,{item,readers:{
  listMembers:async(_db,id,opts)=>{
   assert.equal(_db,db);assert.equal(id,'o1');assert.equal(opts.excludeCancelled,true);
   owners.push('membership');return [parcel];
  },
  realMargin:async(id,opts)=>{
   assert.equal(id,'o1');assert.equal(opts.client,db);owners.push('shadow');return shadow;
  }}});
 assert.deepEqual(owners,['membership','shadow']);
 assert.equal(status(result).status,'NO_CONTRADICTION_OBSERVED');
 assert.deepEqual(queries.map(x=>x.args),[['i1','cancelled'],['i1',['freight','customs']],[['ship1']],['o1']]);
 assert.ok(queries.every(x=>x.sql.startsWith('SELECT ')));
});
test('no parcel lines and no actual costs never gives false zero-cost success',()=>{
 const x=assessP4P6(facts({memberParcels:[],itemParcels:[],costs:[],shipments:[],shadow:null}));
 assert.equal(status(x).status,'EVIDENCE_GAP');
 assert.ok(x.diagnostics.gaps.includes('NO_CANONICAL_PARCEL_MEMBERSHIP'));
});
