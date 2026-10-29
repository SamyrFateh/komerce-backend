'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {plan,parse,execute}=require('./v40-generated-inventory');
const {assess}=require('./v40-generated-inventory-oracle');
const anchor={contract:'komerce-inventory-owner-source-anchor/v30',
 service:'services/inventory-service.js',sourceHash:'a'.repeat(64)};
const spec={contract:'komerce-generated-inventory-case/v40',relation:'IMPLICIT',extraLines:1};
function fixture(input=spec){
 const a={id:'A',items_received:0,items_total:0,completion_ratio:0};
 const b={id:'B',items_received:0,items_total:0,completion_ratio:0};
 return {contract:'komerce-inventory-canonical-physical/v30',
  generatedSpec:input,realOwnerCalled:true,realCanonicalSchema:true,
  noExternalNetwork:true,mutationApplied:false,
  ids:{orderA:'A',orderB:'B',itemA:'a',itemB:'b'},
  before:{rows:[],orderA:{...a},orderB:{...b},
   orderAItemsCount:1+input.extraLines},
  after:{rows:input.relation==='FOREIGN'?[]:[{
   id:'inv',order_item_id:'a',inventory_order:'A',
   authoritative_order:'A',status:'received'}],
   orderA:input.relation==='FOREIGN'?{...a}:{
    ...a,items_received:1,items_total:1+input.extraLines,
    completion_ratio:1/(1+input.extraLines)},
   orderB:{...b},orderAItemsCount:1+input.extraLines},
  owner:input.relation==='FOREIGN'?{
   success:false,errorCode:'INVENTORY_ORDER_MISMATCH',errorStatus:409}:
   {success:true,response:{orderId:'A',orderItemId:'a'}}};
}
test('G3 selection generates varied owner inputs without mutant knowledge',()=>{
 const p=plan({files:['services/inventory-service.js'],budget:9,anchor});
 assert.equal(p.selected.length,9);
 assert.equal(new Set(p.selected.map(x=>JSON.stringify(x))).size,9);
 assert.ok(p.selected.some(x=>x.extraLines===2));
 assert.ok(p.selected.some(x=>x.relation==='FOREIGN'));
 assert.equal(p.mutationsVisibleToGenerator,false);
 assert.equal(p.selectionHash.length,64);
 assert.throws(()=>plan({files:['routes/other.js'],budget:4,anchor}),/G3_GENERATED_TOOL_ERROR/);
});
test('G3 independent oracle detects actual completion drift in generated case',()=>{
 const x=fixture();
 assert.equal(assess(x).violation,false);
 x.after.orderA.completion_ratio=0;
 const y=assess(x);
 assert.ok(y.signals.includes('INV_GEN_COMPLETION_MISMATCH'));
});
test('G3 independent oracle checks rejected physical writes, not just 409',()=>{
 const f={...spec,relation:'FOREIGN'};
 const x=fixture(f);
 assert.equal(assess(x).violation,false);
 x.after.rows.push({order_item_id:'a',inventory_order:'B',
  authoritative_order:'A'});
 const r=assess(x);
 assert.ok(r.signals.includes('INV_GEN_CANONICAL_IDENTITY_VIOLATION'));
 assert.ok(r.signals.includes('INV_GEN_REJECTED_RECEIPT_WROTE_DATA'));
});
test('G3 strict parser and local-only ephemeral DB fail closed',async()=>{
 assert.deepEqual(parse(['--budget','2']).budget,2);
 assert.equal(parse(['--evaluate-withheld']).evaluateWithheld,true);
 assert.throws(()=>parse(['--budget','2','--mutate-prod']),/G3_GENERATED_TOOL_ERROR/);
 const x=fixture();
 const env={NODE_ENV:'test',KOMERCE_DISABLE_CRONS:'true',
  DATABASE_URL:'postgres://u@localhost/komerce_test'};
 const result=await execute(spec,env,null,{
  withClone:async()=>({cloneCreated:true,cloneDroppedAfterExecution:true,result:x})
 });
 assert.equal(result.verdict,'PASS_WITH_EVIDENCE');
 await assert.rejects(execute(spec,env,null,{
  withClone:async()=>({cloneCreated:true,cloneDroppedAfterExecution:false,result:x})
 }),/clone not proven/);
});
