/** @komerce-arch-lite
 * @role g6-canonical-stage-registry
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose Validate a single-stage DAG for the Golden G6 journey without duplicating its business scenario matrix.
 * @impact-areas staging-only
 */
'use strict';
const STAGE_IDS=Object.freeze([
 'BUYER','RELAY_CASH','HUB_PO','HUB_COMMITMENT','HUB_VENDOR_READINESS',
 'HUB_VENDOR_SIMULATION','HUB_RECEIVING','HUB_RECEIVING_READBACK',
 'HUB_CUSTOMER_BAG','HUB_KOM_BOX','HUB_SHIPMENT','FORWARDER',
 'CUSTOMS','RELAY_RECEIPT','CLIENT_PICKUP'
]);
// M02 (LOCAL_STOCK) : mêmes BUYER et RELAY_CASH, puis réception locale au relais et remise ; aucun étage Hub/transport.
const M02_STAGE_IDS=Object.freeze(['BUYER','RELAY_CASH','LOCAL_RELAY_AVAILABLE','LOCAL_CLIENT_PICKUP']);
// M03 (panier mixte) : mêmes BUYER et RELAY_CASH ; branche locale (étapes M02) puis oracle clé « pas collected » ;
// branche import (étapes M01, PO mono-fournisseur, consolidation Hub) puis oracle final « collected ».
const M03_STAGE_IDS=Object.freeze(['BUYER','RELAY_CASH','LOCAL_RELAY_AVAILABLE','LOCAL_CLIENT_PICKUP','M03_NOT_COLLECTED',
 ...STAGE_IDS.slice(2),'M03_COLLECTED_FINAL']);
