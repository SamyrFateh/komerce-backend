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
const fs=require('node:fs'),path=require('node:path');
const {bootstrapFreshM01}=require('./canonical/fresh-buyer-bootstrap');
const {createRealBuyerCashAdapters}=require('./canonical/real-buyer-cash-adapters');
const db=require('../../db');
const ROOT=path.resolve(__dirname,'../..');
const OUT=path.join(ROOT,'test-results/g6-dynamic-buyer-cash/report.json');
async function main({env=process.env}={}){
 fs.mkdirSync(path.dirname(OUT),{recursive:true});
 const state={schema:'komerce-g6-dynamic-buyer-cash/1',scenario_id:'M01',market:'KM',
  verdict:'NOT_PROVEN',full_chain_certified:false,production_permitted:false,stages:[]};
 const save=()=>fs.writeFileSync(OUT,JSON.stringify(state,null,2)+'\n');
 save();
 try{
  if(env.GITHUB_EVENT_NAME!=='issues'||env.GITHUB_ACTOR!==env.GITHUB_REPOSITORY_OWNER||
   env.GITHUB_REPOSITORY!=='SamyrFateh/komerce-backend'||env.KOMERCE_ENV!=='staging')
   throw Error('G6_DYNAMIC_OWNER_STAGING_GUARD');
  const adapters=createRealBuyerCashAdapters({db,env});
  const toStage=env.G6_DYNAMIC_TO_STAGE||'RELAY_CASH';
  if(!['RELAY_CASH','HUB_PO','HUB_COMMITMENT','HUB_VENDOR_READINESS','HUB_VENDOR_SIMULATION','HUB_RECEIVING','HUB_RECEIVING_READBACK','HUB_CUSTOMER_BAG','HUB_KOM_BOX'].includes(toStage))
   throw Error('G6_DYNAMIC_UNMIGRATED_TO_STAGE');
  const result=await bootstrapFreshM01({toStage,adapters});
  state.order_id=result.order_id;state.reference=result.order_reference;
  state.stages=result.stages;state.chain_sha256=result.chain_sha256;
  state.next_stage={
   RELAY_CASH:'HUB_PO',HUB_PO:'HUB_COMMITMENT',
   HUB_COMMITMENT:'HUB_VENDOR_READINESS',
   HUB_VENDOR_READINESS:'HUB_VENDOR_SIMULATION',
   HUB_VENDOR_SIMULATION:'HUB_RECEIVING',
   HUB_RECEIVING:'HUB_RECEIVING_READBACK',
   HUB_RECEIVING_READBACK:'HUB_CUSTOMER_BAG',
   HUB_CUSTOMER_BAG:'HUB_KOM_BOX',
   HUB_KOM_BOX:'HUB_SHIPMENT'
  }[toStage];
  state.verdict='G6_DYNAMIC_FRESH_'+toStage+'_CHROMIUM_PG_PASS_NOT_FULL_M01';
  save();
  return state;
 }catch(err){
  state.verdict='BLOCKED';state.error=String(err?.message||err).slice(0,350);
  save();throw err;
 }finally{await db.pool.end();}
}
if(require.main===module)main().catch(e=>{console.error('[G6_DYNAMIC] '+e.message);process.exitCode=2});
module.exports={main};
