/** @komerce-arch-lite
 * @role g6-negative-runner
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose Orchestration des scénarios négatifs N07/N09/N04/N33/N23/N24/N21/N22/N20/N29 N11 à N16 (G6-G4C, Achats et Hub) et N17 à N19 (G6-G5B, Transport et douane) : Golden joué jusqu'au point d'arrêt, geste négatif par l'écran, oracle PG en lecture seule.
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
const N2122_SCRIPT='scripts/recette/g6-negative-n21-n22-cross-relay-chromium.js';
const N2122_REPORT='test-results/g6-negative-n21-n22/report.json';
const N20_SCRIPT='scripts/recette/g6-negative-n20-relay-discrepancy-chromium.js';
const N20_REPORT='test-results/g6-negative-n20/report.json';
const N29_SCRIPT='scripts/recette/g6-negative-n29-authz-chromium.js';
const N29_REPORT='test-results/g6-negative-n29/report.json';
const N1112_SCRIPT='scripts/recette/g6-negative-n11-n12-chromium.js';
const N1112_REPORT='test-results/g6-negative-n11-n12/report.json';
const N1314_SCRIPT='scripts/recette/g6-negative-n13-n14-chromium.js';
const N1314_REPORT='test-results/g6-negative-n13-n14/report.json';
const N1516_SCRIPT='scripts/recette/g6-negative-n15-n16-chromium.js';
const N1516_REPORT='test-results/g6-negative-n15-n16/report.json';
const N1718_SCRIPT='scripts/recette/g6-negative-n17-n18-chromium.js';
const N1718_REPORT='test-results/g6-negative-n17-n18/report.json';
const N19_SCRIPT='scripts/recette/g6-negative-n19-chromium.js';
const N19_REPORT='test-results/g6-negative-n19/report.json';
const LOCAL_NEG={
 N17:{script:N1718_SCRIPT,report:N1718_REPORT,phase:'N17_FORWARDER_ROLE_MARKET_ATTEMPTS',oracle:'N17_NO_TRANSITION_ORACLE',to:'HUB_SHIPMENT',ship:true},
 N18:{script:N1718_SCRIPT,report:N1718_REPORT,phase:'N18_CUSTOMS_HOLD_ATTEMPTS',oracle:'N18_HOLD_RELEASE_ORACLE',to:'FORWARDER',ship:true},
 N19:{script:N19_SCRIPT,report:N19_REPORT,phase:'N19_LOCAL_TRANSPORT_DELAY_LOSS',oracle:'N19_LOSS_INCIDENT_ORACLE',to:'CUSTOMS'},
 N15:{script:N1516_SCRIPT,report:N1516_REPORT,phase:'N15_BAG_BOX_INCOMPLETE',oracle:'N15_NO_CLOSURE_ORACLE',to:'HUB_RECEIVING_READBACK'},
 N16:{script:N1516_SCRIPT,report:N1516_REPORT,phase:'N16_BOX_NOT_DISPATCHED_FROZEN',oracle:'N16_BOX_FROZEN_ORACLE',to:'HUB_KOM_BOX'},
 N13:{script:N1314_SCRIPT,report:N1314_REPORT,phase:'N13_SUPPLIER_BACKORDER',oracle:'N13_BACKORDER_ORACLE',to:'HUB_VENDOR_READINESS',po:true},
 N14:{script:N1314_SCRIPT,report:N1314_REPORT,phase:'N14_RECEIVING_QTY_ATTEMPTS',oracle:'N14_RECEIVING_ORACLE',to:'HUB_VENDOR_SIMULATION',po:true},
 N11:{script:N1112_SCRIPT,report:N1112_REPORT,phase:'N11_PO_NO_COMMITMENT_ATTEMPT',oracle:'N11_NO_ENGAGEMENT_ORACLE',to:'HUB_PO',po:true},
 N12:{script:N1112_SCRIPT,report:N1112_REPORT,phase:'N12_PAYMENT_SINGLE_VALIDATOR',oracle:'N12_NO_PAYMENT_ORACLE',to:'HUB_VENDOR_SIMULATION',po:true},
 N20:{script:N20_SCRIPT,report:N20_REPORT,phase:'N20_RELAY_DISCREPANCY',oracle:'N20_DISCREPANCY_ORACLE',to:'CUSTOMS'},
 N29:{script:N29_SCRIPT,report:N29_REPORT,phase:'N29_SESSION_ROLE_ATTEMPTS',oracle:'N29_NO_MUTATION_ORACLE'},
 N23:{script:N2324_SCRIPT,report:N2324_REPORT,phase:'N23_WITHDRAWAL_ATTEMPTS',oracle:'N23_SECURITY_ORACLE'},
 N24:{script:N2324_SCRIPT,report:N2324_REPORT,phase:'N24_PARALLEL_HANDOFF',oracle:'N24_SINGLE_HANDOFF_ORACLE'},
 N21:{script:N2122_SCRIPT,report:N2122_REPORT,phase:'N21_CROSS_RELAY_ATTEMPTS',oracle:'N21_CROSS_RELAY_ORACLE'},
 N22:{script:N2122_SCRIPT,report:N2122_REPORT,phase:'N22_TWO_RELAYS_ATTEMPTS',oracle:'N22_TWO_RELAYS_ORACLE'}};
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
 if(LOCAL_NEG[scenario]){
  const L=LOCAL_NEG[scenario];
  const result=await bootstrapFreshScenario({scenario,toStage:L.to||'LOCAL_RELAY_AVAILABLE',adapters});
  out.order_id=result.order_id;out.reference=result.order_reference;out.stages.push(...result.stages);
  const runtime=await adapters.attestRuntimeBeforeBuyer(),phase=L.phase;
  // Achats et Hub : PO unique de la commande, relu en PG (lecture seule) et transmis au script enfant.
  const poId=L.po?(await N.importPo(db,result.order_id)).id:null;
  // Transport et douane : expédition de la commande, relue en PG (lecture seule) et transmise au script enfant.
  const ship=L.ship?await N.shipmentForOrder(db,result.order_id):null;
  if(L.ship&&!ship)throw Error('G6_'+scenario+'_SCREEN_MISSING_NO_SHIPMENT_FOR_ORDER');
  fs.rmSync(path.join(ROOT,L.report),{force:true});
  try{
   spawnChild(L.script,{...env,G6_DYNAMIC_FRESH_ORDER:'1',G6_CANONICAL_PHASE:phase,
    G6_CANONICAL_ORDER_ID:result.order_id,G6_CANONICAL_ORDER_REFERENCE:result.order_reference,G6_CANONICAL_DB_FINGERPRINT:runtime.db_fingerprint,
    ...(poId?{G6_CANONICAL_PO_ID:poId}:{}),...(ship?{G6_CANONICAL_SHIPMENT_REF:ship.reference,G6_CANONICAL_SHIPMENT_ID:ship.id}:{})},L.report);
  }catch(e){
   // Verdict : défaut produit ou écran manquant relevé par le script ; sinon l'erreur d'origine.
   let child=null;try{child=readJson(L.report)}catch(_){}
   const m=/(?:G6_N(?:2[0-4]|29|1[1-9])_(?:SCREEN_MISSING|PRODUCT_GAP)|PREREQ_MISSING_SECOND_RELAY|PREREQ_MISSING_OTHER_ACTIVE_MARKET)[A-Za-z0-9_]*/.exec(String(child?.error||''));
   throw Error(m?m[0]:e.message);
  }
  const g=readJson(L.report);
  if(!/_CHROMIUM_PASS$/.test(String(g.verdict))||g.order_id!==result.order_id)throw Error('G6_'+scenario+'_SCREEN_MISSING_NOT_PROVEN');
  out.stages.push({stage_id:phase,steps_reached:g.steps_reached,page_events:g.page_events,attempts:g.attempts||null,tabs:g.tabs||null,intruder:g.intruder||null,control:g.control||null,reverse:g.reverse||null,ux_signal:g.ux_signal||null,
   legit_handoff_after_lock:g.legit_handoff_after_lock||null,screen:g.screen||null,probes:g.probes||null,director:g.director||null});
  const o=scenario==='N23'
   ?await N.oracleN23(db,{orderId:result.order_id,agentId:g.agent_id,minFailures:5,assertNoHubOrTransport})
   :scenario==='N24'?await N.oracleN24(db,{orderId:result.order_id,assertNoHubOrTransport})
   :scenario==='N20'?await N.oracleN20(db,{orderId:result.order_id})
   :scenario==='N17'?await N.oracleN17(db,{orderId:result.order_id,shipmentRef:ship.reference,baseline:g.baseline})
   :scenario==='N18'?await N.oracleN18(db,{orderId:result.order_id,shipmentRef:ship.reference,customsRef:'SIM-STAGING-DOU-N18-'+result.order_reference})
   :scenario==='N19'?await N.oracleN19(db,{orderId:result.order_id})
   :scenario==='N15'?await N.oracleN15(db,{orderId:result.order_id,boxRef:g.box_ref,shipmentRef:g.shipment_ref})
   :scenario==='N16'?await N.oracleN16(db,{orderId:result.order_id,boxRef:g.box_ref,shipmentRef:g.shipment_ref,baseline:g.baseline})
   :scenario==='N13'?await N.oracleN13(db,{orderId:result.order_id,poId,ordered:g.ordered,typed:g.typed})
   :scenario==='N14'?await N.oracleN14(db,{orderId:result.order_id,poId,ordered:g.ordered})
   :scenario==='N11'?await N.oracleN11(db,{orderId:result.order_id,poId})
   :scenario==='N12'?await N.oracleN12(db,{orderId:result.order_id,poId,commitmentProof:g.commitment_proof})
   :await N.oracleCrossRelay(db,{orderId:result.order_id,scenario,assertNoHubOrTransport});
  const sid=L.oracle;
  out.stages.push(evidence(sid,scenario,market,{oracle:o,order_id:result.order_id,http:g.tabs||g.intruder||(g.attempts||[]).map(a=>({kind:a.kind,http:a.http,ui_blocked:a.ui_blocked,message_visible:a.message_visible}))}));
  out.verdict={N23:'G6_N23_WITHDRAWAL_REFUSED_SECURITY_COUNTER_PG_PASS',N24:'G6_N24_PARALLEL_HANDOFF_SINGLE_ATTESTATION_PG_PASS',
   N20:'G6_N20_RELAY_DISCREPANCY_INCIDENT_NO_HANDOFF_PG_PASS',N29:'G6_N29_SESSION_401_ROLE_403_NO_MUTATION_PG_PASS',
   N15:'G6_N15_BAG_BOX_INCOMPLETE_NO_CLOSURE_NO_DEPARTURE_PG_PASS',N16:'G6_N16_BOX_NOT_DISPATCHED_COMPOSITION_FROZEN_PG_PASS',
   N13:'G6_N13_SUPPLIER_BACKORDER_REMNANT_NO_FICTIVE_RECEIPT_PG_PASS',N14:'G6_N14_RECEIVING_EXACT_QUANTITIES_NO_EXCESS_NO_NEGATIVE_PG_PASS',
   N11:'G6_N11_PO_WITHOUT_COMMITMENT_REFUSED_NO_ENGAGEMENT_PG_PASS',N12:'G6_N12_PAYMENT_SINGLE_VALIDATOR_REFUSED_NO_PAYMENT_PG_PASS',
   N17:'G6_N17_FORWARDER_OUT_OF_ROLE_MARKET_REFUSED_NO_TRANSITION_PG_PASS',N18:'G6_N18_CUSTOMS_HOLD_NO_TRANSIT_THEN_RELEASE_PG_PASS',
   N19:'G6_N19_LOCAL_TRANSPORT_DELAY_LOSS_INCIDENT_NO_WITHDRAWAL_PG_PASS',
   N21:'G6_N21_CROSS_RELAY_REFUSED_NO_DISCLOSURE_PG_PASS',N22:'G6_N22_TWO_RELAYS_REFUSED_NO_DISCLOSURE_PG_PASS'}[scenario];
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
