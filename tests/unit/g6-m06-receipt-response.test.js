/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const {validateM06ReceiptResponse}=require('../../scripts/recette/canonical/m06-receipt-response');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const po='64b35352-dd57-4e20-b74f-3b5d385c14e4';
const order='7480fdad-4543-416e-a0b4-95b3c7b9801e';
const sku='352f0991-9639-45ab-aae5-96ba881a3bde';
const ref='SUPPLIER_PACKAGE-504dd209-4b32-4ef3-9af0-d42b1c76ebe4';
const valid=()=>({
 http:201,receiptRef:ref,poId:po,orderId:order,skuId:sku,quantity:3,
 json:{quarantined:false,
  unit:{id:'00523695-3698-41ac-9717-ef11e1d3233a',
   reference:ref,unit_type:'SUPPLIER_PACKAGE',state:'RECEIVED'},
  allocations:[{allocation:{
   id:'228c8835-3037-4e2b-8646-444f68319271',
   purchase_order_id:po,order_id:order,product_sku_id:sku,quantity:3,
  },quantity:3}],
  operation_id:'15abe005-0c8e-4b80-bc7f-6e1d64ce1b35'}
});
describe('M06 real Hub supplier-receive 201 response (no invented reconciliation flag)',()=>{
 test('accepts observed 201 complete-contents contract and requires independent PG readback',()=>{
  const proof=validateM06ReceiptResponse(valid());
  expect(proof).toMatchObject({http:201,receipt_contract_valid:true,readback_required:true,
   state:'RECEIVED',allocation_count:1,received_quantity:3,reconciliation_pending:false});
  expect(proof.allocation_id).toBe(valid().json.allocations[0].allocation.id);
  expect(valid().json).not.toHaveProperty('reconciliation_pending');
 });
 test('refuses quarantined, pending, missing allocation, wrong order, sku or quantity',()=>{
  const invalid=[
   {json:{...valid().json,quarantined:true}},
   {json:{...valid().json,reconciliation_pending:true}},
   {json:{...valid().json,allocations:[]}},
   {json:{...valid().json,unit:{...valid().json.unit,state:'QUARANTINED'}}},
   {http:409},{json:{...valid().json,unit:{...valid().json.unit,state:'IDENTIFIED'}}},
   {json:{...valid().json,allocations:[{...valid().json.allocations[0],
    allocation:{...valid().json.allocations[0].allocation,order_id:po}}]}},
   {json:{...valid().json,allocations:[{...valid().json.allocations[0],
    allocation:{...valid().json.allocations[0].allocation,product_sku_id:order}}]}},
   {json:{...valid().json,allocations:[{...valid().json.allocations[0],quantity:2}]}}
  ];
  for(const delta of invalid){
   expect(()=>validateM06ReceiptResponse({...valid(),...delta}))
    .toThrow('G6_M06_RECEIPT_UI_HTTP_OR_RECONCILIATION_INVALID');
  }
 });
 test('keeps exact money/quantity and PG physical truth strict from receipt to COMBOX',()=>{
  const receipt=fs.readFileSync(path.join(root,'scripts/recette/g6-m06-receiving-chromium.js'),'utf8');
  const combox=fs.readFileSync(path.join(root,'scripts/recette/g6-m06-direct-combox-chromium.js'),'utf8');
  const service=fs.readFileSync(path.join(root,'services/hub-physical-identity.js'),'utf8');
  expect(receipt).toContain("physical[0].state==='RECEIVED'");
  expect(receipt).toContain("Number(after.received_quantity)===3");
  expect(receipt).toContain("Number(after.external_payment_rows)===0");
  expect(receipt).toContain("Number(after.receive_placements_count)===1");
  expect(receipt).toContain("json.unit?.state||null");
  expect(combox).toContain("after.receipt_state==='RECEIVED'"); // before repack
  expect(combox).toContain("after.receipt_state==='SUPERSEDED'"); // after full repack
  expect(combox).toContain("!!after.receipt_placement_removed_at");
  expect(combox).toContain("p0.operation_type='RECEIVE'");
  expect(combox).not.toContain("p0.operation_type='RECEIVE' AND p0.removed_at IS NULL");
  expect(service).toContain("UPDATE hub_physical_units SET state = 'SUPERSEDED'");
  expect(service).toContain("initialState: 'RECEIVED'");
 });
});
