/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const {validateForwarderCheckpoint}=require('../../scripts/recette/g6-canonical-replay');
const scope={id:'M01',market:'KM'};
const id='550e8400-e29b-41d4-a716-446655440000',po='11111111-1111-4111-8111-111111111111';
const sid='22222222-2222-4222-8222-222222222222',box='33333333-3333-4333-8333-333333333333';
const bag='44444444-4444-4444-8444-444444444444',parcel='55555555-5555-4555-8555-555555555555';
const allocation='66666666-6666-4666-8666-666666666666';
const ref='SIM-STAGING-EXP-KNEW123';
const prior={scenario_id:'M01',market:'KM',verdict:'NOT_PROVEN',
 full_chain_certified:false,production_permitted:false,next_stage:'FORWARDER_RECEIPT',
 order:{id,reference:'KNEW123'},po_id:po,db_fingerprint:'fresh-db',
 stages:[{id:'HUB_SHIPMENT',verdict:'PASS_SIMULATED_STAGING',shipment_id:sid}]};
const shipment={verdict:'G6_HUB_SHIPMENT_SIMULATED_CHROMIUM_PG_PASS_HANDED_OVER',
 reference:'KNEW123',order_id:id,po_id:po,box_id:box,bag_id:bag,
 parcel_id:parcel,allocation_id:allocation,shipment_id:sid,shipment_ref:ref,
 db_fingerprint:'fresh-db',sha:'a'.repeat(40),provenance:'SIMULATED / STAGING ONLY',
 external_payment_executed:false,external_supplier_calls:0,
 events:[{key:'open-shipment'},{key:'dispatch-box'},{key:'handover-forwarder',http:200}],
 after:{shipments:[{id:sid,stage:'handed_over'}],box:[{id:box,state:'DISPATCHED'}],
 parcels:[{id:parcel,status:'shipped'}],parcelItems:[{qty_shipped:1}],parcelEvents:[{}]}};
describe('G6 forwarder checkpoint: no fixed KL1WGP6 lineage',()=>{
 test('same fresh order, PO and shipment are consistent',()=>{
  expect(validateForwarderCheckpoint(prior,shipment,scope)).toMatchObject({
   order:{id,reference:'KNEW123'},poId:po,shipmentId:sid,parcelId:parcel,boxId:box
  });
 });
 test.each([{order_id:'other'},{po_id:'other'},{reference:'OTHER'},
  {shipment_id:'other'},{db_fingerprint:'other'},{sha:'not-a-sha'},
  {external_supplier_calls:1},{external_payment_executed:true},
  {shipment_ref:'FOREIGN'}])('rejects unrelated or unsafe shipment %p',change=>{
  expect(()=>validateForwarderCheckpoint(prior,{...shipment,...change},scope)).toThrow('G6_FORWARDER_HANDOVER_PROVENANCE_INVALID');
 });
 test('rejects foreign previous chain and inconsistent PG shipment readback',()=>{
  expect(()=>validateForwarderCheckpoint({...prior,order:{id,reference:'OTHER'}},shipment,scope)).toThrow();
  expect(()=>validateForwarderCheckpoint({...prior,stages:[]},shipment,scope)).toThrow();
  expect(()=>validateForwarderCheckpoint(prior,{...shipment,after:{...shipment.after,
    shipments:[{id:sid,stage:'hub_ready'}]}},scope)).toThrow();
 });
});
