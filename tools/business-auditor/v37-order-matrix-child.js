#!/usr/bin/env node
'use strict';
/**
 * G3b independent fixture executor. ONLY local PostgreSQL kba_* clones.
 * A test-only in-memory module loader can inject an unseen owner mutant.
 * No application source file is changed or persisted.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const http=require('node:http'),https=require('node:https'),Module=require('node:module');
const env=process.env,url=new URL(env.DATABASE_URL||'');
const mode=process.argv[2],seed=process.argv[3]||'g3b-seed-1';
if(!['NOMINAL','BLIND_MUTANT'].includes(mode)||
 env.NODE_ENV!=='test'||env.KOMERCE_DISABLE_CRONS!=='true'||
 !['localhost','127.0.0.1','::1'].includes(url.hostname)||
 !/^\/kba_[a-f0-9]{18}$/.test(url.pathname))
 throw Error('V37_TOOL_ERROR: local disposable PostgreSQL required');
for(const m of [http,https]){
 m.request=()=>{throw Error('V37_NO_NETWORK')};
 m.get=()=>{throw Error('V37_NO_NETWORK')};
}
global.fetch=()=>{throw Error('V37_NO_NETWORK')};
const ROOT=path.resolve(__dirname,'../..');
const target=path.join(ROOT,'services/order-status-machine.js');
if(mode==='BLIND_MUTANT'){
 const original=Module._extensions['.js'];
 let injected=false;
 Module._extensions['.js']=function(module,filename){
  if(filename!==target)return original(module,filename);
  const src=fs.readFileSync(filename,'utf8');
  const needle="if (!allowedRoles.includes(actor.role)) {";
  if(src.split(needle).length!==2)throw Error('V37_TOOL_ERROR: owner mutant anchor drifted');
  injected=true;
  // Deliberately injected faulty implementation, unknown to the case generator.
  const wrong="if (!allowedRoles.includes(actor.role) && actor.role !== 'agent_relais') {";
  module._compile(src.replace(needle,wrong),filename);
 };
 const {transitionOrderStatus}=require(target);
 Module._extensions['.js']=original;
 if(!injected)throw Error('V37_TOOL_ERROR: mutant was not applied');
 global.__v37_transition=transitionOrderStatus;
}else{
 global.__v37_transition=require(target).transitionOrderStatus;
}
const db=require('../../db');
const {Pool}=require('pg');
const {generate}=require('./v37-order-matrix-generator');
const pool=new Pool({connectionString:env.DATABASE_URL,max:2,connectionTimeoutMillis:5000});
const uuid=()=>crypto.randomUUID();
async function main(){
 let c;
 try{
  const plan=generate(seed);
  c=await pool.connect();
  await c.query('BEGIN');
  const {rows:[km]}=await c.query("SELECT id FROM markets WHERE code='KM'");
  if(!km)throw Error('V37_TOOL_ERROR: canonical KM missing');
  const relay=uuid();
  await c.query("INSERT INTO relais(id,name,phone,address,market_id) VALUES($1,'V37 test relay','+269000','TEST',$2)",[relay,km.id]);
  const observations=[];
  for(const [i,x] of plan.cases.entries()){
   const id=uuid();
   await c.query("INSERT INTO orders(id,reference,relais_id,market_id,total_kmf,payment_mode,status) VALUES($1,$2,$3,$4,1000,'stripe_eur','confirmed')",
    [id,'G37-'+i+'-'+uuid().slice(0,8),relay,km.id]);
   const {rows:[before]}=await c.query('SELECT status FROM orders WHERE id=$1',[id]);
   const {rows:[hc]}=await c.query('SELECT count(*)::int AS n FROM order_status_history WHERE order_id=$1',[id]);
   // Real owner; no test-level expected result or mutation ID supplied to it.
   const result=await global.__v37_transition({
    orderId:id,newStatus:x.target,source:'patch',
    actor:{id:null,role:x.role},dbClient:c
   });
   const {rows:[after]}=await c.query("SELECT status,ordered_at IS NOT NULL AS ordered_at_present FROM orders WHERE id=$1",[id]);
   const {rows:history}=await c.query('SELECT status FROM order_status_history WHERE order_id=$1 ORDER BY created_at,id',[id]);
   observations.push({id:x.id,sourceStatus:x.sourceStatus,target:x.target,role:x.role,
    initialStatus:before.status,initialHistory:hc.n,
    finalStatus:after.status,finalHistory:history.length,
    finalHistoryStatus:history.length===1?history[0].status:null,
    orderedTimestampPresent:after.ordered_at_present,
    ownerSuccess:result?.success===true});
  }
  await c.query('ROLLBACK');
  console.log('BUSINESS_AUDIT_V37_OBSERVATION '+JSON.stringify({
   contract:'komerce-generated-order-physical/v37',mode,seed,
   planHash:plan.selectionHash,policyHash:plan.policyHash,
   ownerExecuted:true,canonicalPg:true,
   mutationSource:'IN_MEMORY_MODULE_TEST_ONLY',
   sourceFileChanged:false,
   noExternalNetwork:true,noProductionTouch:true,
   observations
  }));
 }finally{
  if(c){await c.query('ROLLBACK').catch(()=>{});c.release()}
  await Promise.allSettled([pool.end(),db.pool?.end?.()]);
 }
}
main().catch(e=>{console.error('V37_GENERATED_CHILD_TOOL_ERROR '+(e.stack||e.message));process.exitCode=2});
