'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {assessP4P2,collectP4P2Canonical}=require('./p4-p2-canonical-collector');
const {MAP,evaluateBoundary}=require('./p1-p7-boundary-oracle');
const B=MAP.find(x=>x.id==='P4_P2_RELAY_HANDOFF');
const verdict=a=>evaluateBoundary(B,a.proofs.P4_P2_RELAY_HANDOFF);
const item={order_id:'o1',order_item_id:'i1',relais_id:'relay1'};
const parcel={id:'p1',order_id:'o1',order_item_id:'i1',line_owner_order_id:'o1',status:'collected'};
const scan={id:'s1',order_id:'o1',parcel_id:'p1',pickup_relais_id:'relay1'};
const handoff={order_id:'o1',verdict:'HANDOFF_MATCHED',collected_parcel_count:1,
  proofs:[{parcel_id:'p1',scan_id:'s1',method:'PICKUP_CODE'}]};
const facts=(overrides={})=>({item,memberParcels:[parcel],itemParcels:[parcel],
 scans:[scan],handoff,...overrides});
test('nominal member parcel and accepted pickup proof match on exact order',()=>{
 const a=assessP4P2(facts());assert.equal(verdict(a).status,'NO_CONTRADICTION_OBSERVED');
 assert.deepEqual(a.diagnostics.contradictions,[]);
});
test('shared parcel header belongs to another carrier order without generating false bug',()=>{
 const p={...parcel,order_id:'carrier2'};const a=assessP4P2(facts({memberParcels:[p],itemParcels:[p]}));
 assert.equal(verdict(a).status,'NO_CONTRADICTION_OBSERVED');
 assert.equal(a.facts.shared_carrier_parcels,1);
});
test('a scan for a foreign parcel is not accepted as evidence for this order',()=>{
 const a=assessP4P2(facts({scans:[{...scan,parcel_id:'other'}]}));
 assert.ok(verdict(a).contradictions.includes('OWNER_FACT:COLLECTION_SCAN_FOREIGN_PARCEL'));
});
test('correct parcel but wrong relay is an independent contradiction hypothesis',()=>{
 const a=assessP4P2(facts({scans:[{...scan,pickup_relais_id:'other-relay'}]}));
 assert.ok(verdict(a).contradictions.includes('OWNER_FACT:COLLECTION_SCAN_FOREIGN_RELAY'));
});
test('handoff MATCHED on one of two parcels without both proofs must not pass',()=>{
 const p2={...parcel,id:'p2'};
 const a=assessP4P2(facts({memberParcels:[parcel,p2],itemParcels:[parcel,p2]}));
 assert.ok(verdict(a).contradictions.includes('OWNER_FACT:MATCHED_HANDOFF_MISSING_MEMBER_PARCEL_PROOF'));
});
test('at relay before customer scan remains PENDING, not a faux PASS',()=>{
 const a=assessP4P2(facts({scans:[],handoff:{
  order_id:'o1',verdict:'HANDOFF_PENDING',reason:'CUSTOMER_HANDOFF_NOT_COLLECTED',
  collected_parcel_count:0,proofs:[]}}));
 assert.equal(verdict(a).status,'EVIDENCE_GAP');
 assert.ok(a.diagnostics.gaps.includes('CUSTOMER_HANDOFF_PENDING'));
});
test('legacy header-only parcel is gap for exact order-item, not a made-up match',()=>{
 const a=assessP4P2(facts({itemParcels:[]}));
 assert.equal(verdict(a).status,'EVIDENCE_GAP');
 assert.ok(a.diagnostics.gaps.includes('EXACT_ITEM_PARCEL_MEMBERSHIP_MISSING_OR_LEGACY'));
});
test('scan order mismatch and foreign line owner are both detected independently',()=>{
 const a=assessP4P2(facts({itemParcels:[{...parcel,line_owner_order_id:'other'}],
  scans:[{...scan,order_id:'other'}]}));
 assert.ok(a.diagnostics.contradictions.includes('COLLECTION_SCAN_FOREIGN_ORDER'));
 assert.ok(a.diagnostics.contradictions.includes('PARCEL_ITEM_FOREIGN_ORDER'));
});
test('reader calls existing membership and handoff owners, SQL reads are scoped',async()=>{
 const queryCalls=[],called=[];
 const db={query:async(sql,params)=>{
  queryCalls.push({sql,params});
  if(sql.includes('FROM parcel_items pi'))return {rows:[parcel]};
  if(sql.includes('FROM scans'))return {rows:[scan]};
  throw Error('Unexpected query '+sql);
 }};
 const a=await collectP4P2Canonical(db,{item,readers:{
  listMembers:async(_,id,options)=>{
   called.push('membership');assert.equal(id,'o1');
   assert.equal(options.excludeCancelled,true);return [parcel];
  },
  reconcileHandoff:async(_,opts)=>{
   called.push('handoff');assert.equal(opts.orderId,'o1');return handoff;
  }
 }});
 assert.equal(verdict(a).status,'NO_CONTRADICTION_OBSERVED');
 assert.deepEqual(called,['membership','handoff']);
 assert.ok(queryCalls.every(x=>x.sql.startsWith('SELECT ')));
 assert.deepEqual(queryCalls.map(x=>x.params),[['i1','cancelled'],['o1']]);
});
