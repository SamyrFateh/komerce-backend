/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const source=p=>fs.readFileSync(path.join(root,p),'utf8');
const hub=source('scripts/recette/g6-hub-shipment-chromium.js');
const adapter=source('scripts/recette/canonical/real-buyer-cash-adapters.js');
const relay=source('scripts/recette/g6-canonical-relay-receipt-chromium.js');
const physicalView=source('migrations/394_hub_packed_bag_box_link.sql');

describe('M06 final mile: shared Chromium route, truthful direct-COMBOX physical readback',()=>{
 test('uses the same shared reader but chooses the two real M06 references',()=>{
  expect(hub).toContain("const M06=env.G6_CANONICAL_SCENARIO==='M06'");
  expect(hub).toContain("const BOXREF=M06?'G6-M06-COMBOX-'+REF:'KOM-BOX-SIM-STAGING-'+REF");
  expect(hub).toContain("const SHIPMENT=M06?'G6-M06-EXP-'+REF:'SIM-STAGING-EXP-'+REF");
  expect(hub).toContain('module.exports={readback,checkShipment,runtime,SC,sameSet,placementIdsOf}');
 });
 test('does not fake a customer bag or hub_box_bags link for the M06 direct REPACK',()=>{
  expect(physicalView).toContain('NULL::uuid AS bag_unit_id');
  expect(hub).toContain('s.bag.length===0&&s.placement.length===1');
  expect(hub).toContain('s.links.length===0&&s.effective.length===1');
  expect(hub).toContain('s.effective[0].bag_unit_id===null');
  expect(hub).toContain("s.placement[0].operation_type==='REPACK'");
  expect(hub).toContain("s.placement[0].evidence_method==='MANUAL'");
  expect(hub).toContain("Number(s.placement[0].quantity)===SC.units&&SC.items===1&&SC.units===3");
  expect(hub).toContain("Number(s.order[0].payment_authorizations)===1");
  expect(relay).toContain("env.G6_CANONICAL_SCENARIO==='M06'?base.links.length===0&&base.effective.every(e=>e.bag_unit_id===null):base.links.length===1");
 });
 test('preserves original bag-based M01/M03 checks without broadening the writer',()=>{
  expect(hub).toContain("s.bag.length===1&&s.bag[0].id===BAG");
  expect(hub).toContain("s.links.length===1&&s.links[0].box_unit_id===boxId");
  expect(hub).toContain("['M01','M03'].includes(env.G6_CANONICAL_SCENARIO)");
 });
 test('binds the handover to shipment, box, allocation, order and parcel using actual schema',()=>{
  expect(adapter).not.toContain('p.order_id=s.order_id');
  expect(adapter).not.toContain('WHERE s.order_id=$1');
  expect(adapter).toContain('JOIN hub_box_effective_placements ep ON ep.box_unit_id=h.physical_unit_id');
  expect(adapter).toContain('JOIN hub_purchase_allocations a ON a.id=ep.allocation_id');
  expect(adapter).toContain('JOIN parcels p ON p.order_id=a.order_id');
  expect(adapter).toContain('ep.bag_unit_id IS NULL AND a.id=$3 AND a.order_id=$4 AND p.id=$5');
  expect(adapter).toContain("rows[0].parcel_status!=='shipped'||Number(rows[0].boxed_quantity)!==3");
  expect(adapter).toContain('finalMileIdentity(db,context,{m06:true})');
 });
});
