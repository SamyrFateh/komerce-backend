#!/usr/bin/env node
/** @komerce-arch-lite
 * @role g6-dynamic-buyer-cash-entrypoint
 * @domain orders
 * @layer script
 * @owner backend-core
 * @purpose Owner-only fresh M01 staging replay up to real relay cash, never claim full M01.
 * @impact-areas staging-only
 */
'use strict';
const {marketProfile}=require('./canonical/market-profile');
const fs=require('node:fs'),path=require('node:path');
const {STAGE_IDS,nextStageId}=require('./canonical/stage-registry');
const {bootstrapFreshM01}=require('./canonical/fresh-buyer-bootstrap');
const {createRealBuyerCashAdapters}=require('./canonical/real-buyer-cash-adapters');
const db=require('../../db');
const ROOT=path.resolve(__dirname,'../..');
const OUT=path.join(ROOT,'test-results/g6-dynamic-buyer-cash/report.json');
async function main({env=process.env}={}){
 fs.mkdirSync(path.dirname(OUT),{recursive:true});
 const state={schema:'komerce-g6-dynamic-buyer-cash/1',scenario_id:'M01',market:marketProfile(env).code,
  verdict:'NOT_PROVEN',full_chain_certified:false,production_permitted:false,stages:[]};
 const save=()=>fs.writeFileSync(OUT,JSON.stringify(state,null,2)+'\n');
 save();
 try{
  marketProfile(env);
  if(env.GITHUB_EVENT_NAME!=='issues'||env.GITHUB_ACTOR!==env.GITHUB_REPOSITORY_OWNER||
   env.GITHUB_REPOSITORY!=='SamyrFateh/komerce-backend'||env.KOMERCE_ENV!=='staging')
   throw Error('G6_DYNAMIC_OWNER_STAGING_GUARD');
  const adapters=createRealBuyerCashAdapters({db,env});
  const toStage=env.G6_DYNAMIC_TO_STAGE||'RELAY_CASH';
  if(!STAGE_IDS.filter(x=>x!=='BUYER').includes(toStage))
   throw Error('G6_DYNAMIC_UNMIGRATED_TO_STAGE');
  const result=await bootstrapFreshM01({toStage,adapters});
  state.order_id=result.order_id;state.reference=result.order_reference;
  state.stages=result.stages;state.chain_sha256=result.chain_sha256;
  state.next_stage=nextStageId(toStage)||'COMPLETED_M01';
  state.verdict='G6_DYNAMIC_FRESH_'+toStage+'_CHROMIUM_PG_PASS_NOT_FULL_M01';
  save();
  return state;
 }catch(err){
  state.verdict='BLOCKED';state.error=require("./canonical/observability").fullError(err);
  save();throw err;
 }finally{await db.pool.end();}
}
if(require.main===module)main().catch(e=>{console.error('[G6_DYNAMIC] '+e.message);process.exitCode=2});
module.exports={main};
