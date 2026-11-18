/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const {validateFinalMileCheckpoint}=require('../../scripts/recette/canonical/final-mile-checkpoints');
const ids={order:'11111111-1111-4111-8111-111111111111',
 po:'22222222-2222-4222-8222-222222222222',
 shipment:'33333333-3333-4333-8333-333333333333',
 parcel:'44444444-4444-4444-8444-444444444444',
 box:'55555555-5555-4555-8555-555555555555',
 bag:'66666666-6666-4666-8666-666666666666',
 allocation:'77777777-7777-4777-8777-777777777777'};
const scenarios={
 CUSTOMS:{priorStage:'FORWARDER',priorVerdict:'G6_FORWARDER_SIMULATED_CHROMIUM_PG_PASS_ARRIVED',
  baseStage:'arrived',parcelStatus:'shipped',keys:['forwarder_received','tracking','in_transit','arrived'],http:[200,200,200,200]},
 RELAY_RECEIPT:{priorStage:'CUSTOMS_LOCAL',priorVerdict:'G6_CUSTOMS_LOCAL_SIMULATED_CHROMIUM_PG_PASS',
  baseStage:'local_delivery',parcelStatus:'shipped',keys:['customs_create','customs_link','customs_amount','customs_released','local_delivery'],
  http:[201,200,200,200,200]},
 CLIENT_PICKUP:{priorStage:'RELAY_RECEIPT',priorVerdict:'G6_RELAY_RECEIPT_SIMULATED_CHROMIUM_PG_PASS_AVAILABLE',
  baseStage:'relay_received',parcelStatus:'available',keys:['relay-receipt'],http:[201]}
};
function fixtures(stage){
 const c=scenarios[stage];
 const previous={scenario_id:'M01',market:'KM',verdict:'NOT_PROVEN',full_chain_certified:false,
  production_permitted:false,next_stage:stage,order:{id:ids.order,reference:'KNEWM01'},
  po_id:ids.po,db_fingerprint:'new-db-identity',
  stages:[{id:c.priorStage,verdict:'PASS_SIMULATED_STAGING',shipment_id:ids.shipment}]};
 const prior={schema:'komerce-g6-relay-receipt/1',verdict:c.priorVerdict,order_id:ids.order,
  shipment_id:ids.shipment,parcel_id:ids.parcel,db_fingerprint:'new-db-identity',
  provenance:'SIMULATED / STAGING ONLY',external_supplier_calls:0,external_payment_executed:false,
  role:'agent_transitaire',assignment:{via:'Chromium_UI',http:200},
  events:c.keys.map((key,i)=>({key,http:c.http[i],role:'agent_relais'})),
  after:{base:{shipments:[{id:ids.shipment,stage:c.baseStage}],
   parcels:[{id:ids.parcel,status:c.parcelStatus}],box:[{id:ids.box,state:'DISPATCHED'}],
   bag:[{id:ids.bag}],effective:[{allocation_id:ids.allocation,quantity:1}]},
   tracking:{tracking_reference:'SIM-STAGING-TRK-KNEWM01',arrived_at:'2026-11-18'},
   linked:true,customs:[{}],orders:[{id:ids.order,status:'available'}],
   receipts:[{received_qty:1,incident_id:null}]}
 };
 return {previous,prior};
}
describe('G6 final mile: same new order, no old run IDs',()=>{
 test.each(Object.keys(scenarios))('%s accepts a strictly linked, non-executable new-order proof',stage=>{
  const {previous,prior}=fixtures(stage);
  expect(validateFinalMileCheckpoint(stage,previous,prior)).toMatchObject({
   stage,orderId:ids.order,reference:'KNEWM01',shipmentId:ids.shipment,
   parcelId:ids.parcel,verdict:'NOT_PROVEN',execution_authorized:false
  });
 });
 test.each(Object.keys(scenarios))('%s refuses foreign order, shipment, db or missing UI event',stage=>{
  const {previous,prior}=fixtures(stage);
  for(const update of [
    {order_id:'99999999-9999-4999-8999-999999999999'},
    {shipment_id:'99999999-9999-4999-8999-999999999999'},
    {db_fingerprint:'other-db'},
    {external_payment_executed:true},
    {external_supplier_calls:1},
    {events:prior.events.slice(1)}
  ]){
   expect(()=>validateFinalMileCheckpoint(stage,previous,{...prior,...update})).toThrow();
  }
  expect(()=>validateFinalMileCheckpoint(stage,{...previous,stages:[]},prior)).toThrow();
  expect(()=>validateFinalMileCheckpoint(stage,{...previous,production_permitted:true},prior)).toThrow();
 });
 test('customs requires physical arrival and tracking proof',()=>{
  const {previous,prior}=fixtures('CUSTOMS');
  expect(()=>validateFinalMileCheckpoint('CUSTOMS',previous,{
   ...prior,after:{...prior.after,tracking:{...prior.after.tracking,arrived_at:null}}
  })).toThrow('G6_FINAL_MILE_CUSTOMS_PHYSICAL_INVALID');
 });
 test('relay requires linked customs event and physical dispatched box',()=>{
  const {previous,prior}=fixtures('RELAY_RECEIPT');
  expect(()=>validateFinalMileCheckpoint('RELAY_RECEIPT',previous,{
   ...prior,after:{...prior.after,linked:false}
  })).toThrow('G6_FINAL_MILE_RELAY_CUSTOMS_INVALID');
 });
 test('pickup requires real relay assignment, one receipt and no incident',()=>{
  const {previous,prior}=fixtures('CLIENT_PICKUP');
  expect(()=>validateFinalMileCheckpoint('CLIENT_PICKUP',previous,{
   ...prior,after:{...prior.after,receipts:[{received_qty:1,incident_id:'incident'}]}
  })).toThrow('G6_FINAL_MILE_PICKUP_RELAY_INVALID');
 });
 test('unknown stages are rejected',()=>{
  expect(()=>validateFinalMileCheckpoint('FAKE',{},{})).toThrow('G6_FINAL_MILE_STAGE_UNKNOWN');
 });
});
