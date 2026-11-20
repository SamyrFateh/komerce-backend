/** @komerce-arch-lite
 * @role g6-canonical-dynamic-runner
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose Run a single bound Golden path only through explicit independently attested stage adapters.
 * @impact-areas staging-only
 */
'use strict';
const {createHash}=require('node:crypto');
const {graphFor,SCENARIO_STAGE_IDS}=require('./stage-registry');
const {planBoundResume}=require('./resume-preflight');
const SHA=/^[a-f0-9]{40}$/;
const DIGEST=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const REFERENCE=/^[A-Z0-9][A-Z0-9-]{5,63}$/;
const REQUIRE_ADAPTERS=['authenticateCheckpoint','attestRuntime','executeStage','verifyStageProof','persistEvidence'];
function matchesContext(v,c){
 return !!v&&v.order_id===c.order_id&&v.order_reference===c.order_reference&&
  v.scenario_id===c.scenario_id&&v.market===c.market&&
  v.db_fingerprint===c.db_fingerprint&&v.staging_sha===c.staging_sha&&
  v.production_permitted===false;
}
function checkAttestation(v,c,stageId){
 if(!matchesContext(v,c)||v.stage_id!==stageId||
  v.attestation_origin!=='INDEPENDENT_CHROMIUM_POSTGRESQL'||
  !DIGEST.test(String(v.evidence_sha256||''))||
  v.external_supplier_calls!==0||v.external_payment_executed!==false)
  throw Error('G6_DYNAMIC_STAGE_ATTESTATION_INVALID_'+stageId);
}
function contextIdentity(context){
 if(!context||!Object.hasOwn(SCENARIO_STAGE_IDS,String(context.scenario_id))||!Object.hasOwn(require('./market-profile').PROFILES,context.market)||
  !UUID.test(String(context.order_id||''))||
  !REFERENCE.test(String(context.order_reference||''))||
  !SHA.test(String(context.staging_sha||''))||
  !String(context.db_fingerprint||'').trim()||
  context.production_permitted!==false)
  throw Error('G6_DYNAMIC_CONTEXT_INVALID');
 return Object.freeze({
  order_id:context.order_id,order_reference:context.order_reference,
  scenario_id:context.scenario_id,market:context.market,
  db_fingerprint:context.db_fingerprint,staging_sha:context.staging_sha,
  production_permitted:false
 });
}
async function executeBoundJourney({
 fromStage='BUYER',toStage='CLIENT_PICKUP',context,checkpoints=[],adapters
}={}){
 const bound=contextIdentity(context);
 if(!adapters||REQUIRE_ADAPTERS.some(k=>typeof adapters[k]!=='function'))
  throw Error('G6_DYNAMIC_CERTIFIED_ADAPTERS_REQUIRED');
 const plan=planBoundResume({fromStage,toStage,context:bound,checkpoints});
 const graph=graphFor(bound.scenario_id);
 // Never accept an attestation from the downloaded report itself. Callers
 // must supply trusted, out-of-process verification services through adapters.
 const runtime=await adapters.attestRuntime({context:bound,plan});
 if(!matchesContext(runtime,bound)||runtime.environment!=='staging'||
    runtime.attestation_origin!=='INDEPENDENT_CHROMIUM_POSTGRESQL')
  throw Error('G6_DYNAMIC_RUNTIME_NOT_INDEPENDENTLY_ATTESTED');
 const verified=new Map();
 for(const p of checkpoints){
  const attested=await adapters.authenticateCheckpoint({checkpoint:p,context:bound,plan});
  checkAttestation(attested,bound,p.stage_id);
  verified.set(p.stage_id,Object.freeze({checkpoint:p,attestation:attested}));
 }
 const executed=[];
 for(const id of plan.stages){
  const stage=graph.byId.get(id);
  for(const requirement of stage.requires){
   if(!verified.has(requirement))
    throw Error('G6_DYNAMIC_DEPENDENCY_UNVERIFIED_'+requirement);
  }
  const predecessors=Object.freeze(stage.requires.map(k=>verified.get(k)));
  const proof=await stage.run({
   runCertifiedStage:async stageId=>{
    if(stageId!==id)throw Error('G6_DYNAMIC_STAGE_ID_MISMATCH');
    return adapters.executeStage({stageId,context:bound,predecessors,plan});
   }
  });
  if(!proof||typeof proof!=='object'||Array.isArray(proof))
   throw Error('G6_DYNAMIC_CHROMIUM_PROOF_MISSING_'+id);
  const attestation=await stage.validate({
   validateCertifiedStage:(stageId,result)=>{
    if(stageId!==id||result!==proof)
     throw Error('G6_DYNAMIC_VALIDATOR_STAGE_MISMATCH');
    return adapters.verifyStageProof({stageId,proof:result,context:bound,predecessors,plan});
   }
  },proof);
  checkAttestation(attestation,bound,id);
  // The trusted evidence adapter must atomically persist an authenticated
  // checkpoint before the next physical or financial business gesture.
  const recorded=await adapters.persistEvidence({stageId:id,proof,attestation,context:bound});
  if(recorded?.persisted!==true||recorded?.stage_id!==id||
     recorded?.evidence_sha256!==attestation.evidence_sha256)
   throw Error('G6_DYNAMIC_EVIDENCE_NOT_DURABLE_'+id);
  verified.set(id,Object.freeze({attestation,checkpoint:recorded}));
  executed.push(Object.freeze({stage_id:id,evidence_sha256:attestation.evidence_sha256}));
 }
 const chainHash=createHash('sha256').update(JSON.stringify({
  order_id:bound.order_id,staging_sha:bound.staging_sha,stages:executed
 })).digest('hex');
 // A local chain, even if complete, is NOT an independent final E2E certification.
 return Object.freeze({
  contract:'G6-DYNAMIC-CHAIN-v1',scenario_id:bound.scenario_id,market:bound.market,
  order_id:bound.order_id,order_reference:bound.order_reference,
  stages:Object.freeze(executed),chain_sha256:chainHash,
  next_action:plan.to_stage===SCENARIO_STAGE_IDS[bound.scenario_id].at(-1)?
   'INDEPENDENT_FINAL_CHROMIUM_PG_CERTIFICATION_REQUIRED':'CONTINUE_ON_STAGING',
  verdict:'NOT_PROVEN',full_chain_certified:false,production_permitted:false
 });
}
module.exports={executeBoundJourney};