// Scénarios négatifs N (G6-G4A) : points d'arrêt sur le Golden. Geste négatif par l'écran, puis oracle PG en lecture seule.
// N07 double clic Commander (parcours M01) ; N09 remise sans cash encaissé (parcours M02, RELAY_CASH sauté) ;
// N04 quantité > stock local (M02, aucune commande attendue) ; N33 deux variantes du même produit (un panier).
const N07_STAGE_IDS=Object.freeze(['BUYER','N07_NO_DOUBLE_EFFECT']);
const N09_STAGE_IDS=Object.freeze(['BUYER','N09_REMISE_REFUSED','N09_NOT_COLLECTED_ORACLE']);
const N04_STAGE_IDS=Object.freeze(['N04_QTY_OVER_STOCK','N04_NO_EFFECT_ORACLE']);
const N33_STAGE_IDS=Object.freeze(['BUYER','N33_SKU_ORACLE']);
// N23 / N24 (G6-G4B) : parcours M02 jusqu'à « disponible au relais », puis tentatives de retrait (N23) ou deux remises simultanées (N24).
const N23_STAGE_IDS=Object.freeze(['BUYER','RELAY_CASH','LOCAL_RELAY_AVAILABLE','N23_WITHDRAWAL_ATTEMPTS','N23_SECURITY_ORACLE']);
const N24_STAGE_IDS=Object.freeze(['BUYER','RELAY_CASH','LOCAL_RELAY_AVAILABLE','N24_PARALLEL_HANDOFF','N24_SINGLE_HANDOFF_ORACLE']);
// N21 / N22 (G6-G4B) : même parcours M02 jusqu'à « disponible », puis agent d'un autre relais (N21) ou relais A/B dans les deux sens (N22).
const N21_STAGE_IDS=Object.freeze(['BUYER','RELAY_CASH','LOCAL_RELAY_AVAILABLE','N21_CROSS_RELAY_ATTEMPTS','N21_CROSS_RELAY_ORACLE']);
const N22_STAGE_IDS=Object.freeze(['BUYER','RELAY_CASH','LOCAL_RELAY_AVAILABLE','N22_TWO_RELAYS_ATTEMPTS','N22_TWO_RELAYS_ORACLE']);
// N20 (G6-G4B) : parcours import M01 jusqu'à la douane, puis réception relais avec écart. N29 : parcours M02 jusqu'à « disponible », puis session expirée et rôle non autorisé.
const N20_STAGE_IDS=Object.freeze([...STAGE_IDS.slice(0,STAGE_IDS.indexOf('CUSTOMS')+1),'N20_RELAY_DISCREPANCY','N20_DISCREPANCY_ORACLE']);
const N29_STAGE_IDS=Object.freeze(['BUYER','RELAY_CASH','LOCAL_RELAY_AVAILABLE','N29_SESSION_ROLE_ATTEMPTS','N29_NO_MUTATION_ORACLE']);
// N11 / N12 (G6-G4C) : chaîne import M01 coupée au bon point, puis geste négatif Hub et oracle PG.
// N11 : PO brouillon sans validation d'engagement. N12 : PO confirmé (engagement posé), paiement fournisseur sans la deuxième autorisation.
const upTo=id=>STAGE_IDS.slice(0,STAGE_IDS.indexOf(id)+1);
const N11_STAGE_IDS=Object.freeze([...upTo('HUB_PO'),'N11_PO_NO_COMMITMENT_ATTEMPT','N11_NO_ENGAGEMENT_ORACLE']);
const N12_STAGE_IDS=Object.freeze([...upTo('HUB_VENDOR_SIMULATION'),'N12_PAYMENT_SINGLE_VALIDATOR','N12_NO_PAYMENT_ORACLE']);
// N13 : PO notifié (engagement posé), envoi puis confirmation fournisseur en rupture, jouées par le script. N14 : PO confirmé, réception Hub refusée puis exacte.
const N13_STAGE_IDS=Object.freeze([...upTo('HUB_VENDOR_READINESS'),'N13_SUPPLIER_BACKORDER','N13_BACKORDER_ORACLE']);
const N14_STAGE_IDS=Object.freeze([...upTo('HUB_VENDOR_SIMULATION'),'N14_RECEIVING_QTY_ATTEMPTS','N14_RECEIVING_ORACLE']);
// N15 : unités reçues, rien ensaché ; sac incomplet puis KOM-BOX sans ce sac. N16 : carton PACKED dans la KOM-BOX, remise refusée avant DISPATCHED, composition figée après.
const N15_STAGE_IDS=Object.freeze([...upTo('HUB_RECEIVING_READBACK'),'N15_BAG_BOX_INCOMPLETE','N15_NO_CLOSURE_ORACLE']);
const N16_STAGE_IDS=Object.freeze([...upTo('HUB_KOM_BOX'),'N16_BOX_NOT_DISPATCHED_FROZEN','N16_BOX_FROZEN_ORACLE']);
// N17 (G6-G5B) : chaîne M01 jusqu'à la remise au transitaire, puis gestes refusés. N18 : jusqu'à l'arrivée (transitaire), puis douane retenue et mainlevée. N19 : jusqu'au transport local, puis retard et perte.
const N17_STAGE_IDS=Object.freeze([...upTo('HUB_SHIPMENT'),'N17_FORWARDER_ROLE_MARKET_ATTEMPTS','N17_NO_TRANSITION_ORACLE']);
const N18_STAGE_IDS=Object.freeze([...upTo('FORWARDER'),'N18_CUSTOMS_HOLD_ATTEMPTS','N18_HOLD_RELEASE_ORACLE']);
const N19_STAGE_IDS=Object.freeze([...upTo('CUSTOMS'),'N19_LOCAL_TRANSPORT_DELAY_LOSS','N19_LOSS_INCIDENT_ORACLE']);
// N28 / N32 (G6-G5C) : parcours M02 jusqu'à « disponible », puis échec réseau ou 500 avec réessai (N28), lectures et écritures croisées marché et rôle (N32).
const N28_STAGE_IDS=Object.freeze(['BUYER','RELAY_CASH','LOCAL_RELAY_AVAILABLE','N28_NETWORK_FAILURE_RETRY','N28_SINGLE_EFFECT_ORACLE']);
const N32_STAGE_IDS=Object.freeze(['BUYER','RELAY_CASH','LOCAL_RELAY_AVAILABLE','N32_CROSS_MARKET_ROLES','N32_NO_MUTATION_ORACLE']);
const SCENARIO_STAGE_IDS=Object.freeze({M01:STAGE_IDS,M02:M02_STAGE_IDS,M03:M03_STAGE_IDS,
 N07:N07_STAGE_IDS,N09:N09_STAGE_IDS,N04:N04_STAGE_IDS,N33:N33_STAGE_IDS,N23:N23_STAGE_IDS,N24:N24_STAGE_IDS,N21:N21_STAGE_IDS,N22:N22_STAGE_IDS,N20:N20_STAGE_IDS,N29:N29_STAGE_IDS,N11:N11_STAGE_IDS,N12:N12_STAGE_IDS,N13:N13_STAGE_IDS,N14:N14_STAGE_IDS,N15:N15_STAGE_IDS,N16:N16_STAGE_IDS,N17:N17_STAGE_IDS,N18:N18_STAGE_IDS,N19:N19_STAGE_IDS,N28:N28_STAGE_IDS,N32:N32_STAGE_IDS});
