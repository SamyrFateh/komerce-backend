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
const {createRealBuyerCashAdapters}=require('./real-buyer-cash-adapters');
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
const N2832_SCRIPT='scripts/recette/g6-negative-n28-n32-chromium.js';
const N2832_REPORT='test-results/g6-negative-n28-n32/report.json';
const N3738_SCRIPT='scripts/recette/g6-negative-n37-n38-chromium.js';
const N3738_REPORT='test-results/g6-negative-n37-n38/report.json';
const N30_SCRIPT='scripts/recette/g6-negative-n30-chromium.js';
const N30_REPORT='test-results/g6-negative-n30/report.json';
const N39_SCRIPT='scripts/recette/g6-negative-n39-cancel-chromium.js';
const N39_REPORT='test-results/g6-negative-n39/report.json';
const N25_SCRIPT='scripts/recette/g6-negative-n25-sav-chromium.js';
const N25_REPORT='test-results/g6-negative-n25/report.json';
const N40_SCRIPT='scripts/recette/g6-negative-n40-price-gap-chromium.js';
const N40_REPORT='test-results/g6-negative-n40/report.json';
const N26A27_SCRIPT='scripts/recette/g6-negative-n26a-n27-screen-probe-chromium.js';
const N26A27_REPORT='test-results/g6-negative-n26a-n27/report.json';
const N10_SCRIPT='scripts/recette/g6-negative-n10-webhook-chromium.js';
const N10_REPORT='test-results/g6-negative-n10/report.json';
const LOCAL_NEG={
 N30:{script:N30_SCRIPT,report:N30_REPORT,phase:'N30_TRUTH_COMPARE',oracle:'N30_TRUTH_ORACLE'},
 N31:{phase:'N31_FX_SNAPSHOT_ORACLE',oracle:'N31_FX_SNAPSHOT_ORACLE_EVIDENCE'},
 N35:{phase:'N35_ECO_ORACLE',oracle:'N35_ECO_ORACLE_EVIDENCE',to:'CLIENT_PICKUP'},
 N36:{phase:'N36_MANUAL_PROVENANCE_ORACLE',oracle:'N36_MANUAL_ORACLE_EVIDENCE',to:'CLIENT_PICKUP'},
 N37:{script:N3738_SCRIPT,report:N3738_REPORT,phase:'N37_DOCUMENT_ACCESS',oracle:'N37_DOCUMENTS_ORACLE',to:'CLIENT_PICKUP',po:true},
 N38:{script:N3738_SCRIPT,report:N3738_REPORT,phase:'N38_RESUME_DRY_RUN',oracle:'N38_POSTCOMMIT_ORACLE',to:'CLIENT_PICKUP'},
 N28:{script:N2832_SCRIPT,report:N2832_REPORT,phase:'N28_NETWORK_FAILURE_RETRY',oracle:'N28_SINGLE_EFFECT_ORACLE'},
 N32:{script:N2832_SCRIPT,report:N2832_REPORT,phase:'N32_CROSS_MARKET_ROLES',oracle:'N32_NO_MUTATION_ORACLE'},
 N26a:{script:N26A27_SCRIPT,report:N26A27_REPORT,phase:'N26A_LINE_REFUND_SCREEN_PROBE',oracle:'N26A_NO_ORACLE',to:'RELAY_CASH'},
 N27:{script:N26A27_SCRIPT,report:N26A27_REPORT,phase:'N27_REMNANT_CANCEL_SCREEN_PROBE',oracle:'N27_NO_ORACLE',to:'HUB_VENDOR_READINESS'},
 N40:{script:N40_SCRIPT,report:N40_REPORT,phase:'N40_SUPPLIER_PRICE_GAP',oracle:'N40_PRICE_GAP_ORACLE',to:'HUB_VENDOR_READINESS',po:true},
 N25:{script:N25_SCRIPT,report:N25_REPORT,phase:'N25_SAV_DOUBLE_INTAKE',oracle:'N25_SINGLE_INTAKE_ORACLE',to:'LOCAL_CLIENT_PICKUP'},
 N26b:{script:N25_SCRIPT,report:N25_REPORT,phase:'N26B_SAV_COMPENSATION_DECISION',oracle:'N26B_SAV_COMPENSATION_ORACLE',to:'LOCAL_CLIENT_PICKUP'},
 N39F1:{script:N39_SCRIPT,report:N39_REPORT,phase:'N39F1_CLIENT_CANCEL_ATTEMPT',oracle:'N39F1_CANCEL_EFFECTS_ORACLE',to:'RELAY_CASH'},
 N39F2:{script:N39_SCRIPT,report:N39_REPORT,phase:'N39F2_CLIENT_CANCEL_ATTEMPT',oracle:'N39F2_CANCEL_EFFECTS_ORACLE',to:'HUB_COMMITMENT'},
 N39F3:{script:N39_SCRIPT,report:N39_REPORT,phase:'N39F3_CLIENT_CANCEL_ATTEMPT',oracle:'N39F3_CANCEL_EFFECTS_ORACLE',to:'HUB_SHIPMENT'},
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
  let n22Second=null;
  if(scenario==='N22'){
   const {rows:[first]}=await db.query('SELECT relais_id,market_id,user_id FROM orders WHERE id=$1',[result.order_id]);
   if(!first?.relais_id)throw Error('G6_N22_PREREQ_MISSING_ORDER_AT_RELAY_A');
   const {rows:choices}=await db.query(`SELECT r.id FROM relais r
    JOIN markets m ON m.id=r.market_id AND m.code=$1
    WHERE r.is_active=TRUE AND r.id<>$2 ORDER BY r.created_at`,[market,first.relais_id]);
   if(!choices.length)throw Error('G6_N22_PREREQ_MISSING_SECOND_RELAY');
   // Sauvegarder les captures et oracles de A avant la seconde commande : les
   // stages canoniques réutilisent leurs chemins de sortie pour B.
   const paths=['g6-p2-buyer-order','g6-a-relay-cash','g6-local-relay-available'];
   for(const p of paths){
    const src=path.join(ROOT,'test-results',p);
    if(!fs.existsSync(path.join(src,'report.json')))throw Error('G6_N22_PREREQ_MISSING_ORDER_A_STAGE_'+p);
    fs.cpSync(src,path.join(ROOT,'test-results/g6-n22-a',p),{recursive:true});
   }
   const secondEnv={...env,G6_N22_TARGET_RELAY_ID:choices[0].id};
   const bAdapters=createRealBuyerCashAdapters({db,env:secondEnv});
   const second=await bootstrapFreshScenario({scenario,toStage:'LOCAL_RELAY_AVAILABLE',adapters:bAdapters});
   const {rows:[b]}=await db.query(`SELECT o.id,o.reference,o.relais_id,o.user_id,
      o.status::text AS status,o.payment_status::text AS payment_status,
      o.simulation_scope,m.code AS market
      FROM orders o JOIN markets m ON m.id=o.market_id WHERE o.id=$1`,[second.order_id]);
   if(!b||b.id===result.order_id||b.user_id===first.user_id||
      b.relais_id!==choices[0].id||b.market!==market||b.status!=='available'||
      b.payment_status!=='paid'||b.simulation_scope!=='G6-BUYER')
    throw Error('G6_N22_PRODUCT_GAP_FRESH_SECOND_ORDER_NOT_AT_RELAY_B');
   n22Second={id:b.id,reference:b.reference,relay_id:b.relais_id};
   for(const p of paths)fs.cpSync(path.join(ROOT,'test-results',p),
    path.join(ROOT,'test-results/g6-n22-b',p),{recursive:true});
   out.n22_second_order={order_id:b.id,reference:b.reference,market,
    created_by:'CHROMIUM_BUYER_CASH_LOCAL_RELAY_AVAILABLE',stages:second.stages};
  }
  const runtime=await adapters.attestRuntimeBeforeBuyer(),phase=L.phase;
  // Achats et Hub : PO unique de la commande, relu en PG (lecture seule) et transmis au script enfant.
  const poId=L.po?(await N.importPo(db,result.order_id)).id:null;
  // Transport et douane : expédition de la commande, relue en PG (lecture seule) et transmise au script enfant.
  const ship=L.ship?await N.shipmentForOrder(db,result.order_id):null;
  if(L.ship&&!ship)throw Error('G6_'+scenario+'_SCREEN_MISSING_NO_SHIPMENT_FOR_ORDER');
  if(L.script)fs.rmSync(path.join(ROOT,L.report),{force:true});
  if(L.script)try{
   spawnChild(L.script,{...env,G6_DYNAMIC_FRESH_ORDER:'1',G6_CANONICAL_PHASE:phase,
    G6_CANONICAL_ORDER_ID:result.order_id,G6_CANONICAL_ORDER_REFERENCE:result.order_reference,G6_CANONICAL_DB_FINGERPRINT:runtime.db_fingerprint,
    ...(poId?{G6_CANONICAL_PO_ID:poId}:{}),...(ship?{G6_CANONICAL_SHIPMENT_REF:ship.reference,G6_CANONICAL_SHIPMENT_ID:ship.id}:{}),
    ...(n22Second?{G6_N22_REVERSE_ORDER_ID:n22Second.id,G6_N22_REVERSE_ORDER_REFERENCE:n22Second.reference}:{}),
    },L.report);
  }catch(e){
   // Verdict : défaut produit ou écran manquant relevé par le script ; sinon l'erreur d'origine.
   let child=null;try{child=readJson(L.report)}catch(_){}
   const m=/(?:G6_N(?:2[0-9]|3[0-9]|4[0-9]|1[1-9])[A-Za-z0-9]{0,3}_(?:SCREEN_MISSING|PRODUCT_GAP)|PREREQ_MISSING_SECOND_RELAY|PREREQ_MISSING_OTHER_ACTIVE_MARKET|PREREQ_MISSING_FOREIGN_MARKET_ORDER|G6_N22_PREREQ_MISSING_ORDER_AT_RELAY_B|G6_N32_PREREQ_MISSING_RESTRICTED_HUB_DELEGATION_OR_FOREIGN_PO)[A-Za-z0-9_]*/.exec(String(child?.error||''));
   throw Error(m?m[0]:e.message);
  }
  // N35 et N36 : oracles PG seuls sur la chaîne M01 (aucun geste négatif).
  const g=L.script?readJson(L.report):{order_id:result.order_id};
  if(L.script&&(!/_CHROMIUM_PASS$/.test(String(g.verdict))||g.order_id!==result.order_id))throw Error('G6_'+scenario+'_SCREEN_MISSING_NOT_PROVEN');
  out.stages.push({stage_id:phase,steps_reached:g.steps_reached,page_events:g.page_events,attempts:g.attempts||null,tabs:g.tabs||null,intruder:g.intruder||null,control:g.control||null,reverse:g.reverse||null,ux_signal:g.ux_signal||null,
   legit_handoff_after_lock:g.legit_handoff_after_lock||null,after_http500:g.after_http500||null,order360:g.order360||null,commerce:g.commerce||null,after_lost_response:g.after_lost_response||null,access:g.access||null,dry_run:g.dry_run||null,screen:g.screen||null,probes:g.probes||null,director:g.director||null});
  const o=scenario==='N30'?await N.oracleN30(db,{orderId:result.order_id,order360:g.order360,commerce:g.commerce})
   :scenario==='N31'?await N.oracleN31(db,{orderId:result.order_id,market})
   :scenario==='N35'?await N.oracleN35(db,{orderId:result.order_id})
   :scenario==='N36'?await N.oracleN36(db,{orderId:result.order_id})
   :scenario==='N37'?await N.oracleN37(db,{orderId:result.order_id,reference:result.order_reference,poId})
   :scenario==='N38'?await N.oracleN38(db,{orderId:result.order_id,reference:result.order_reference,dryRun:g.dry_run})
   :scenario==='N28'?await N.oracleN28(db,{orderId:result.order_id,committedBeforeRetry:g.committed_before_retry,assertNoHubOrTransport})
   :scenario==='N32'?await N.oracleN32(db,{orderId:result.order_id,snapshot:g.snapshot,assertNoHubOrTransport})
   :scenario==='N23'   ?await N.oracleN23(db,{orderId:result.order_id,agentId:g.agent_id,minFailures:5,assertNoHubOrTransport})
   :scenario==='N24'?await N.oracleN24(db,{orderId:result.order_id,assertNoHubOrTransport})
   :scenario==='N20'?await N.oracleN20(db,{orderId:result.order_id})
   :scenario==='N39F1'?await N.oracleN39F1(db,{orderId:result.order_id,cancel:g.cancel})
   :scenario==='N39F2'?await N.oracleN39F2(db,{orderId:result.order_id,cancel:g.cancel})
   :scenario==='N39F3'?await N.oracleN39F3(db,{orderId:result.order_id,cancel:g.cancel})
   :scenario==='N25'||scenario==='N26b'?await N.oracleN25(db,{orderId:result.order_id,stockBefore:g.stock_before})
   :scenario==='N40'?await N.oracleN40(db,{orderId:result.order_id,poId,confirm:g.confirm,quoted:g.quoted})
   :scenario==='N17'?await N.oracleN17(db,{orderId:result.order_id,shipmentRef:ship.reference,baseline:g.baseline})
   :scenario==='N18'?await N.oracleN18(db,{orderId:result.order_id,shipmentRef:ship.reference,customsRef:'SIM-STAGING-DOU-N18-'+result.order_reference})
   :scenario==='N19'?await N.oracleN19(db,{orderId:result.order_id})
   :scenario==='N15'?await N.oracleN15(db,{orderId:result.order_id,boxRef:g.box_ref,shipmentRef:g.shipment_ref})
   :scenario==='N16'?await N.oracleN16(db,{orderId:result.order_id,boxRef:g.box_ref,shipmentRef:g.shipment_ref,baseline:g.baseline})
   :scenario==='N13'?await N.oracleN13(db,{orderId:result.order_id,poId,ordered:g.ordered,typed:g.typed})
   :scenario==='N14'?await N.oracleN14(db,{orderId:result.order_id,poId,ordered:g.ordered})
   :scenario==='N11'?await N.oracleN11(db,{orderId:result.order_id,poId})
   :scenario==='N12'?await N.oracleN12(db,{orderId:result.order_id,poId,commitmentProof:g.commitment_proof})
   :scenario==='N22'?{
      a:await N.oracleCrossRelay(db,{orderId:result.order_id,scenario,assertNoHubOrTransport}),
      b:await N.oracleCrossRelay(db,{orderId:n22Second.id,scenario,assertNoHubOrTransport})
    }
   :await N.oracleCrossRelay(db,{orderId:result.order_id,scenario,assertNoHubOrTransport});
  const sid=L.oracle;
  out.stages.push(evidence(sid,scenario,market,{oracle:o,order_id:result.order_id,http:g.tabs||g.intruder||(g.attempts||[]).map(a=>({kind:a.kind,http:a.http,ui_blocked:a.ui_blocked,message_visible:a.message_visible}))}));
  out.verdict={N23:'G6_N23_WITHDRAWAL_REFUSED_SECURITY_COUNTER_PG_PASS',N24:'G6_N24_PARALLEL_HANDOFF_SINGLE_ATTESTATION_PG_PASS',
   N20:'G6_N20_RELAY_DISCREPANCY_INCIDENT_NO_HANDOFF_PG_PASS',N29:'G6_N29_SESSION_401_ROLE_403_NO_MUTATION_PG_PASS',
   N15:'G6_N15_BAG_BOX_INCOMPLETE_NO_CLOSURE_NO_DEPARTURE_PG_PASS',N16:'G6_N16_BOX_NOT_DISPATCHED_COMPOSITION_FROZEN_PG_PASS',
   N13:'G6_N13_SUPPLIER_BACKORDER_REMNANT_NO_FICTIVE_RECEIPT_PG_PASS',N14:'G6_N14_RECEIVING_EXACT_QUANTITIES_NO_EXCESS_NO_NEGATIVE_PG_PASS',
   N11:'G6_N11_PO_WITHOUT_COMMITMENT_REFUSED_NO_ENGAGEMENT_PG_PASS',N12:'G6_N12_PAYMENT_SINGLE_VALIDATOR_REFUSED_NO_PAYMENT_PG_PASS',
   N17:'G6_N17_FORWARDER_OUT_OF_ROLE_MARKET_REFUSED_NO_TRANSITION_PG_PASS',N18:'G6_N18_CUSTOMS_HOLD_NO_TRANSIT_THEN_RELEASE_PG_PASS',
   N39F1:'G6_N39F1_CANCEL_BEFORE_PURCHASE_WALLET_100_PCT_PG_PASS',N39F2:'G6_N39F2_CANCEL_AFTER_COMMITMENT_NO_SILENT_REFUND_PG_PASS',
   N39F3:'G6_N39F3_CANCEL_WHEN_SHIPPED_CLOSED_NO_REFUND_PG_PASS',
   N25:'G6_N25_SAV_SINGLE_PHYSICAL_INTAKE_DOUBLE_REFUSED_PG_PASS',N26b:'G6_N26B_SAV_COMPENSATION_DECISION_PG_PASS',
   N40:'G6_N40_SUPPLIER_PRICE_GAP_SEPARATE_VALIDATION_NO_SILENT_PAYMENT_PG_PASS',
   N19:'G6_N19_LOCAL_TRANSPORT_DELAY_LOSS_INCIDENT_NO_WITHDRAWAL_PG_PASS',
   N30:'G6_N30_ORDER_360_AND_COMMERCE_KPI_MATCH_PG_FIXTURES_EXCLUDED_PG_PASS',N31:'G6_N31_FX_DISPLAY_SNAPSHOT_KEPT_FIXED_PARITY_PG_PASS',
   N35:'G6_N35_ECO_FREIGHT_ONCE_CAUSAL_ALLOCATIONS_DIAGNOSTICS_PG_PASS',N36:'G6_N36_MANUAL_PROVENANCE_EVERY_GESTURE_PG_PASS',
   N37:'G6_N37_DOCUMENTS_ONCE_ACCESS_OWNER_ONLY_NO_REAL_SEND_PG_PASS',N38:'G6_N38_EVENT_KEPT_DOCUMENTS_ONCE_RESUME_DRY_RUN_NO_BLIND_SPOT_PG_PASS',
   N28:'G6_N28_NETWORK_FAILURE_RETRY_SINGLE_EFFECT_PG_PASS',N32:'G6_N32_CROSS_MARKET_ROLES_REFUSED_NO_MUTATION_PG_PASS',
   N21:'G6_N21_CROSS_RELAY_REFUSED_NO_DISCLOSURE_PG_PASS',N22:'G6_N22_TWO_RELAYS_REFUSED_NO_DISCLOSURE_PG_PASS'}[scenario];
  return out;
 }
 // N10 (G6-G5A) : commande créée par l'écran (BUYER), puis webhooks PSP simulés non signés/dupliqués par sondes API (Chromium NOT_APPLICABLE), oracle PG avant/après.
 if(scenario==='N10'){
  const result=await bootstrapFreshScenario({scenario,toStage:'BUYER',adapters});
  out.order_id=result.order_id;out.reference=result.order_reference;out.stages.push(...result.stages);
  const runtime=await adapters.attestRuntimeBeforeBuyer();
  fs.rmSync(path.join(ROOT,N10_REPORT),{force:true});
  try{
   spawnChild(N10_SCRIPT,{...env,G6_DYNAMIC_FRESH_ORDER:'1',G6_CANONICAL_PHASE:'N10_WEBHOOK_UNSIGNED_DUPLICATE',
    G6_CANONICAL_ORDER_ID:result.order_id,G6_CANONICAL_ORDER_REFERENCE:result.order_reference,G6_CANONICAL_DB_FINGERPRINT:runtime.db_fingerprint},N10_REPORT);
  }catch(e){
   let child=null;try{child=readJson(N10_REPORT)}catch(_){}
   const m=/G6_N10_(?:SCREEN_MISSING|PRODUCT_GAP)[A-Za-z0-9_]*/.exec(String(child?.error||''));
   throw Error(m?m[0]:e.message);
  }
  const g=readJson(N10_REPORT);
  if(!/_PASS_CHROMIUM_NOT_APPLICABLE$/.test(String(g.verdict))||g.order_id!==result.order_id)throw Error('G6_N10_SCREEN_MISSING_NOT_PROVEN');
  out.stages.push({stage_id:'N10_WEBHOOK_ATTEMPTS',steps_reached:g.steps_reached,probes:g.probes,limits:g.limits,chromium:g.chromium,mobile_money_fixture:g.mobile_money_fixture});
  out.stages.push(evidence('N10_NO_SETTLEMENT_ORACLE',scenario,market,{oracle:g.oracle,before:g.before,after:g.after,order_id:result.order_id,limits:g.limits}));
  out.verdict=g.verdict;
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
 }else if(scenario==='N08'){
  // N08 : rejeux d'idempotence (sondes API signalées) depuis la session de l'écran, jugés par le script ; oracle PG sur la commande unique.
  if(!buyer.n08||buyer.n08.gaps?.length||buyer.n08.order_id!==result.order_id)throw Error('G6_N08_SCREEN_MISSING_REPLAYS_NOT_PROVEN');
  const o=await N.oracleN08(db,{orderId:result.order_id,buyerId:buyer.buyer_id});
  out.stages.push(evidence('N08_IDEMPOTENCY_ORACLE',scenario,market,{oracle:o,replays:{parallel_same_key:buyer.n08.parallel_same_key,different_content:buyer.n08.different_content,no_key:buyer.n08.no_key,no_accepted_total:buyer.n08.no_accepted_total,via:buyer.n08.via},order_id:result.order_id}));
  out.verdict='G6_N08_IDEMPOTENCY_SAME_KEY_ONE_ORDER_API_PROBE_PG_PASS';
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
