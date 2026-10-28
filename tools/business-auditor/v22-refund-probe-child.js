#!/usr/bin/env node
'use strict';
/**
 * Adapted from Opus's independent refund-paypal-cancel-probe.js.
 * Test ONLY: child process must receive a disposable kba_* database.
 * Authentication middleware is bypassed as in source probe: HTTP reachability
 * is NOT proven. All PSP/SMS network effects are blocked or simulated.
 * Cleanup is owned by the V1.6 parent via CREATE DATABASE / DROP DATABASE.
 */
const path=require('node:path'),crypto=require('node:crypto');
const url=new URL(process.env.DATABASE_URL||'');
if(process.env.NODE_ENV!=='test'||process.env.KOMERCE_DISABLE_CRONS!=='true'||
 !['127.0.0.1','localhost','::1'].includes(url.hostname)||
 !/^\/kba_[a-f0-9]{18}$/.test(url.pathname))
 throw Error('TOOL_ERROR: refuse to use an external or non-cloned PostgreSQL database');
const repo=path.resolve(__dirname,'../..');
const mode=process.argv[2];
if(process.env.KBA_V23_MUTANT && process.env.KBA_V23_MUTANT!=='PREFLIGHT_ONLY')
 throw Error('TOOL_ERROR: unknown research mutation (fail closed)');
if(process.env.KBA_V24_MUTANT && process.env.KBA_V24_MUTANT!=='DURABLE_INTENT_COUNTERFACTUAL')
 throw Error('TOOL_ERROR: unknown V2.4 research mutation (fail closed)');
if(process.env.KBA_V23_MUTANT && process.env.KBA_V24_MUTANT)
 throw Error('TOOL_ERROR: research mutations must not overlap');
