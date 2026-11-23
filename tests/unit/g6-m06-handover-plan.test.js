/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const {buildM06HandoverPlan}=require('../../scripts/recette/canonical/m06-handover-plan');
const state={scenario_id:'M06',market:'KM',simulation_scope:'G6-BUYER',payment_status:'paid',
 po_status:'hub_received',product_ref:'KPR-000255',procure_on_order:true,fulfillment_source:'IMPORT',
 order_quantity:3,received_quantity:3,payment_authorization_count:1,external_payment_rows:0,
 settlement_rows:0,local_stock_allocations_count:0,box_id:'box-1',
 order_reference:'ORDER06',box_reference:'G6-M06-COMBOX-ORDER06',box_unit_type:'MARKET_PARCEL',
 box_state:'PACKED',box_placement_count:1,box_placement_quantity:3,box_placement_operation:'REPACK',
 box_placement_evidence_method:'MANUAL',box_placement_evidence_ref:'COMBOX-PROOF-001',
 customer_bag_count:0,parcel_id:'parcel-1',parcel_count:1,parcel_status:'preparation',
 parcel_item_count:1,parcel_item_quantity:3,parcel_qty_shipped:0,shipment_count:0,
 shipment_link_count:0,box_custody_dispatch_count:0,order_id:'order-1',po_id:'po-1',allocation_id:'allocation-1'};
describe('G6 M06 handover plan',()=>{
 test('builds one handover for the packed direct COMBOX and its client parcel',()=>{
  expect(buildM06HandoverPlan(state,{forwarderName:'Transitaire opérateur',transportMode:'sea',proofRef:'REMISE-PROOF-001'}))
   .toMatchObject({order_id:'order-1',box_id:'box-1',parcel_id:'parcel-1',quantity:3,
    transport_mode:'sea',source:'OPERATOR_SUPPLIED_STAGING_HANDOVER_FACTS'});
 });
 test('requires actual operator handover facts',()=>{
  expect(()=>buildM06HandoverPlan(state,{forwarderName:'X',transportMode:'sea',proofRef:'short'}))
   .toThrow('G6_M06_HANDOVER_OPERATOR_FACTS_REQUIRED');
  expect(()=>buildM06HandoverPlan(state,{forwarderName:'Forwarder',transportMode:'land',proofRef:'REMISE-001'}))
   .toThrow('G6_M06_HANDOVER_OPERATOR_FACTS_REQUIRED');
 });
 test('refuses incomplete or bag based physical lineage',()=>{
  expect(()=>buildM06HandoverPlan({...state,box_state:'IDENTIFIED'},{forwarderName:'Forwarder',transportMode:'air',proofRef:'REMISE-002'}))
   .toThrow('G6_M06_HANDOVER_COMBOX_INVALID');
  expect(()=>buildM06HandoverPlan({...state,customer_bag_count:1},{forwarderName:'Forwarder',transportMode:'air',proofRef:'REMISE-003'}))
   .toThrow('G6_M06_HANDOVER_LEGACY_BAG_PRESENT');
 });
 test('refuses an already started shipment or external money effects',()=>{
  expect(()=>buildM06HandoverPlan({...state,shipment_count:1},{forwarderName:'Forwarder',transportMode:'air',proofRef:'REMISE-004'}))
   .toThrow('G6_M06_HANDOVER_ALREADY_STARTED');
  expect(()=>buildM06HandoverPlan({...state,external_payment_rows:1},{forwarderName:'Forwarder',transportMode:'air',proofRef:'REMISE-005'}))
   .toThrow('G6_M06_HANDOVER_FINANCE_INVALID');
 });
});
