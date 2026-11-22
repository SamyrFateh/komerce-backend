/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const {buildM06ReceiptPlan}=require('../../scripts/recette/canonical/m06-receipt-plan');

const state={scenario_id:'M06',market:'KM',simulation_scope:'G6-BUYER',payment_status:'paid',
 po_status:'confirmed',trigger_mode:'manual',po_id:'po-1',order_id:'order-1',product_ref:'KPR-000255',
 product_sku_id:'sku-1',procure_on_order:true,fulfillment_source:'IMPORT',order_quantity:3,
 confirmed_quantity:3,commitment_count:1,commitment_amount:'30',commitment_currency:'EUR',
 payment_authorization_count:1,payment_authorization_amount:'24',payment_authorization_currency:'EUR',
 external_payment_rows:0,settlement_rows:0,received_quantity:0,purchase_allocations_count:0,
 receive_placements_count:0,executions:[
  {seller_label:'Marchand A',quantity:1,amount:'8',currency:'EUR',proof_ref:'RECU-A'},
  {seller_label:'Marchand B',quantity:2,amount:'16',currency:'EUR',proof_ref:'RECU-B'}
 ]};

describe('G6 M06 physical receipt plan',()=>{
 test('builds the exact 3-unit receipt from persisted multi-seller purchases',()=>{
  expect(buildM06ReceiptPlan(state,'RECEPTION-CONTROLE-001')).toMatchObject({
   purchase_order_id:'po-1',order_id:'order-1',product_sku_id:'sku-1',quantity:3,
   currency:'EUR',confirmed_total:24,execution_count:2,distinct_sellers:2,
   source:'OPERATOR_SUPPLIED_PHYSICAL_RECEIPT'
  });
 });
 test('requires an operator supplied physical receipt proof',()=>{
  expect(()=>buildM06ReceiptPlan(state,'')).toThrow('G6_M06_RECEIPT_PROOF_REQUIRED');
  expect(()=>buildM06ReceiptPlan(state,'short')).toThrow('G6_M06_RECEIPT_PROOF_REQUIRED');
 });
 test('rejects a missing second authorization, over-commitment or external payment row',()=>{
  expect(()=>buildM06ReceiptPlan({...state,payment_authorization_count:0},'RECEIPT-001'))
   .toThrow('G6_M06_RECEIPT_AUTHORITY_STATE_INVALID');
  expect(()=>buildM06ReceiptPlan({...state,commitment_amount:'20'},'RECEIPT-002'))
   .toThrow('G6_M06_RECEIPT_PURCHASE_AUTHORIZATION_RECONCILIATION_INVALID');
  expect(()=>buildM06ReceiptPlan({...state,external_payment_rows:1},'RECEIPT-003'))
   .toThrow('G6_M06_RECEIPT_AUTHORITY_STATE_INVALID');
 });
 test('rejects quantity mismatch and existing physical receipt facts',()=>{
  expect(()=>buildM06ReceiptPlan({...state,executions:state.executions.map(x=>({...x,quantity:1}))},'RECEIPT-004'))
   .toThrow('G6_M06_RECEIPT_PURCHASE_QUANTITY_INVALID');
  expect(()=>buildM06ReceiptPlan({...state,received_quantity:3},'RECEIPT-005'))
   .toThrow('G6_M06_RECEIPT_ALREADY_RECEIVED');
  expect(()=>buildM06ReceiptPlan({...state,purchase_allocations_count:1},'RECEIPT-006'))
   .toThrow('G6_M06_RECEIPT_ALREADY_RECEIVED');
 });
});
