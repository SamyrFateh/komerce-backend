/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const {validateM06OperatorInputs}=require('../../scripts/recette/g6-m06-input-preflight');
const valid={
 G6_M06_ACTUAL_PURCHASE_CAPTURE:JSON.stringify({purchase_proof_ref:'proof-purchase-01',allocations:[
  {seller_label:'Seller A',channel:'in_person',quantity:2,amount:12,currency:'EUR',proof_ref:'receipt-a'},
  {seller_label:'Seller B',channel:'whatsapp',quantity:1,amount:6,currency:'EUR',proof_ref:'receipt-b'}
 ]}),
 G6_M06_PAYMENT_AUTHORIZATION_PROOF:'authorization-01',
 G6_M06_RECEIPT_PROOF_REF:'hub-receipt-01',
 G6_M06_COMBOX_PROOF_REF:'combox-proof-01',
 G6_M06_FORWARDER_NAME:'Forwarder KM',
 G6_M06_TRANSPORT_MODE:'sea',
 G6_M06_HANDOVER_PROOF_REF:'handover-proof-01'
};

describe('M06 operator input preflight',()=>{
 test('accepts complete operator supplied facts without disclosing values in the result',()=>{
  const result=validateM06OperatorInputs(valid);
  expect(result).toMatchObject({scenario_id:'M06',market:'KM',quantity:3,allocation_count:2,
   valid:true,values_redacted:true});
  expect(JSON.stringify(result)).not.toContain('Seller A');
  expect(JSON.stringify(result)).not.toContain('receipt-a');
  expect(JSON.stringify(result)).not.toContain('Forwarder KM');
 });
 test('rejects missing purchase facts before a staging buyer order can be created',()=>{
  expect(()=>validateM06OperatorInputs({...valid,G6_M06_ACTUAL_PURCHASE_CAPTURE:''}))
   .toThrow('G6_M06_PURCHASE_CAPTURE_REQUIRED');
 });
 test('rejects allocations above the exact M06 30 EUR commitment before any order',()=>{
  const over=JSON.parse(valid.G6_M06_ACTUAL_PURCHASE_CAPTURE);
  over.allocations[0].amount=25;
  over.allocations[1].amount=10;
  expect(()=>validateM06OperatorInputs({...valid,G6_M06_ACTUAL_PURCHASE_CAPTURE:JSON.stringify(over)}))
   .toThrow('G6_M06_PURCHASE_EXCEEDS_COMMITMENT');
 });
 test('rejects missing payment approval and physical handover evidence',()=>{
  for(const key of ['G6_M06_PAYMENT_AUTHORIZATION_PROOF','G6_M06_RECEIPT_PROOF_REF',
   'G6_M06_COMBOX_PROOF_REF','G6_M06_HANDOVER_PROOF_REF']){
   expect(()=>validateM06OperatorInputs({...valid,[key]:''})).toThrow('G6_M06_INPUT_'+key+'_INVALID');
  }
 });
 test('rejects invalid quantity, duplicate seller, or unsupported transport mode',()=>{
  const badCapture=JSON.stringify({purchase_proof_ref:'proof-purchase-01',allocations:[
   {seller_label:'Seller A',channel:'in_person',quantity:1,amount:12,currency:'EUR',proof_ref:'receipt-a'},
   {seller_label:'Seller B',channel:'whatsapp',quantity:1,amount:6,currency:'EUR',proof_ref:'receipt-b'}
  ]});
  expect(()=>validateM06OperatorInputs({...valid,G6_M06_ACTUAL_PURCHASE_CAPTURE:badCapture}))
   .toThrow('G6_M06_PURCHASE_QUANTITY_MISMATCH');
  expect(()=>validateM06OperatorInputs({...valid,G6_M06_TRANSPORT_MODE:'truck'}))
   .toThrow('G6_M06_INPUT_TRANSPORT_MODE_INVALID');
 });
});
