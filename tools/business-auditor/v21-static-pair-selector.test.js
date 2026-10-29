'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {selectPairs}=require('./v21-static-pair-selector');
function fixture(){
 const files={
  'routes/payments.js':"const { refundPaypal } = require('../services/payment-paypal');\nmodule.exports=()=>refundPaypal();",
  'routes/admin.js':"const { refundAdmin } = require('../services/admin-order-refund');\nmodule.exports=()=>refundAdmin();",
  'services/payment-paypal.js':"const { recordExternalRefund }=require('./refund-service');\nasync function refundPaypal(){await recordExternalRefund(db,{orderId:'A'})}\nmodule.exports={refundPaypal};",
  'services/admin-order-refund.js':"const { processRefund }=require('./refund-service');\nasync function refundAdmin(){await db.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE');await processRefund(db,order)}\nmodule.exports={refundAdmin};",
  'services/refund-service.js':"async function processRefund(){await assertRefundWithinCaptured(client,order);await client.query('INSERT INTO refunds(order_id) VALUES ($1)')}\nasync function recordExternalRefund(){await client.query('INSERT INTO refunds(order_id) VALUES ($1)')}\nmodule.exports={processRefund,recordExternalRefund};",
  'utils/refunds.js':"async function legacyRefund(){await client.query('INSERT INTO refunds(order_id) VALUES ($1)')}\nmodule.exports={legacyRefund};"
 };
 const writes=[{file:'services/refund-service.js',line:1,table:'refunds',action:'INSERT INTO',physicalTableDeclared:true},
  {file:'services/refund-service.js',line:2,table:'refunds',action:'INSERT INTO',physicalTableDeclared:true},
  {file:'utils/refunds.js',line:1,table:'refunds',action:'INSERT INTO',physicalTableDeclared:true}];
 return selectPairs({paths:Object.keys(files),read:p=>files[p],writes});
}
test('static selector discovers opposing refund boundaries without naming either explicitly',()=>{
 const result=fixture();
 const match=result.pairs.find(x=>x.table==='refunds'&&
  x.actors.some(a=>a.source==='services/payment-paypal.js')&&
  x.actors.some(a=>a.source==='services/admin-order-refund.js'));
 assert.ok(match,'static import and owner-call chain must yield payment/admin pair');
 assert.equal(match.actors.some(a=>a.hasLocalLock===false),true);
 assert.equal(match.actors.some(a=>a.hasLocalLock===true),true);
 assert.equal(match.scope,'STATIC_FUNCTION_SCOPED_CANDIDATE_NOT_RUNTIME_PROOF');
});
test('dead utility is filtered by static route reachability, without hardcoding its basename',()=>{
 const result=fixture();
 assert.ok(!result.pairs.some(x=>x.owner==='utils/refunds.js'));
 assert.ok(result.excluded.some(x=>x.owner==='utils/refunds.js'));
});
test('ranking and frozen hash are deterministic under stable tracked-source ordering',()=>{
 const a=fixture(),b=fixture();
 assert.equal(a.selectionHash,b.selectionHash);
 assert.deepEqual(a.pairs,b.pairs);
 assert.ok(/^[a-f0-9]{64}$/.test(a.selectionHash));
});
test('imports are not interpreted as executed entrypoints without an actual call expression',()=>{
 const p=fixture();
 assert.ok(p.pairs.every(x=>x.actors.every(a=>a.runtimeReachabilityProven===false)));
});
