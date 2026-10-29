'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {checkFinancialSchedule,evaluateSchedules}=require('./v22-financial-invariants');
const {collapseFrozenPairs}=require('./v22-prioritize-pairs');
const refund=(method,id='')=>({refund_type:'full',refund_method:method,
 amount_kmf:10000,amount_eur:20,status:'completed',stripe_refund_id:id});
function sample(mode,{paypal=true,wallet=false,paypalLedger=paypal,success=true}={}){
 return {mode,capture:{eur:20,kmf:10000},
  outcomes:{paypal:{http:paypal&&success?200:422}},
  state:{refunds:[...(wallet?[refund('wallet_credit')]:[]),
   ...(!wallet&&paypalLedger?[refund('paypal','PP-REF-1')]:[])],
   walletCreditKmf:wallet?10000:0,
   pspEvents:paypal?[{id:'PP-REF-1',amountEur:20}]:[]}};
}
test('Opus AB counterexample: serialized order violates value and ledger provenance',()=>{
 const r=checkFinancialSchedule(sample('AB',{wallet:true,paypal:true}));
 assert.deepEqual(r.signals,[
  'I1_ECONOMIC_REFUNDS_EXCEED_CAPTURE',
  'I2_PSP_REFUND_MISSING_FROM_LEDGER',
  'I3_OWNER_SUCCESS_WITH_UNRECORDED_PSP_REFUND']);
 assert.equal(r.totalRefundValueCents,4000);
 assert.equal(r.capturedCents,2000);
});
test('BA return 422 for cancel and one registered PayPal refund is economically valid',()=>{
 const r=checkFinancialSchedule(sample('BA'));
 assert.deepEqual(r.signals,[]);
 assert.equal(r.totalRefundValueCents,2000);
});
test('a single wallet credit is a valid full refund without a PSP event',()=>{
 const r=checkFinancialSchedule(sample('AB',{wallet:true,paypal:false}));
 assert.equal(r.violation,false);
});
test('PSP side effect without ledger is detected even if cumulative outflow is below capture',()=>{
 const r=checkFinancialSchedule(sample('PAR',{wallet:false,paypal:true,paypalLedger:false}));
 assert.ok(r.signals.includes('I2_PSP_REFUND_MISSING_FROM_LEDGER'));
 assert.ok(!r.signals.includes('I1_ECONOMIC_REFUNDS_EXCEED_CAPTURE'));
});
test('financial invariant cannot claim success without trace of PSP IDs and captured FX',()=>{
 const r=sample('AB');delete r.state.pspEvents;
 assert.throws(()=>checkFinancialSchedule(r),/TOOL_ERROR/);
 const x=sample('AB');x.capture.kmf=0;
 assert.throws(()=>checkFinancialSchedule(x),/TOOL_ERROR/);
});
test('AB, AB-repeat, BA, PAR each get a verdict irrespective of serializability',()=>{
 const v=evaluateSchedules([
  sample('AB',{wallet:true}),sample('AB_REPEAT',{wallet:true}),
  sample('BA'),sample('PAR',{wallet:true})]);
 assert.equal(v.deterministic,true);
 assert.deepEqual(v.violatedSchedules,['AB','AB_REPEAT','PAR']);
});
function frozen(){
 const files={
  'services/refund-service.js':`async function processRefund(client){await assertRefundWithinCaptured(client,order);await client.query('INSERT INTO refunds VALUES(1)')}\nasync function recordExternalRefund(client){await client.query('INSERT INTO refunds VALUES(2)')}`,
  'services/stock.js':`async function stockChange(client){await client.query('SELECT * FROM local_stock_allocations');await client.query('UPDATE local_stock_allocations SET quantity=1')}`
 };
 const actors=(one,two)=>[one,two].map(([source,method,lock])=>({
  source,entry:'testAction',ownerFunction:method,hasLocalLock:lock,
  hasOwnerReadPrecheck:true,routePaths:['routes/example.js']}));
 const a=['services/payment-paypal.js','recordExternalRefund',false],
  b=['services/admin-order-refund.js','processRefund',true],
  c=['routes/orders/cancel.js','processRefund',true],
  k=['routes/stock.js','stockChange',false];
 const pairs=[
  {id:'a',table:'refunds',owner:'services/refund-service.js',actors:actors(a,b)},
  {id:'b',table:'refunds',owner:'services/refund-service.js',actors:actors(a,c)},
  {id:'c',table:'local_stock_allocations',owner:'services/stock.js',actors:actors(k,k)},
  {id:'d',table:'refunds',owner:'services/refund-service.js',actors:actors(b,c)},
  {id:'e',table:'refunds',owner:'services/refund-service.js',
   actors:actors(['services/simulator/refund.js','recordExternalRefund',false],b)}
 ];
 return {source:p=>files[p],frozen:{contract:'komerce-static-pair-selector/v21',
  selectionHash:'a'.repeat(64),selectionLockedBeforeDbExecution:true,pairs}};
}
test('equivalent refund paths collapse without writing the desired pair into selector',()=>{
 const {source,frozen:f}=frozen();
 const v=collapseFrozenPairs(f,source);
 assert.ok(v.rank.length>=1);
 assert.equal(v.rank[0].table,'refunds');
 assert.ok(v.rank.every(x=>x.scope.includes('STATIC')));
 assert.ok(v.counts.dropped.simulated>=1);
 assert.ok(v.pr.length<=5&&v.nightly.length<=10);
});
test('unreviewed or mutated ranking is not accepted as pre-frozen',()=>{
 const {source,frozen:f}=frozen();f.selectionHash='untrusted';
 assert.throws(()=>collapseFrozenPairs(f,source),/TOOL_ERROR/);
});
