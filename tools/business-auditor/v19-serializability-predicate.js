'use strict';
/**
 * Physical serializability of (state, per-actor result class) together.
 * Opus F1/F3/F4. A second independent AB run gates nondeterministic fixtures.
 * No business-specific capacity constants or special-casing duplicate refs.
 * Outcomes are projected via an adapter; callers must add significant fields
 * when extending beyond auto-parcel.
 */
const {fingerprint}=require('./v18-serializability-predicate');
const {compareSchedules}=require('./v20-serial-kernel');
const MODES=['AB','AB_REPEAT','BA','PARALLEL'];
const ERROR_CODE=/^[0-9A-Z_]{4,64}$/;
function resultFingerprint(outcomes){
 if(!Array.isArray(outcomes)||outcomes.length!==2)throw Error('TOOL_ERROR: missing two actor outcomes');
 const projected=outcomes.map(x=>{
  if(!['A','B'].includes(x.target)||!['fulfilled','rejected'].includes(x.status))
   throw Error('TOOL_ERROR: invalid actor result');
  if(x.status==='rejected'){
   const code=String(x.code||'UNCLASSIFIED').toUpperCase();
   if(!ERROR_CODE.test(code))throw Error('TOOL_ERROR: invalid SQLSTATE or owner error class');
   return {target:x.target,status:'rejected',code};
  }
  const v=x.value;
  if(!v||typeof v!=='object')throw Error('TOOL_ERROR: missing owner return');
  const assigned=v.items_assigned;
  if(assigned!==undefined&&(!Number.isSafeInteger(assigned)||assigned<0))
   throw Error('TOOL_ERROR: invalid owner-reported membership count');
  return {target:x.target,status:'fulfilled',
   success:v.success===true,queued:v.queued===true,
   alreadyAssigned:v.already_assigned===true,
   parcelCreated:v.parcel_created===true,
   assigned:assigned===undefined?null:assigned};
 }).sort((a,b)=>a.target.localeCompare(b.target));
 if(projected[0].target!=='A'||projected[1].target!=='B')
  throw Error('TOOL_ERROR: missing A or B outcome');
 return JSON.stringify(projected);
}
function signature(c){
 return JSON.stringify({state:fingerprint(c.after),outcomes:resultFingerprint(c.outcomes)});
}
function inspect(raw){
 if(raw?.contract!=='komerce-opus-full-serializability-raw/v19'||
  raw.dbIsolation!=='ONE_LOCAL_CANONICAL_TEMPLATE_CLONE_PER_EXECUTION'||
  raw.allClonesDropped!==true||raw.routeHttpExecuted!==false||
  raw.productionIncidentConfirmed!==false||
  !Array.isArray(raw.cases)||raw.cases.length!==4)
  throw Error('TOOL_ERROR: incomplete V1.9 physical proof');
 const [ab,abPrime,ba,race]=raw.cases;
 if(raw.cases.some((c,i)=>c.mode!==MODES[i]||!c.cloneDropped||
    c.before?.total!==29||!c.after))
  throw Error('TOOL_ERROR: wrong schedules or corrupted fixture baseline');
 if(!raw.cases.every(c=>Array.isArray(c.outcomes)&&c.outcomes.length===2))
  throw Error('TOOL_ERROR: missing two owner outcomes');
 if(!(race.gate?.arrived===2||(race.gate?.arrived===1&&race.gate?.serialized===true)))
  throw Error('TOOL_ERROR: concurrency interleaving not observed');
 const result=compareSchedules(raw.cases,{
  fingerprint,resultFingerprint,retryPolicy:raw.retryPolicy
 });
 return {contract:'komerce-opus-full-serializability-verdict/v19',
  ...result,
  semanticScope:'FULL_PROJECTED_OWNER_OUTCOMES_AND_CANONICAL_PHYSICAL_STATE',
  adapter:raw.adapter,
  projectionCompleteness:'AUTO_PARCEL_FIELDS_ONLY_NOT_YET_GENERALIZED',
  noAutomaticProductionIncidentClaim:true,
  note:!result.deterministic?'Unstable fixture: do not interpret apparent concurrency defects':
   'Mismatch is a concurrency candidate; assess return projection and allowed concurrent semantics'};

}
module.exports={MODES,resultFingerprint,signature,inspect};
