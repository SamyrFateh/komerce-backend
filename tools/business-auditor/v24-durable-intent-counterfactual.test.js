'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {isolated,wrapCancellation,wrapPaypal}=require('./v24-durable-intent-counterfactual');
function environment(fn){
 const keys=['DATABASE_URL','NODE_ENV','KOMERCE_DISABLE_CRONS','KBA_V24_MUTANT'];
 const prior=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 Object.assign(process.env,{DATABASE_URL:'postgres://test@127.0.0.1/kba_123456789012345678',
  NODE_ENV:'test',KOMERCE_DISABLE_CRONS:'true',
  KBA_V24_MUTANT:'DURABLE_INTENT_COUNTERFACTUAL'});
 return Promise.resolve().then(fn).finally(()=>{
  for(const key of keys){
   if(prior[key]===undefined)delete process.env[key];
   else process.env[key]=prior[key];
  }
 });
}
test('V2.4 refuses non-isolated database, even if mutant flag is set',()=>environment(()=>{
 process.env.DATABASE_URL='postgres://x@db.production.example.com/komerce';
 assert.throws(()=>isolated(),/TOOL_ERROR/);
 process.env.DATABASE_URL='postgres://x@127.0.0.1/komerce_test';
 assert.throws(()=>isolated(),/TOOL_ERROR/);
}));
test('wallet cannot run after conflicting durable financial claim',()=>environment(async()=>{
 let called=0;
 const safe=wrapCancellation(async()=>{called++;return {}});
 const client={query:async sql=>{
  assert.match(sql,/INSERT INTO kba_refund_intents/);return {rows:[]};
 }};
 await assert.rejects(()=>safe(client,{id:'order'},10000,20,'full','x','actor'),e=>
  e.code==='REFUND_INTENT_CONFLICT'&&e.status===409);
 assert.equal(called,0);
}));
test('wallet intent inserted in calling transaction before actual owner and completed after',()=>environment(async()=>{
 const trace=[];
 const client={query:async sql=>{
  if(sql.includes('INSERT INTO kba_refund_intents')){trace.push('claim');return {rows:[{order_id:'x'}]};}
  if(sql.includes('UPDATE kba_refund_intents')){trace.push('complete');return {rowCount:1};}
  throw Error('Unexpected SQL '+sql);
 }};
 const guarded=wrapCancellation(async()=>{trace.push('owner');return {method:'wallet_credit'}});
 const result=await guarded(client,{id:'x'},10000,20,'full','x','actor');
 assert.equal(result.method,'wallet_credit');
 assert.deepEqual(trace,['claim','owner','complete']);
}));
test('PayPal intent commits before any external effect and uses same durable key',()=>environment(async()=>{
 const trace=[],order={id:'o',status:'ordered',payment_status:'paid',
  total_eur:20,total_kmf:10000};
 let keySeen;
 const client={
  async query(sql,params){
   if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK'){
    trace.push(sql);return {rows:[]};
   }
   if(sql.startsWith('SELECT * FROM orders'))return {rows:[order]};
   if(sql.startsWith('SELECT id FROM refunds'))return {rows:[]};
   if(sql.startsWith('INSERT INTO kba_refund_intents')){
    keySeen=params[3];trace.push('claim');return {rows:[{order_id:'o'}]};
   }
   throw Error('Unexpected sql '+sql);
  },
  release(){trace.push('release');}
 };
 const fakeDb={
  async getClient(){return client;},
  async query(sql,params){
   if(sql.startsWith('SELECT id,amount_eur,status'))return {
    rows:[{id:'r',amount_eur:20,status:'completed'}]};
   if(sql.startsWith('UPDATE kba_refund_intents')){
    trace.push('complete');return {rowCount:1};
   }
   throw Error('Unexpected DB '+sql);
  }
 };
 const paypal={async refundCapture(id,options){
  trace.push('PSP');assert.equal(id,'capture');
  assert.equal(options.providerRequestKey,keySeen);
  return {id:'PP-REF-1',status:'COMPLETED'};
 }};
 const owner=async ({paypal})=>{
  const refund=await paypal.refundCapture('capture',{amountEur:20});
  return {status:200,body:{refund_id:refund.id}};
 };
 const result=await wrapPaypal(owner)({orderId:'o',amountEur:20,db:fakeDb,paypal});
 assert.equal(result.status,200);
 assert.match(keySeen,/^kmr-ref-[a-f0-9-]{36}$/);
 assert.ok(trace.indexOf('COMMIT')<trace.indexOf('PSP'));
 assert.deepEqual(trace,['BEGIN','claim','COMMIT','release','PSP','complete']);
}));
test('PayPal must not call PSP when canonical refund already exists',()=>environment(async()=>{
 let ownerCalls=0,rollback=0;
 const client={async query(sql){
  if(sql==='ROLLBACK'){rollback++;return {rows:[]};}
  if(sql.startsWith('SELECT * FROM orders'))return {rows:[{status:'ordered',payment_status:'paid',total_eur:20,total_kmf:10000}]};
  if(sql.startsWith('SELECT id FROM refunds'))return {rows:[{id:'wallet'}]};
  return {rows:[]};
 },release(){}};
 const guarded=wrapPaypal(async()=>{ownerCalls++;return {status:200}});
 const result=await guarded({orderId:'o',amountEur:20,
  db:{getClient:async()=>client},paypal:{refundCapture:async()=>{throw Error('PSP!');}}});
 assert.equal(result.status,409);assert.equal(ownerCalls,0);assert.equal(rollback,1);
}));
