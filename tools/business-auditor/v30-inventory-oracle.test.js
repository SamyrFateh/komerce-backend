'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {assess,forgeAfterRejection}=require('./v30-inventory-oracle');
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
function snapshot(mode){
 const A=uuid(1),B=uuid(2),itemA=uuid(3),itemB=uuid(4);
 const a={id:A,items_received:0,items_total:0,completion_ratio:'0'};
 const b={id:B,items_received:0,items_total:0,completion_ratio:'0'};
 const nominal=mode==='NOMINAL';
 return {contract:'komerce-inventory-canonical-physical/v30',mode,
  realOwnerCalled:true,realCanonicalSchema:true,noExternalNetwork:true,
  authMiddlewareExecuted:false,ids:{orderA:A,orderB:B,itemA,itemB},
  owner:nominal?{success:true,errorCode:null,errorStatus:null,
   response:{orderId:A,orderItemId:itemA}}:
   {success:false,errorCode:'INVENTORY_ORDER_MISMATCH',errorStatus:409,response:null},
  before:{rows:[],orderA:{...a},orderB:{...b}},
  after:{rows:nominal?[{id:uuid(5),order_item_id:itemA,
   inventory_order:A,authoritative_order:A,status:'buffered'}]:[],
   orderA:nominal?{id:A,items_received:1,items_total:1,completion_ratio:'1'}:{...a},
   orderB:{...b}}};
}
test('one canonical receipt to order A updates only A',()=>{
 assert.deepEqual(assess(snapshot('NOMINAL')).signals,[]);
});
test('foreign B request returns typed 409 and leaves every row/counter unchanged',()=>{
 const v=assess(snapshot('FOREIGN_ORDER'));
 assert.equal(v.violation,false);
 assert.equal(v.insertedRows,0);
 assert.equal(v.orderBCompletionAfter,0);
});
test('forged 409 still fails when foreign inventory row and B completion exists',()=>{
 const x=assess(forgeAfterRejection(snapshot('FOREIGN_ORDER')));
 assert.ok(x.signals.includes('INV1_CANONICAL_ORDER_IDENTITY_BROKEN'));
 assert.ok(x.signals.includes('INV3_FOREIGN_ORDER_COMPLETION_CHANGED'));
 assert.ok(x.signals.includes('INV7_REJECTED_REQUEST_LEFT_PHYSICAL_WRITES'));
});
test('weak status-code-only fix cannot mask lingering foreign row',()=>{
 const x=snapshot('FOREIGN_ORDER');
 x.after.rows=[{order_item_id:x.ids.itemA,
  inventory_order:x.ids.orderB,authoritative_order:x.ids.orderA}];
 assert.ok(assess(x).signals.includes('INV1_CANONICAL_ORDER_IDENTITY_BROKEN'));
});
test('owner returning nominal success with no canonical write fails',()=>{
 const x=snapshot('NOMINAL');x.after.rows=[];
 assert.ok(assess(x).signals.includes('INV4_NOMINAL_RECEIPT_NOT_CANONICAL'));
});
test('owner writing canonical row but failing completion projection fails',()=>{
 const x=snapshot('NOMINAL');x.after.orderA.items_received=0;
 assert.ok(assess(x).signals.includes('INV5_RECEIPT_COMPLETION_NOT_RECONCILED'));
});
test('wrong error code on foreign receipt is independently rejected',()=>{
 const x=snapshot('FOREIGN_ORDER');x.owner.errorCode='BAD_REQUEST';
 assert.ok(assess(x).signals.includes('INV6_FOREIGN_ORDER_NOT_REJECTED_WITH_409'));
});
test('missing real DB snapshots or mixed identifiers are TOOL errors',()=>{
 const x=snapshot('NOMINAL');delete x.after.orderB;
 assert.throws(()=>assess(x),/V30_ORACLE_TOOL_ERROR/);
 const y=snapshot('NOMINAL');y.ids.orderB=y.ids.orderA;
 assert.throws(()=>assess(y),/V30_ORACLE_TOOL_ERROR/);
});