function scenarioProfile(raw){
 if(typeof raw!=='string'||!Object.hasOwn(SCENARIO_STAGE_IDS,raw))throw Error('G6_UNSUPPORTED_SCENARIO');
 return raw;
}
const LEGACY_PHASE_MAP=Object.freeze({BUYER_CASH:'RELAY_CASH'});
const CONTRACT_KEYS=['id','requires','produces','run','validate','roles'];
function loadGoldenStages(){
 return STAGE_IDS.map(id=>require('./stages/'+id));
}
function loadScenarioStages(scenario){
 return SCENARIO_STAGE_IDS[scenarioProfile(scenario)].map(id=>require('./stages/'+id));
}
function stageGraph(stages){
 if(!Array.isArray(stages)||!stages.length)throw Error('G6_STAGE_REGISTRY_EMPTY');
 const byId=new Map(),producers=new Map();
 for(const stage of stages){
  if(!stage||CONTRACT_KEYS.some(k=>!Object.prototype.hasOwnProperty.call(stage,k))||
     !/^[A-Z][A-Z0-9_]*$/.test(stage.id||'')||
     !Array.isArray(stage.requires)||!Array.isArray(stage.produces)||!Array.isArray(stage.roles)||
     typeof stage.run!=='function'||typeof stage.validate!=='function'||
     !stage.produces.length||!stage.roles.length)
   throw Error('G6_STAGE_CONTRACT_INVALID');
  if(byId.has(stage.id))throw Error('G6_STAGE_DUPLICATE_'+stage.id);
  if(new Set(stage.requires).size!==stage.requires.length)throw Error('G6_STAGE_DUPLICATE_DEPENDENCY_'+stage.id);
  byId.set(stage.id,stage);
  for(const p of stage.produces){
   if(producers.has(p))throw Error('G6_STAGE_DUPLICATE_PROOF_KEY_'+p);
   producers.set(p,stage.id);
  }
 }
 const ready=new Set(),visiting=new Set(),ordered=[];
 function visit(id){
  if(ready.has(id))return;
  if(visiting.has(id))throw Error('G6_STAGE_DEPENDENCY_CYCLE_'+id);
  const stage=byId.get(id);
  if(!stage)throw Error('G6_STAGE_DEPENDENCY_MISSING_'+id);
  visiting.add(id);
  for(const prev of stage.requires)visit(prev);
  visiting.delete(id);ready.add(id);ordered.push(id);
 }
 for(const id of byId.keys())visit(id);
 return Object.freeze({byId,order:Object.freeze(ordered),producers});
}
function graphFor(scenario){return stageGraph(loadScenarioStages(scenario))}
function nextStageId(id){
 const i=STAGE_IDS.indexOf(LEGACY_PHASE_MAP[id]||id);
 return i>=0&&i<STAGE_IDS.length-1?STAGE_IDS[i+1]:null;
}
function resolvePhase(phase,graph=stageGraph(loadGoldenStages())){
 const canonical=LEGACY_PHASE_MAP[phase]||phase;
 if(!graph.byId.has(canonical))throw Error('G6_CANONICAL_PHASE_NOT_REGISTERED_'+phase);
 return graph.byId.get(canonical);
}
function prerequisiteIds(id,graph=stageGraph(loadGoldenStages())){
 const stage=resolvePhase(id,graph),visited=new Set();
 const walk=(s)=>{for(const p of s.requires){if(!visited.has(p)){visited.add(p);walk(graph.byId.get(p))}}};
 walk(stage);
 return graph.order.filter(x=>visited.has(x));
}
// Checkpoint enforcement comes from the declared dependency graph, not a
// separate hand-maintained phase allowlist. This is authorization only:
 // it never loads old evidence or executes a business gesture.
function requiresResumeProof(phase,graph=stageGraph(loadGoldenStages())){
 const stage=resolvePhase(phase,graph);
 return prerequisiteIds(stage.id,graph).length>0;
}
function validateProofBoundary(stage,proof){
 if(!proof || typeof proof!=='object'||Array.isArray(proof)||
    !stage.produces.every(k=>Object.prototype.hasOwnProperty.call(proof,k)))
    throw Error('G6_STAGE_PROOF_INVALID_'+stage.id);
 return true;
}
function planGolden({fromStage='BUYER',toStage='CLIENT_PICKUP'}={}){
 const g=stageGraph(loadGoldenStages());
 const from=resolvePhase(fromStage,g),to=resolvePhase(toStage,g);
 const start=g.order.indexOf(from.id),end=g.order.indexOf(to.id);
 if(start>end)throw Error('G6_STAGE_RANGE_INVALID');
 // This is a READ-ONLY plan, never a certification or an executable shortcut.
 return {contract:'G6-CANONICAL-JOURNEY-v1',mode:'dry-run',stages:g.order.slice(start,end+1),
  missing_prerequisites:prerequisiteIds(from.id,g),mutations:0,verdict:'NOT_PROVEN'};
}
module.exports={M02_STAGE_IDS,M03_STAGE_IDS,N07_STAGE_IDS,N09_STAGE_IDS,N04_STAGE_IDS,N33_STAGE_IDS,N23_STAGE_IDS,N24_STAGE_IDS,N21_STAGE_IDS,N22_STAGE_IDS,N20_STAGE_IDS,N29_STAGE_IDS,N11_STAGE_IDS,N12_STAGE_IDS,N13_STAGE_IDS,N14_STAGE_IDS,N15_STAGE_IDS,N16_STAGE_IDS,N17_STAGE_IDS,N18_STAGE_IDS,N19_STAGE_IDS,N28_STAGE_IDS,N32_STAGE_IDS,SCENARIO_STAGE_IDS,scenarioProfile,loadScenarioStages,graphFor,STAGE_IDS,nextStageId,LEGACY_PHASE_MAP,loadGoldenStages,stageGraph,resolvePhase,prerequisiteIds,requiresResumeProof,validateProofBoundary,planGolden};