if(!['AB','AB_REPEAT','BA','PAR'].includes(mode))throw Error('TOOL_ERROR: invalid probe schedule');
process.env.PAYPAL_CLIENT_ID='OFFLINE';
process.env.PAYPAL_CLIENT_SECRET='OFFLINE';
process.env.PAYPAL_ENV='sandbox';
process.env.STRIPE_SECRET_KEY='sk_test_offline_never_called';
const http=require('node:http'),https=require('node:https');
for(const module of [http,https]){
 module.request=()=>{throw Error('NETWORK_FORBIDDEN_HTTP_REQUEST')};
 module.get=()=>{throw Error('NETWORK_FORBIDDEN_HTTP_GET')};
}
const psp={events:[],gate:null,waiting:false};
global.fetch=async (requested,opts={})=>{
 const u=String(requested);
 if(!u.startsWith('https://api-m.sandbox.paypal.com/'))
  throw Error('NETWORK_FORBIDDEN '+u.slice(0,120));
 if(u.endsWith('/v1/oauth2/token'))
  return {ok:true,status:200,json:async()=>({access_token:'OFFLINE',expires_in:32400})};
 if(/\/v2\/payments\/captures\/[^/]+\/refund$/.test(u)){
  psp.waiting=true;
  if(psp.gate)await psp.gate;
  const body=JSON.parse(opts.body||'{}');
  const id='PP-REF-'+(psp.events.length+1);
  const amountEur=Number(body.amount?.value);
  if(!(amountEur>0))throw Error('TOOL_ERROR: invalid simulated PSP amount');
  psp.events.push({id,amountEur,key:opts.headers?.['PayPal-Request-Id']||null});
  return {ok:true,status:201,json:async()=>({id,status:'COMPLETED'})};
 }
 throw Error('NETWORK_FORBIDDEN '+u.slice(0,120));
};
function stub(rel,exp){
 const p=require.resolve(path.join(repo,rel));
 require.cache[p]={id:p,filename:p,loaded:true,exports:exp};
}
stub('services/documents/refund-receipt',{issue:async()=>null});
stub('services/notification-service',{notifyCancellation:()=>{}});
const db=require(path.join(repo,'db'));
const v24=process.env.KBA_V24_MUTANT ? require('./v24-durable-intent-counterfactual') : null;
if(v24) {
 // Install ONLY a test-module wrapper before the real cancel router binds
 // its destructured processRefund. No application source file is rewritten.
 const file=require.resolve(path.join(repo,'services/refund-service'));
 const original=require(file);
 require.cache[file].exports={...original,processRefund:v24.wrapCancellation(original.processRefund)};
}
const uuid=()=>crypto.randomUUID();
async function seed(){
 const c=await db.getClient();
 try{
  const market=(await c.query("SELECT id FROM markets WHERE code='KM' LIMIT 1")).rows[0];
  if(!market)throw Error('TOOL_ERROR: market KM missing');
  const ids={user:uuid(),admin:uuid(),relay:uuid(),product:uuid(),order:uuid()};
  await c.query("INSERT INTO users(id,full_name,phone) VALUES($1,'Client','+269100'),($2,'Admin','+269101')",
    [ids.user,ids.admin]);
  await c.query("INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,'R','A','+2690','L',$2)",
    [ids.relay,market.id]);
  await c.query("INSERT INTO products(id,name,price_kmf,stock) VALUES($1,'P',10000,10)",[ids.product]);
  await c.query(`INSERT INTO orders(id,reference,user_id,relais_id,market_id,total_kmf,total_eur,
     payment_mode,payment_status,status,paypal_capture_id,ordered_at)
    VALUES($1,$2,$3,$4,$5,10000,20.00,'paypal_eur','paid','ordered','CAP-OFFLINE',now())`,
    [ids.order,'KBA22-'+ids.order.slice(0,8),ids.user,ids.relay,market.id]);
  await c.query("INSERT INTO order_items(order_id,product_id,price_kmf,quantity,fulfillment_source) VALUES($1,$2,10000,1,'IMPORT')",
   [ids.order,ids.product]);
  return ids;
 }finally{c.release()}
}
function cancelHandler(){
 const router=require(path.join(repo,'routes/orders/cancel.js'));
 const layer=router.stack.find(l=>l.route?.path==='/:id/cancel'&&l.route.methods.post);
 if(!layer)throw Error('TOOL_ERROR: cancel handler not found');
 return layer.route.stack.at(-1).handle;
}
function cancel(ids){
 return new Promise(resolve=>{
  const res={code:200,status(s){this.code=s;return this},
   json(body){resolve({http:this.code,body});return this}};
  cancelHandler()({params:{id:ids.order},body:{reason:'isolated-probe'},
   user:{id:ids.user,role:'client'}},res,e=>
   resolve({http:e?.status||500,error:e?.code||e?.message?.slice(0,100)}));
 });
}
async function paypalRefund(ids){
 const {refundPaypalOrder: owner}=require(path.join(repo,'services/payment-paypal'));
 const refundPaypalOrder=v24 ? v24.wrapPaypal(owner) :
  process.env.KBA_V23_MUTANT==='PREFLIGHT_ONLY'
   ? require('./v23-preflight-mutant').preflightOnly(owner) : owner;
 const paypal=require(path.join(repo,'services/paypal-client'));
 try{
  const r=await refundPaypalOrder({orderId:ids.order,amountEur:20,reason:'isolated-probe',
   adminUser:{id:ids.admin,role:'admin'},paypal,db});
  return {http:r.status,error:r.body?.error??null};
 }catch(e){return {http:500,error:e.code||e.message?.slice(0,100)}}
}
async function observe(ids){
 const sql=async(q,p)=>(await db.query(q,p)).rows;
 const refunds=await sql("SELECT refund_type,refund_method,amount_kmf::int AS amount_kmf,amount_eur::float AS amount_eur,status,stripe_refund_id FROM refunds WHERE order_id=$1 ORDER BY refund_type,refund_method",[ids.order]);
 const [order]=await sql('SELECT status,payment_status FROM orders WHERE id=$1',[ids.order]);
 const [{kmf:walletCreditKmf}]=await sql(`SELECT COALESCE(SUM(t.amount_kmf),0)::int AS kmf FROM wallet_transactions t
 JOIN wallets w ON w.id=t.wallet_id WHERE w.user_id=$1 AND t.amount_kmf>0`,[ids.user]);
 return {refunds,order,walletCreditKmf,
  pspEvents:psp.events,pspRefundedEur:psp.events.reduce((n,x)=>n+x.amountEur,0)};
}
async function main(){
 let result;
 try{
  if(v24)await v24.bootstrap(db);
  const ids=await seed();
  let cancelResult,paypalResult,extraReplay;
  if(['AB','AB_REPEAT'].includes(mode)){
   cancelResult=await cancel(ids);
   paypalResult=await paypalRefund(ids);
   if(v24&&mode==='AB_REPEAT')extraReplay=await paypalRefund(ids);
  }else if(mode==='BA'){
   paypalResult=await paypalRefund(ids);
   cancelResult=await cancel(ids);
  }else{
   let release;
   psp.gate=new Promise(resolve=>{release=resolve});
   const inFlight=paypalRefund(ids);
   const until=Date.now()+12000;
   while(!psp.waiting){
    if(Date.now()>until){release();throw Error('TOOL_ERROR: PSP call never reached simulated latency gate')}
    await new Promise(resolve=>setTimeout(resolve,20));
   }
   try{cancelResult=await cancel(ids)}
   finally{release()}
   paypalResult=await inFlight;
  }
  const state=await observe(ids);
  if(v24){
   state.intents=(await db.query('SELECT owner,state,amount_eur::float,amount_kmf::int,provider_request_key,provider_refund_id FROM kba_refund_intents WHERE order_id=$1',[ids.order])).rows;
  }
  result={mode,outcomes:{cancel:cancelResult,paypal:paypalResult,
   ...(extraReplay ? {replay:extraReplay} : {})},
   ...(process.env.KBA_V23_MUTANT ? {researchMutation:process.env.KBA_V23_MUTANT} : {}),
   ...(v24 ? {researchMutation:process.env.KBA_V24_MUTANT} : {}),
   capture:{eur:20,kmf:10000},state,simulation:'PAYPAL_FETCH_STRICT_NO_EXTERNAL_NETWORK',
   authMiddlewareExecuted:false,localCloneVerified:true};
  console.log('BUSINESS_AUDIT_V22_FINANCIAL_PROBE '+JSON.stringify(result));
 }finally{await db.pool?.end?.()}
 return result;
}
main().catch(e=>{console.error('BUSINESS_AUDIT_V22_CHILD_TOOL_ERROR '+(e.stack||e.message));process.exitCode=2});
