/** @komerce-arch-lite
 * @role g6-canonical-resume-preflight
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose Structural same-order, same-staging preflight for a requested Golden stage; no execution authority.
 * @impact-areas staging-only
 */
'use strict';
const {stageGraph,loadGoldenStages,resolvePhase,prerequisiteIds}=require('./stage-registry');
const SHA=/^[a-f0-9]{40}$/;
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const REF=/^[A-Z0-9][A-Z0-9-]{5,63}$/;
const RUN=/^\d{8,}$/;
// This validates structure, NOT the source of a file or a PostgreSQL assertion.
// A workflow must separately download attested artifacts, verify SHA and do
// independent PostgreSQL/Chromium readback before any business mutation.
function planBoundResume({fromStage,toStage='CLIENT_PICKUP',context,checkpoints}={}){
 const graph=stageGraph(loadGoldenStages());
 const from=resolvePhase(fromStage,graph),to=resolvePhase(toStage,graph);
 const start=graph.order.indexOf(from.id),end=graph.order.indexOf(to.id);
 if(start>end)throw Error('G6_RESUME_STAGE_RANGE_INVALID');
 if(!context||context.scenario_id!=='M01'||!Object.hasOwn(require('./market-profile').PROFILES,context.market)||
    !UUID.test(String(context.order_id||''))||!REF.test(String(context.order_reference||''))||
    !SHA.test(String(context.staging_sha||''))||!String(context.db_fingerprint||'').trim()||
    context.production_permitted!==false)
   throw Error('G6_RESUME_CONTEXT_INVALID');
 const required=prerequisiteIds(from.id,graph);
 if(!Array.isArray(checkpoints)||checkpoints.length!==required.length)
   throw Error('G6_RESUME_CHECKPOINT_CHAIN_INCOMPLETE');
 const seen=new Set();
 for(let i=0;i<required.length;i++){
  const p=checkpoints[i];
  if(!p||typeof p!=='object'||Array.isArray(p)||p.stage_id!==required[i]||
     seen.has(p.stage_id)||!RUN.test(String(p.source_run_id||''))||
     !p.evidence_path||typeof p.evidence_path!=='string'||p.evidence_path.startsWith('/')||
     p.evidence_path.includes('..')||!p.evidence_path.startsWith('test-results/')||
     p.scenario_id!==context.scenario_id||p.market!==context.market||
     p.order_id!==context.order_id||p.order_reference!==context.order_reference||
     p.db_fingerprint!==context.db_fingerprint||p.staging_sha!==context.staging_sha||
     !['PASS','PASS_SIMULATED_STAGING'].includes(p.verdict)||
     p.production_permitted!==false)
   throw Error('G6_RESUME_CHECKPOINT_PROVENANCE_INVALID_'+required[i]);
  seen.add(p.stage_id);
 }
 return Object.freeze({
  contract:'G6-BOUND-RESUME-PREFLIGHT-v1',mode:'read-only',
  from_stage:from.id,to_stage:to.id,
  stages:Object.freeze(graph.order.slice(start,end+1)),
  required_checkpoints:Object.freeze(required),
  checkpoint_count:required.length,
  mutations:0,verdict:'NOT_PROVEN',
  independent_pg_chromium_verification_required:true,
  execution_authorized:false
 });
}
module.exports={planBoundResume};
