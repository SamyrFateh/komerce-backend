#!/usr/bin/env node
/** @komerce-arch-lite
 * @role g6-dynamic-buyer-cash-entrypoint
 * @domain orders
 * @layer script
 * @owner backend-core
 * @purpose Owner-only fresh M01/M02 staging replay up to real relay cash, never claim full M01.
 * @impact-areas staging-only
 */
'use strict';
const {marketProfile}=require('./canonical/market-profile');
const fs=require('node:fs'),path=require('node:path');
const {SCENARIO_STAGE_IDS,scenarioProfile,nextStageId}=require('./canonical/stage-registry');
const {bootstrapFreshScenario}=require('./canonical/fresh-buyer-bootstrap');
const {createRealBuyerCashAdapters}=require('./canonical/real-buyer-cash-adapters');
const db=require('../../db');
const ROOT=path.resolve(__dirname,'../..');
const OUT=path.join(ROOT,'test-results/g6-dynamic-buyer-cash/report.json');
async function main({env=process.env}={}){
 fs.mkdirSync(path.dirname(OUT),{recursive:true});
 const state={schema:'komerce-g6-dynamic-buyer-cash/1',scenario_id:String(env.G6_CANONICAL_SCENARIO||'M01'),market:marketProfile(env).code,
  verdict:'NOT_PROVEN',full_chain_certified:false,production_permitted:false,stages:[]};
 const save=()=>fs.writeFileSync(OUT,JSON.stringify(state,null,2)+'\n');
 save();
 try{
  marketProfile(env);
  const scenario=scenarioProfile(env.G6_CANONICAL_SCENARIO);
  if(env.GITHUB_EVENT_NAME!=='issues'||env.GITHUB_ACTOR!==env.GITHUB_REPOSITORY_OWNER||
   env.GITHUB_REPOSITORY!=='SamyrFateh/komerce-backend'||env.KOMERCE_ENV!=='staging')
   throw Error('G6_DYNAMIC_OWNER_STAGING_GUARD');
  const adapters=createRealBuyerCashAdapters({db,env});
  const toStage=env.G6_DYNAMIC_TO_STAGE||'RELAY_CASH';
  if(!SCENARIO_STAGE_IDS[scenario].filter(x=>x!=='BUYER').includes(toStage))
   throw Error('G6_DYNAMIC_UNMIGRATED_TO_STAGE');
  const result=await bootstrapFreshScenario({scenario,toStage,adapters});
  state.order_id=result.order_id;state.reference=result.order_reference;
  state.stages=result.stages;state.chain_sha256=result.chain_sha256;
  const ids=SCENARIO_STAGE_IDS[scenario];
  state.next_stage=(scenario==='M01'?nextStageId(toStage):ids[ids.indexOf(toStage)+1])||'COMPLETED_'+scenario;
  state.verdict='G6_DYNAMIC_FRESH_'+toStage+'_CHROMIUM_PG_PASS_NOT_FULL_'+scenario;
  save();
  return state;
 }catch(err){
  state.verdict='BLOCKED';state.error=require("./canonical/observability").fullError(err);
  // M03 : un écran ou un produit manquant est un verdict explicite, jamais un contournement.
  const msg=String(err&&err.message||'');
  const gap=/G6_M03_(SCREEN_MISSING|PRODUCT_GAP)/.exec(msg)||(/G6_M03_ORDER_COLLECTED_BEFORE_IMPORT_DELIVERY/.test(msg)?[null,'PRODUCT_GAP']:null);
  if(state.scenario_id==='M03'&&gap){state.verdict=gap[1];state.detail=msg.slice(0,600)}
  try{const b=JSON.parse(fs.readFileSync(path.join(ROOT,'test-results/g6-p2-buyer-order/report.json'),'utf8'));state.reference=state.reference||b.order?.reference||null}catch(_){}
  save();throw err;
 }finally{await db.pool.end();}
}
if(require.main===module)main().catch(e=>{console.error('[G6_DYNAMIC] '+e.message);process.exitCode=2});
module.exports={main};
