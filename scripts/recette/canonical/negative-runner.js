/** @komerce-arch-lite
 * @role g6-negative-runner
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose Orchestration des scénarios négatifs N07/N09/N04/N33 : Golden joué jusqu'au point d'arrêt, geste négatif par l'écran, oracle PG en lecture seule.
 * @db-read voir negative-scenarios.js
 * @db-write none
 * @impact-areas staging-only
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const N=require('./negative-scenarios');
const {bootstrapFreshScenario}=require('./fresh-buyer-bootstrap');
const {assertNoHubOrTransport}=require('./local-stock-oracles');
const {marketProfile}=require('./market-profile');
const ROOT=path.resolve(__dirname,'../../..');
const BUYER_REPORT='test-results/g6-p2-buyer-order/report.json';
const N09_SCRIPT='scripts/recette/g6-negative-n09-remise-chromium.js';
const N09_REPORT='test-results/g6-negative-n09/report.json';
const readJson=rel=>JSON.parse(fs.readFileSync(path.join(ROOT,rel),'utf8'));
function evidence(stageId,scenario,market,body){
 const rec={schema:'komerce-g6-negative-oracle/1',scenario_id:scenario,market,stage_id:stageId,oracle_verdict:'PASS',...body,
  external_supplier_calls:0,external_payment_executed:false,production_permitted:false,db_write:false};
 const text=JSON.stringify(rec,null,2)+'\n';
 rec.evidence_sha256=crypto.createHash('sha256').update(text).digest('hex');
 const dest=path.join(ROOT,'test-results/g6-negative',scenario+'_'+stageId+'.json');
 fs.mkdirSync(path.dirname(dest),{recursive:true});
 fs.writeFileSync(dest,JSON.stringify(rec,null,2)+'\n');
 return {stage_id:stageId,evidence_sha256:rec.evidence_sha256};
}
function spawnChild(script,env){
 const r=spawnSync(process.execPath,[path.join(ROOT,script)],{cwd:ROOT,env,stdio:'inherit',timeout:12*60*1000});
 let detail='';try{const c=readJson(N09_REPORT);detail=' | child_error='+String(c.error||c.verdict||'').slice(0,600)}catch(_){}
 if(r.error||r.status!==0)throw Error('G6_DYNAMIC_CHROMIUM_STAGE_FAILED_'+script+' status='+r.status+detail);
}
async function runNegativeScenario({scenario,env,db,adapters}){
 if(!N.isNegative(scenario))throw Error('G6_NEGATIVE_UNSUPPORTED_'+scenario);
 const market=marketProfile(env).code,out={scenario,stages:[]};
 if(scenario==='N04'){
  const runtime=await adapters.attestRuntimeBeforeBuyer();
  const product=await adapters.resolveLocalStockProduct({runtime});
  fs.rmSync(path.join(ROOT,BUYER_REPORT),{force:true});
  const gesture=await adapters.executeBuyerChromium({runtime,product});
  if(gesture.verdict!=='G6_N04_QTY_OVER_STOCK_REFUSED_CHROMIUM_PG_PASS'||!gesture.n04?.refusal_point||gesture.order)
   throw Error('G6_N04_SCREEN_MISSING_REFUSAL_NOT_PROVEN');
  out.stages.push({stage_id:'N04_QTY_OVER_STOCK',refusal_point:gesture.n04.refusal_point,refusal_visible:gesture.n04.refusal_visible});
  const o=await N.oracleN04(db,{buyerId:gesture.buyer_id,productId:gesture.product_id,market,availableBefore:gesture.n04.available_before});
  out.stages.push(evidence('N04_NO_EFFECT_ORACLE',scenario,market,{oracle:o,gesture:gesture.n04,buyer_id:gesture.buyer_id}));
  out.verdict='G6_N04_QTY_OVER_STOCK_REFUSED_'+gesture.n04.refusal_point+'_CHROMIUM_PG_PASS';
  return out;
 }
 // N07, N09, N33 : le Golden est joué jusqu'à BUYER (commande réellement créée par l'écran), puis geste/oracle négatif.
 const result=await bootstrapFreshScenario({scenario,toStage:'BUYER',adapters});
 const buyer=readJson(BUYER_REPORT);
 out.order_id=result.order_id;out.reference=result.order_reference;
 out.stages.push(...result.stages);
 if(scenario==='N07'){
  out.double_click=buyer.n07||null;
  const o=await N.oracleN07(db,{orderId:result.order_id,buyerId:buyer.buyer_id});
  out.stages.push(evidence('N07_NO_DOUBLE_EFFECT',scenario,market,{oracle:o,gesture:buyer.n07,order_id:result.order_id}));
  out.verdict='G6_N07_DOUBLE_CLICK_ONE_ORDER_CHROMIUM_PG_PASS';
 }else if(scenario==='N33'){
  const variants=(buyer.n33?.sku_ids||[]).map(id=>({sku_id:id}));
  const o=await N.oracleN33(db,{orderId:result.order_id,variants,market});
  out.stages.push(evidence('N33_SKU_ORACLE',scenario,market,{oracle:o,gesture:buyer.n33,order_id:result.order_id}));
  out.verdict='G6_N33_TWO_VARIANTS_ONE_BASKET_CHROMIUM_PG_PASS';
 }else{
  const runtime=await adapters.attestRuntimeBeforeBuyer();
  fs.rmSync(path.join(ROOT,N09_REPORT),{force:true});
  spawnChild(N09_SCRIPT,{...env,G6_DYNAMIC_FRESH_ORDER:'1',G6_CANONICAL_PHASE:'N09_REMISE_REFUSED',
   G6_CANONICAL_ORDER_ID:result.order_id,G6_CANONICAL_ORDER_REFERENCE:result.order_reference,G6_CANONICAL_DB_FINGERPRINT:runtime.db_fingerprint});
  const g=readJson(N09_REPORT);
  if(g.verdict!=='G6_N09_REMISE_REFUSED_CHROMIUM_PASS'||!g.refusal_point||g.order_id!==result.order_id)
   throw Error('G6_N09_SCREEN_MISSING_REFUSAL_NOT_PROVEN');
  out.stages.push({stage_id:'N09_REMISE_REFUSED',refusal_point:g.refusal_point,refusal_visible:g.refusal_visible,client_code_offered:g.client_code_offered});
  const o=await N.oracleN09(db,{orderId:result.order_id,assertNoHubOrTransport});
  out.stages.push(evidence('N09_NOT_COLLECTED_ORACLE',scenario,market,{oracle:o,gesture:{refusal_point:g.refusal_point,refusal_visible:g.refusal_visible},order_id:result.order_id}));
  out.verdict='G6_N09_REMISE_REFUSED_'+g.refusal_point+'_PG_NOT_COLLECTED_PASS';
 }
 return out;
}
module.exports={runNegativeScenario};
