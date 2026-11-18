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
const LEGACY_PHASE_MAP=Object.freeze({BUYER_CASH:'RELAY_CASH'});
const CONTRACT_KEYS=['id','requires','produces','run','validate','roles'];
function loadGoldenStages(){
 return STAGE_IDS.map(id=>require('./stages/'+id));
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
module.exports={STAGE_IDS,nextStageId,LEGACY_PHASE_MAP,loadGoldenStages,stageGraph,resolvePhase,prerequisiteIds,requiresResumeProof,validateProofBoundary,planGolden};
