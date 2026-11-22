/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const {buildM06ComboxPlan}=require('../../scripts/recette/canonical/m06-combox-plan');
const state={scenario_id:'M06',market:'KM',simulation_scope:'G6-BUYER',payment_status:'paid',
 po_status:'hub_received',product_ref:'KPR-000255',procure_on_order:true,fulfillment_source:'IMPORT',
 order_quantity:3,received_quantity:3,payment_authorization_count:1,external_payment_rows:0,
 settlement_rows:0,local_stock_allocations_count:0,receipt_unit_id:'unit-1',
 receipt_reference:'SUPPLIER_PACKAGE-3e2c7d23-3ee7-4ca1-984c-83b6c41e5889',receipt_state:'IDENTIFIED',
 allocation_id:'allocation-1',allocation_quantity:3,placement_quantity:3,placement_operation:'RECEIVE',
 receipt_evidence_method:'MANUAL',receipt_evidence_ref:'RECEIPT-REAL-001',box_count:0,direct_combox_placement_count:0,
 order_id:'order-1',po_id:'po-1',line_id:'line-1'};
describe('G6 M06 direct COMBOX plan',()=>{
 test('permits one exact three-unit direct composition after physical receipt',()=>{
  expect(buildM06ComboxPlan(state,'COMBOX-CHECK-001')).toMatchObject({
   receipt_unit_id:'unit-1',allocation_id:'allocation-1',quantity:3,
   source:'OPERATOR_SUPPLIED_DIRECT_COMBOX_PROOF'
  });
 });
 test('requires operator proof and exact M06 order receipt',()=>{
  expect(()=>buildM06ComboxPlan(state,'short')).toThrow('G6_M06_COMBOX_PROOF_REQUIRED');
  expect(()=>buildM06ComboxPlan({...state,received_quantity:2},'COMBOX-CHECK-002'))
   .toThrow('G6_M06_COMBOX_ORDER_RECEIPT_INVALID');
  expect(()=>buildM06ComboxPlan({...state,receipt_state:'QUARANTINED'},'COMBOX-CHECK-003'))
   .toThrow('G6_M06_COMBOX_PHYSICAL_RECEIPT_INVALID');
 });
 test('rejects finance or local stock effects',()=>{
  expect(()=>buildM06ComboxPlan({...state,external_payment_rows:1},'COMBOX-CHECK-004'))
   .toThrow('G6_M06_COMBOX_FINANCE_OR_LOCAL_STOCK_INVALID');
  expect(()=>buildM06ComboxPlan({...state,local_stock_allocations_count:1},'COMBOX-CHECK-005'))
   .toThrow('G6_M06_COMBOX_FINANCE_OR_LOCAL_STOCK_INVALID');
 });
 test('stops before overwriting an existing COMBOX',()=>{
  expect(()=>buildM06ComboxPlan({...state,box_count:1},'COMBOX-CHECK-006'))
   .toThrow('G6_M06_COMBOX_ALREADY_STARTED');
 });
});
