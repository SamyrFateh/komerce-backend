/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const {deriveM06SupplierPaymentAuthorization}=require('../../scripts/recette/canonical/m06-supplier-payment-authorization');

const state={scenario_id:'M06',market:'KM',simulation_scope:'G6-BUYER',payment_status:'paid',
 po_status:'confirmed',trigger_mode:'manual',product_ref:'KPR-000255',procure_on_order:true,
 fulfillment_source:'IMPORT',order_quantity:3,confirmed_quantity:3,confirmed_unit_price:8,
 commitment_count:1,commitment_amount:'30',commitment_currency:'EUR',payment_authorization_count:0,
 external_payment_rows:0,executions:[
  {seller_label:'Marchand A',quantity:1,amount:'8.00',currency:'EUR',proof_ref:'RECU-A'},
  {seller_label:'Marchand B',quantity:2,amount:'16.00',currency:'EUR',proof_ref:'RECU-B'}
 ]};

describe('G6 M06 supplier payment authorization',()=>{
 test('derives the separate authorization from persisted purchase allocations',()=>{
  expect(deriveM06SupplierPaymentAuthorization(state,'AUTORISATION-001')).toMatchObject({
   amount:24,currency:'EUR',execution_count:2,distinct_sellers:2,quantity:3,
   source:'PERSISTED_MANUAL_PURCHASE_TOTAL'
  });
 });
 test('requires an operator proof and rejects a second authorization',()=>{
  expect(()=>deriveM06SupplierPaymentAuthorization(state,'')).toThrow('G6_M06_PAYMENT_AUTH_PROOF_REQUIRED');
  expect(()=>deriveM06SupplierPaymentAuthorization({...state,payment_authorization_count:1},'AUTH-002'))
   .toThrow('G6_M06_PAYMENT_AUTHORITY_STATE_INVALID');
 });
 test('rejects a total that differs from the confirmed purchase price or exceeds the commitment',()=>{
  expect(()=>deriveM06SupplierPaymentAuthorization({...state,executions:state.executions.map(x=>({...x,amount:9}))},'AUTH-003'))
   .toThrow('G6_M06_PAYMENT_AUTH_PURCHASE_TOTAL_MISMATCH');
  expect(()=>deriveM06SupplierPaymentAuthorization({...state,commitment_amount:'20'},'AUTH-004'))
   .toThrow('G6_M06_PAYMENT_AUTH_EXCEEDS_COMMITMENT');
 });
 test('rejects missing seller diversity, non-EUR and any external payment row',()=>{
  expect(()=>deriveM06SupplierPaymentAuthorization({...state,executions:state.executions.map(x=>({...x,seller_label:'Same seller'}))},'AUTH-005'))
   .toThrow('G6_M06_PAYMENT_AUTH_DISTINCT_SELLERS_REQUIRED');
  expect(()=>deriveM06SupplierPaymentAuthorization({...state,executions:state.executions.map(x=>({...x,currency:'KMF'}))},'AUTH-006'))
   .toThrow('G6_M06_PAYMENT_AUTH_EXECUTION_INVALID');
  expect(()=>deriveM06SupplierPaymentAuthorization({...state,external_payment_rows:1},'AUTH-007'))
   .toThrow('G6_M06_PAYMENT_AUTHORITY_STATE_INVALID');
 });
});
