#!/usr/bin/env node
'use strict';
/** V3.1 two canonical owner exercises, ONE disposable local PG clone each.
 * FX reads canonical parities. MARKET changes lifecycle only on the clone.
 * No PSP, HTTP, authenticated route or staging access.
 */
const {randomUUID}=require('node:crypto');
const http=require('node:http'),https=require('node:https');
const env=process.env,mode=process.argv[2],url=new URL(env.DATABASE_URL||'');
if(!['FX','MARKET'].includes(mode)||env.NODE_ENV!=='test'||
 env.KOMERCE_DISABLE_CRONS!=='true'||
 !['localhost','127.0.0.1','::1'].includes(url.hostname)||
 !/^\/kba_[a-f0-9]{18}$/.test(url.pathname))
 throw Error('V31_TOOL_ERROR: only test local disposable PG clones');
for(const m of [http,https]){
 m.request=()=>{throw Error('V31_NETWORK_FORBIDDEN')};
 m.get=()=>{throw Error('V31_NETWORK_FORBIDDEN')};
}
global.fetch=()=>{throw Error('V31_NETWORK_FORBIDDEN')};
const {Pool}=require('pg');
const pool=new Pool({connectionString:env.DATABASE_URL,max:2,connectionTimeoutMillis:5000});
const {convert}=require('../../services/fx-authority');
const {assertMarketOperationAllowed}=require('../../services/market-operation-guard');
async function fx(){
 const {rows:rates}=await pool.query(
  "SELECT currency,eur_rate::text AS rate FROM currency_parities WHERE currency IN ('KMF','XAF') ORDER BY currency");
 if(rates.length!==2||rates.some(x=>!(Number(x.rate)>0)))throw Error('V31_TOOL_ERROR: both fixed currency parities required');
 const calls=[
  {amount:'100',from:'EUR',to:'KMF'},
  {amount:'100',from:'EUR',to:'XAF'},
  {amount:'491.96775',from:'KMF',to:'XAF'}
 ];
 const outcomes=[];
 for(const input of calls){
  const result=await convert({...input,client:pool});
  outcomes.push({input,result});
 }
 return {rates,outcomes,mode:'FX'};
}
async function market(){
 const {rows:[m]}=await pool.query("SELECT id,code FROM markets WHERE code='KM'");
 if(!m)throw Error('V31_TOOL_ERROR: canonical KM market missing');
 const observations=[];
 for(const status of ['ACTIVE','SUSPENDED','PROVISIONING']){
  await pool.query("UPDATE markets SET lifecycle_status=$2,is_active=($2 IN ('ACTIVE','SUSPENDED')) WHERE id=$1",[m.id,status]);
  const {rows:[before]}=await pool.query("SELECT lifecycle_status,is_active FROM markets WHERE id=$1",[m.id]);
  for(const [operation,opts] of [
   ['local_price_activate',{}],
   ['local_price_draft',{}],
   ['catalog_exposure_enable',{}],
   ['customs_shipment_create',{carriesOnlyExistingOrders:true}],
   ['customs_shipment_create',{carriesOnlyExistingOrders:false}]
  ]){
   let outcome;
   try{
    const answer=await assertMarketOperationAllowed(pool,m.id,operation,opts);
    outcome={allowed:true,error:null,returnedMarket:answer?.id===m.id?answer.code:null};
   }catch(e){
    outcome={allowed:false,error:{code:e.code||null,status:e.status||null}};
   }
   const {rows:[after]}=await pool.query("SELECT lifecycle_status,is_active FROM markets WHERE id=$1",[m.id]);
   observations.push({status,operation,existingOrders:opts.carriesOnlyExistingOrders??null,
    before,after,outcome});
  }
 }
 return {mode:'MARKET',marketId:m.id,marketCode:m.code,observations};
}
async function main(){
 try{
  const evidence=mode==='FX'?await fx():await market();
  console.log('BUSINESS_AUDIT_V31_PHYSICAL '+JSON.stringify({
   contract:'komerce-fx-market-owner-physical/v31',...evidence,
   ownerExecuted:true,canonicalPg:true,authMiddlewareExecuted:false,
   noProductionAccess:true,noExternalNetwork:true,
   testNonce:randomUUID(),
   v45MutationApplied:env.KBA_V45_MUTANT_APPLIED==='YES'}));
 }finally{await pool.end()}
}
main().catch(e=>{console.error('BUSINESS_AUDIT_V31_CHILD_TOOL_ERROR '+(e.stack||e.message));process.exitCode=2});
