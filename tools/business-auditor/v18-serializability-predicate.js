'use strict';
/**
 * Generic observational SERIALIZABILITY oracle: the final physical state of
 * A || B must match A->B or B->A. No assumption about which business capacity
 * value is right. A fixed owner naturally becomes serializable.
 * This module consumes an adapter-provided, stable database fingerprint.
 */
function fingerprint(state) {
 if(!state||!Array.isArray(state.parcels)||!Array.isArray(state.assignedByOrder)||
    !Number.isSafeInteger(state.total)||state.total<0)
  throw Error('TOOL_ERROR: invalid physical state for fingerprint');
 const parcels=state.parcels.map(p=>{
  if(!Number.isSafeInteger(p.members)||p.members<0||typeof p.status!=='string')
   throw Error('TOOL_ERROR: invalid physical parcel row');
  return {status:p.status,members:p.members};
 }).sort((a,b)=>a.status.localeCompare(b.status)||a.members-b.members);
 if(parcels.reduce((n,p)=>n+p.members,0)!==state.total)
  throw Error('TOOL_ERROR: inconsistent parcel row aggregation');
 const orders=state.assignedByOrder.map(p=>{
  if(!['A','B'].includes(p.target)||!Number.isSafeInteger(p.members)||p.members<0)
   throw Error('TOOL_ERROR: invalid normalized target');
  return {target:p.target,members:p.members};
 }).sort((a,b)=>a.target.localeCompare(b.target));
 if(orders.length!==2||orders[0].target!=='A'||orders[1].target!=='B')
  throw Error('TOOL_ERROR: missing A/B per-order physical deltas');
 return JSON.stringify({parcels,orders,total:state.total});
}
function inspect(raw){
 if(raw?.contract!=='komerce-adapter-serializability-raw/v18'||
    raw.method!=='PHYSICAL_PG_CANONICAL_THREE_CLONES'||
    raw.allClonesDropped!==true||raw.productionIncidentConfirmed!==false||
    raw.routeHttpExecuted!==false||!Array.isArray(raw.cases)||raw.cases.length!==3)
  throw Error('TOOL_ERROR: serializability witness contract incomplete');
 const [ab,ba,race]=raw.cases;
 if(ab.mode!=='AB'||ba.mode!=='BA'||race.mode!=='PARALLEL'||
    !raw.cases.every(c=>c.cloneDropped&&c.before?.total===29&&c.after))
  throw Error('TOOL_ERROR: wrong or incomplete serial cases');
 const fAB=fingerprint(ab.after),fBA=fingerprint(ba.after),fParallel=fingerprint(race.after);
 if(!raw.cases.every(c=>Array.isArray(c.outcomes)&&c.outcomes.length===2))
  throw Error('TOOL_ERROR: missing owner outcomes');
 if(race.gate?.arrived!==2&&!(race.gate?.arrived===1&&race.gate?.serialized===true))
  throw Error('TOOL_ERROR: physical parallel execution not proven');
 const exceptions=race.outcomes.filter(x=>x.status!=='fulfilled');
 const matchAB=fParallel===fAB,matchBA=fParallel===fBA;
 const verdict=exceptions.length?'INCONCLUSIVE_OWNER_EXCEPTION':
  !matchAB&&!matchBA?'NON_SERIALIZABLE':
  race.gate?.serialized?'SERIALIZED_BY_LOCK':'NO_CONFLICT';
 return {contract:'komerce-business-serializability-oracle/v18',
  verdict,matchAB,matchBA,lockWaitObserved:race.gate?.serialized===true,
  fingerprints:{AB:fAB,BA:fBA,parallel:fParallel},
  omittedFields:['database UUIDs','created_at','reference'],
  selectedAdapter:'AUTO_PARCEL_TWO_ORDERS',
  ownerExceptions:exceptions.length,
  noAutomaticBusinessBugClaim:true,
  qualification:'NON_SERIALIZABLE must be checked against allowed business outcomes; this is a candidate not a production incident',
  routeHttpExecuted:false,productionIncidentConfirmed:false};
}
module.exports={fingerprint,inspect};
