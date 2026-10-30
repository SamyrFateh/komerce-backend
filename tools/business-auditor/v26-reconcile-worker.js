#!/usr/bin/env node
'use strict';
/** Strict research worker: simulated read-only PSP archive, kba_* PG only. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const url=new URL(process.env.DATABASE_URL||'');
const mode=process.argv[2];
const prefix=path.join(os.tmpdir(),'kba_v25_');
const seed=process.env.KBA_V25_SEED_PATH,archive=process.env.KBA_V25_PROVIDER_LOG;
if(!['NORMAL','CRASH_BEFORE_COMMIT','BAD_AMOUNT','BAD_KEY','PROVIDER_UNAVAILABLE'].includes(mode)||
 process.env.NODE_ENV!=='test'||process.env.KOMERCE_DISABLE_CRONS!=='true'||
 process.env.KBA_V24_MUTANT!=='DURABLE_INTENT_COUNTERFACTUAL'||
 !['localhost','127.0.0.1','::1'].includes(url.hostname)||
 !/^\/kba_[a-f0-9]{18}$/.test(url.pathname)||
 !seed||!archive||!path.resolve(seed).startsWith(prefix)||
 !path.resolve(archive).startsWith(prefix))
 throw Error('V26_TOOL_ERROR: invalid clone/fixture environment');
const http=require('node:http'),https=require('node:https');
for(const m of [http,https]){m.request=()=>{throw Error('NO_NETWORK')};m.get=()=>{throw Error('NO_NETWORK')}}
global.fetch=()=>{throw Error('NO_NETWORK')};
const db=require('../../db');
const {reconcile}=require('./v26-reconciler');
function events(){
 if(!fs.existsSync(archive))return [];
 return fs.readFileSync(archive,'utf8').split('\n').filter(Boolean)
  .map(line=>JSON.parse(line));
}
const readProvider=async({key,captureId})=>{
 if(mode==='PROVIDER_UNAVAILABLE')return {status:'UNAVAILABLE'};
 const match=events().filter(e=>e.providerRequestKey===key&&e.captureId===captureId);
 const items=match.map(e=>({...e,status:'COMPLETED'}));
 if(mode==='BAD_AMOUNT'&&items.length)items[0].amountEur=19;
 if(mode==='BAD_KEY'&&items.length)items[0].providerRequestKey='wrong-key';
 return {status:'AVAILABLE',events:items};
};
(async()=>{
 const ids=JSON.parse(fs.readFileSync(seed,'utf8'));
 const result=await reconcile({db,orderId:ids.order,readProvider,
  crashBeforeCommit:mode==='CRASH_BEFORE_COMMIT'});
 console.log('BUSINESS_AUDIT_V26_CHILD '+JSON.stringify({mode,result}));
 await db.pool.end();
})().catch(async e=>{
 console.error('V26_TOOL_ERROR '+(e.stack||e.message));
 await db.pool.end().catch(()=>{});
 process.exitCode=2;
});
