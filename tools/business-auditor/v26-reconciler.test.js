'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {strictProvider,reconcile}=require('./v26-reconciler');
const order={paypal_capture_id:'CAP-OFFLINE'},intent={
 provider_request_key:'kmr-ref-12345678-1234-1234-1234-123456789abc',amount_eur:20};
const event={id:'PP-V25-REF-1',status:'COMPLETED',currency:'EUR',
 captureId:'CAP-OFFLINE',providerRequestKey:intent.provider_request_key,amountEur:20};
test('independent proof accepts complete matched simulated provider record',()=>{
 assert.equal(strictProvider(event,order,intent),true);
});
for(const [name,changed] of [
 ['wrong_capture',{captureId:'CAP-OTHER'}],
 ['wrong_key',{providerRequestKey:'REF-OTHER'}],
 ['wrong_amount',{amountEur:19}],
 ['wrong_currency',{currency:'USD'}],
 ['pending_status',{status:'PENDING'}],
 ['unknown_id',{id:'OTHER'}],
 ['missing_id',{id:null}],
 ['fractional_undetected_cent',{amountEur:20.01}],
]){
 test('fails closed on '+name,()=>assert.equal(strictProvider({...event,...changed},order,intent),false));
}
test('reconciler refuses a production/non-clone target before it acquires a client',async()=>{
 const prior=Object.fromEntries(['DATABASE_URL','NODE_ENV',
  'KOMERCE_DISABLE_CRONS','KBA_V24_MUTANT'].map(k=>[k,process.env[k]]));
 Object.assign(process.env,{DATABASE_URL:'postgres://user@db.production.example.com/komerce',
  NODE_ENV:'test',KOMERCE_DISABLE_CRONS:'true',
  KBA_V24_MUTANT:'DURABLE_INTENT_COUNTERFACTUAL'});
 let called=false;
 try {
  await assert.rejects(()=>reconcile({orderId:'12345678-1234-1234-1234-123456789abc',
   db:{getClient(){called=true}},readProvider:async()=>({status:'AVAILABLE'})}),
   /TOOL_ERROR/);
  assert.equal(called,false);
 }finally{
  for(const [key,value] of Object.entries(prior)){
   if(value===undefined)delete process.env[key];
   else process.env[key]=value;
  }
 }
});
