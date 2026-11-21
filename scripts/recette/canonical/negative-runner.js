/** @komerce-arch-lite
 * @role g6-negative-runner
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose Orchestration des scénarios négatifs N07/N09/N04/N33/N23/N24 : Golden joué jusqu'au point d'arrêt, geste négatif par l'écran, oracle PG en lecture seule.
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
const N2324_SCRIPT='scripts/recette/g6-negative-n23-n24-chromium.js';
const N2324_REPORT='test-results/g6-negative-n23-n24/report.json';
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
function spawnChild(script,env,reportRel=N09_REPORT){
 const r=spawnSync(process.execPath,[path.join(ROOT,script)],{cwd:ROOT,env,stdio:'inherit',timeout:12*60*1000});
 let detail='';try{const c=readJson(reportRel);detail=' | child_error='+String(c.error||c.verdict||'').slice(0,600)}catch(_){}
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
 // N23, N24 (G6-G4B) : parcours M02 jusqu'à « disponible », puis tentatives de retrait ou remises simultanées, oracle PG.
 if(scenario==='N23'||scenario==='N24'){
  const result=await bootstrapFreshScenario({scenario,toStage:'LOCAL_RELAY_AVAILABLE',adapters});
  out.order_id=result.order_id;out.reference=result.order_reference;out.stages.push(...result.stages);
  const runtime=await adapters.attestRuntimeBeforeBuyer(),phase=scenario==='N23'?'N23_WITHDRAWAL_ATTEMPTS':'N24_PARALLEL_HANDOFF';
  fs.rmSync(path.join(ROOT,N2324_REPORT),{force:true});
  try{
   spawnChild(N2324_SCRIPT,{...env,G6_DYNAMIC_FRESH_ORDER:'1',G6_CANONICAL_PHASE:phase,
    G6_CANONICAL_ORDER_ID:result.order_id,G6_CANONICAL_ORDER_REFERENCE:result.order_reference,G6_CANONICAL_DB_FINGERPRINT:runtime.db_fingerprint},N2324_REPORT);
  }catch(e){
   // Verdict : défaut produit ou écran manquant relevé par le script ; sinon l'erreur d'origine.
   let child=null;try{child=readJson(N2324_REPORT)}catch(_){}
   const m=/G6_N2[34]_(SCREEN_MISSING|PRODUCT_GAP)[A-Z0-9_]*/.exec(String(child?.error||''));
   throw Error(m?m[0]:e.message);
  }
  const g=readJson(N2324_REPORT);
  if(!/_CHROMIUM_PASS$/.test(String(g.verdict))||g.order_id!==result.order_id)throw Error('G6_'+scenario+'_SCREEN_MISSING_NOT_PROVEN');
  out.stages.push({stage_id:phase,steps_reached:g.steps_reached,page_events:g.page_events,attempts:g.attempts,tabs:g.tabs||null,ux_signal:g.ux_signal||null,
   legit_handoff_after_lock:g.legit_handoff_after_lock||null});
  const o=scenario==='N23'
   ?await N.oracleN23(db,{orderId:result.order_id,agentId:g.agent_id,minFailures:5,assertNoHubOrTransport})
   :await N.oracleN24(db,{orderId:result.order_id,assertNoHubOrTransport});
  const sid=scenario==='N23'?'N23_SECURITY_ORACLE':'N24_SINGLE_HANDOFF_ORACLE';
  out.stages.push(evidence(sid,scenario,market,{oracle:o,order_id:result.order_id,http:g.tabs||g.attempts.map(a=>({kind:a.kind,http:a.http,ui_blocked:a.ui_blocked,message_visible:a.message_visible}))}));
  out.verdict=scenario==='N23'?'G6_N23_WITHDRAWAL_REFUSED_SECURITY_COUNTER_PG_PASS':'G6_N24_PARALLEL_HANDOFF_SINGLE_ATTESTATION_PG_PASS';
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
  out.stages.push(evidence('N09_NOT_COLLECTED_ORACLE',scenario,market,{oracle:o,gesture:{refusal_point:g.refusal_point,refusal_visible:g.refusal_visible,typed_kind:g.typed_kind||null,remises_input_absent:!!g.remises_input_absent,remises_counter_visible:g.remises_counter_visible},order_id:result.order_id}));
  out.verdict='G6_N09_REMISE_REFUSED_'+g.refusal_point+'_PG_NOT_COLLECTED_PASS';
 }
 return out;
}
module.exports={runNegativeScenario};
