'use strict';
/**
 * External state predicates, independent from the real service logic.
 * Accept raw, query-backed snapshots; never trust Jest-authored success flags.
 * This experiment uses the explicit, reviewable BUSINESS ASSUMPTION that an
 * active, paid, still-fulfillable order may be redistributed after cancellation.
 */
const ACTIONS=['distribute','retry_without_cancel','distribute','cancel_via_ssot','redistribute','repeat_redistribute'];
const SCENARIOS=['NOMINAL','NOMINAL','CANCEL_RETRY','CANCEL_RETRY','CANCEL_RETRY','CANCEL_RETRY'];
function assertRaw(raw){
 if(raw?.contract!=='komerce-canonical-parcel-sequence-raw/v13'||
  raw.scope!=='REAL_SERVICES_CANONICAL_POSTGRESQL_16_SINGLE_TRANSACTION'||
  raw.canonicalSchema!==true||raw.liveDatabase!==false||
  raw.rollbackVerified!==true||raw.usedSkipValidation!==false||
  raw.routeHttpExecuted!==false||raw.twoConnectionRaceExecuted!==false||
  raw.productionIncidentConfirmed!==false||
  !Array.isArray(raw.steps)||raw.steps.length!==6)
  throw Error('TOOL_ERROR: canonical sequence raw proof absent or mismatched');
 for(let i=0;i<6;i++){
  const x=raw.steps[i];
  if(x?.scenario!==SCENARIOS[i]||x.action!==ACTIONS[i]||
    !x.state||!Array.isArray(x.state.parcels)||!Array.isArray(x.state.memberships)||
    typeof x.state.orderStatus!=='string'||typeof x.state.eligibleForDistributeAll!=='boolean')
   throw Error('TOOL_ERROR: canonical sequence step missing: '+i);
  for(const p of x.state.parcels)if(!p.id||!Number.isSafeInteger(p.memberships)||p.memberships<0)
    throw Error('TOOL_ERROR: invalid physical parcel count');
  for(const m of x.state.memberships)if(!m.parcelId||!m.orderItemId||!Number.isSafeInteger(m.quantity)||m.quantity<1)
    throw Error('TOOL_ERROR: invalid membership row');
  const counts=new Map(x.state.parcels.map(p=>[p.id,0]));
  for(const m of x.state.memberships){
   if(!counts.has(m.parcelId))throw Error('TOOL_ERROR: orphaned membership outside reported parcels');
   counts.set(m.parcelId,counts.get(m.parcelId)+1);
   const p=x.state.parcels.find(p=>p.id===m.parcelId);
   if(m.status!==p.status)throw Error('TOOL_ERROR: membership references inconsistent parcel state');
  }
  for(const p of x.state.parcels)if(counts.get(p.id)!==p.memberships)
   throw Error('TOOL_ERROR: table count and membership rows disagree');
 }
 if(!raw.fixtures?.nominalOrder||!raw.fixtures?.affectedOrder||
  !raw.fixtures?.affectedOrderItem||!raw.fixtures?.originalParcel)
  throw Error('TOOL_ERROR: missing fixture identity');
}
function view(state){
 const active=state.memberships.filter(m=>m.status!=='cancelled');
 const cancelled=state.memberships.filter(m=>m.status==='cancelled');
 const emptyOpen=state.parcels.filter(p=>['draft','preparation'].includes(p.status)&&p.memberships===0);
 return {status:state.orderStatus,activeMemberships:active.length,cancelledMemberships:cancelled.length,
  emptyOpenParcels:emptyOpen.length,openParcels:state.parcels.filter(p=>['draft','preparation'].includes(p.status)).length,
  representedParcelIds:active.map(m=>m.parcelId)};
}
function interpret(raw){
 assertRaw(raw);
 const [first,retry,distributed,cancelled,redistributed,repeated]=raw.steps;
 const facts=Object.fromEntries([
  ['nominal_initial',view(first.state)],
  ['nominal_retry',view(retry.state)],
  ['before_cancel',view(distributed.state)],
  ['after_cancel',view(cancelled.state)],
  ['after_redistribute',view(redistributed.state)],
  ['after_repeat',view(repeated.state)]
 ]);
 const sanity=[
  [first.result?.success===true&&first.state.memberships.length===1,'nominal initial membership'],
  [retry.result?.already_assigned===true&&retry.state.parcels.length===first.state.parcels.length,'nominal retry guard'],
  [distributed.result?.success===true&&distributed.state.memberships.length===1,'before cancel membership'],
  [cancelled.result?.ok===true,'SSOT cancellation'],
  [cancelled.state.parcels.some(p=>p.id===raw.fixtures.originalParcel&&p.status==='cancelled'),'cancelled physical parcel'],
  [cancelled.state.orderStatus==='ordered'&&cancelled.state.eligibleForDistributeAll===true,'still eligible active order']
 ];
 const bad=sanity.filter(x=>!x[0]).map(x=>x[1]);
 if(bad.length)throw Error('TOOL_ERROR: invalid seeded control, cannot assess sequence: '+bad.join(', '));
 // Business policy is explicit; the oracle does not conclude what happens for
 // cancelled/refunded orders or assert that all cancellations require redistribution.
 const issues=[];
 if(redistributed.result?.success===true &&
   redistributed.result?.items_assigned>0 &&
   facts.after_redistribute.activeMemberships===0)
  issues.push({id:'FALSE_SUCCESS_COUNT',expected:'an active membership if an assignment was reported',
   observed:'none; reported '+redistributed.result.items_assigned});
 if(redistributed.result?.success===true &&
   facts.after_redistribute.activeMemberships===0 &&
   facts.after_redistribute.emptyOpenParcels>0)
  issues.push({id:'GHOST_OPEN_PARCEL',expected:0,
   observed:facts.after_redistribute.emptyOpenParcels});
 if(facts.after_redistribute.activeMemberships===0&&cancelled.state.eligibleForDistributeAll &&
  facts.after_redistribute.cancelledMemberships>0)
  issues.push({id:'ACTIVE_ORDER_STRANDED_AFTER_CANCEL',expected:'eligible item can be assigned to an active parcel',
   observed:'no active parcel membership; item locked in cancelled parcel'});
 return {contract:'komerce-business-sequence-oracle/v13',
  verdict:issues.length?'REPRODUCED_CANONICAL_PG_SEQUENCE_ANOMALY':'CONTROLLED_CANONICAL_PG_SEQUENCE_SATISFIED',
  policyAssumption:'ORDER_ORDERED_AND_PAID_MAY_BE_REDISTRIBUTED_AFTER_PARCEL_CANCEL',
  evidenceLevel:'REAL_CANONICAL_PG_SINGLE_CONNECTION_REAL_SERVICES_ROLLBACK',
  stepsEvaluated:raw.steps.length,facts,issues,
  routeHttpExecuted:false,twoConnectionRaceExecuted:false,
  businessDecisionRequired:true,productionIncidentConfirmed:false};
}
module.exports={interpret,assertRaw,view};
