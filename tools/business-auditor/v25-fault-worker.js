#!/usr/bin/env node
'use strict';
/**
 * V2.5 research FAULT worker. It is never reachable from any HTTP route.
 * The external PSP evidence is an fsynced append-only JSONL file held by
 * the parent (outside SQL), so it survives a forced worker process.exit(86).
 * No actual network request, no real PSP, no production DB.
 */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const repo=path.resolve(__dirname,'../..');
const mode=process.argv[2];
const FAULTS=['PRE_PSP_HARD_EXIT','POST_PSP_HARD_EXIT',
 'POST_LEDGER_HARD_EXIT','PSP_TIMEOUT_AFTER_EFFECT'];
const fault=process.env.KBA_V25_FAULT;
function safe() {
 const url=new URL(process.env.DATABASE_URL||'');
 if(process.env.NODE_ENV!=='test'||process.env.KOMERCE_DISABLE_CRONS!=='true'||
    process.env.KBA_V24_MUTANT!=='DURABLE_INTENT_COUNTERFACTUAL'||
    !['localhost','127.0.0.1','::1'].includes(url.hostname)||
    !/^\/kba_[a-f0-9]{18}$/.test(url.pathname)||
    !['FAULT','RETRY'].includes(mode)||
    (mode==='FAULT'&&!FAULTS.includes(fault))||
    (mode==='RETRY'&&fault!=='RETRY'))
  throw Error('V25_TOOL_ERROR: unsafe execution context');
 for(const key of ['KBA_V25_SEED_PATH','KBA_V25_PROVIDER_LOG']){
  const p=process.env[key];
  if(!p||!path.resolve(p).startsWith(path.join(os.tmpdir(),'kba_v25_')))
   throw Error('V25_TOOL_ERROR: unsafe evidence path');
 }
}
safe();
process.env.PAYPAL_CLIENT_ID='OFFLINE';
process.env.PAYPAL_CLIENT_SECRET='OFFLINE';
process.env.PAYPAL_ENV='sandbox';
process.env.STRIPE_SECRET_KEY='sk_test_offline_never_called';
const http=require('node:http'),https=require('node:https');
for(const m of [http,https]){
 m.request=()=>{throw Error('NETWORK_FORBIDDEN_HTTP_REQUEST')};
 m.get=()=>{throw Error('NETWORK_FORBIDDEN_HTTP_GET')};
}
const providerLog=process.env.KBA_V25_PROVIDER_LOG;
const seedPath=process.env.KBA_V25_SEED_PATH;
let pspCalls=0;
global.fetch=async(requested,opts={})=>{
 const url=String(requested);
 if(url==='https://api-m.sandbox.paypal.com/v1/oauth2/token')
  return {ok:true,status:200,json:async()=>({access_token:'OFFLINE',expires_in:32400})};
 if(!/^https:\/\/api-m\.sandbox\.paypal\.com\/v2\/payments\/captures\/[^/]+\/refund$/.test(url))
  throw Error('NETWORK_FORBIDDEN '+url.slice(0,100));
 if(mode==='RETRY')throw Error('V25_SECOND_PSP_CALL_FORBIDDEN');
 pspCalls++;
 const body=JSON.parse(opts.body||'{}');
 const event={id:'PP-V25-REF-'+pspCalls,
  amountEur:Number(body.amount?.value),
  currency:body.amount?.currency_code,
  providerRequestKey:opts.headers?.['PayPal-Request-Id']||null,
  captureId:url.split('/')[6]};
 if(event.amountEur!==20||event.currency!=='EUR'||
   !/^kmr-ref-[0-9a-f-]{36}$/i.test(event.providerRequestKey||''))
  throw Error('V25_TOOL_ERROR: PSP capture/key mismatch');
 // This fsynced file simulates independent provider durable evidence.
 const fd=fs.openSync(providerLog,'a');
 try{fs.writeSync(fd,JSON.stringify(event)+'\n');fs.fsyncSync(fd)}
 finally{fs.closeSync(fd)}
 if(fault==='POST_PSP_HARD_EXIT')process.exit(86);
 if(fault==='PSP_TIMEOUT_AFTER_EFFECT')throw Error('V25_SIMULATED_TIMEOUT_AFTER_PROVIDER_EFFECT');
 return {ok:true,status:201,json:async()=>({id:event.id,status:'COMPLETED'})};
};
function stub(file,exp){
 const full=require.resolve(path.join(repo,file));
 require.cache[full]={id:full,filename:full,loaded:true,exports:exp};
}
stub('services/documents/refund-receipt',{issue:async()=>null});
stub('services/notification-service',{notifyCancellation:()=>{}});
const db=require(path.join(repo,'db'));
const v24=require('./v24-durable-intent-counterfactual');
const uuid=()=>crypto.randomUUID();
async function seed(){
 const c=await db.getClient();
 try{
  const m=(await c.query("SELECT id FROM markets WHERE code='KM' LIMIT 1")).rows[0];
  if(!m)throw Error('V25_TOOL_ERROR: no KM market');
  const ids={user:uuid(),admin:uuid(),relay:uuid(),product:uuid(),order:uuid()};
  await c.query("INSERT INTO users(id,full_name,phone) VALUES($1,'Client','+269100'),($2,'Admin','+269101')",[ids.user,ids.admin]);
  await c.query("INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,'R','A','+2690','L',$2)",[ids.relay,m.id]);
  await c.query("INSERT INTO products(id,name,price_kmf,stock) VALUES($1,'P',10000,10)",[ids.product]);
  await c.query("INSERT INTO orders(id,reference,user_id,relais_id,market_id,total_kmf,total_eur,payment_mode,payment_status,status,paypal_capture_id,ordered_at) VALUES($1,$2,$3,$4,$5,10000,20,'paypal_eur','paid','ordered','CAP-OFFLINE',now())",[ids.order,'KBA25-'+ids.order.slice(0,8),ids.user,ids.relay,m.id]);
  await c.query("INSERT INTO order_items(order_id,product_id,price_kmf,quantity,fulfillment_source) VALUES($1,$2,10000,1,'IMPORT')",[ids.order,ids.product]);
  fs.writeFileSync(seedPath,JSON.stringify(ids));
  return ids;
 }finally{c.release()}
}
async function execute(){
 await v24.bootstrap(db);
 const ids=mode==='FAULT'?await seed():JSON.parse(fs.readFileSync(seedPath,'utf8'));
 const {refundPaypalOrder:owner}=require(path.join(repo,'services/payment-paypal'));
 const paypal=require(path.join(repo,'services/paypal-client'));
 const wrapped=v24.wrapPaypal(owner);
 const result=await wrapped({orderId:ids.order,amountEur:20,
  reason:'fault-probe',adminUser:{id:ids.admin,role:'admin'},paypal,db});
 return {status:result.status,body:result.body,providerCalls:pspCalls};
}
execute().then(async result=>{
 console.log('BUSINESS_AUDIT_V25_CHILD '+JSON.stringify({mode,fault,result}));
 await db.pool.end();
}).catch(async e=>{
 console.log('BUSINESS_AUDIT_V25_CHILD '+JSON.stringify({mode,fault,
  result:{status:'exception',error:e.code||e.message,providerCalls:pspCalls}}));
 await db.pool.end().catch(()=>{});
 process.exitCode=2;
});
