'use strict';
/**
 * Independent capacity predicate over the persisted rows of two PG connections.
 * Classifies business-state violations separately from fixture/tool failures.
 */
function validateCase(x,limit){
 if(!x||!x.before||!x.after||!Array.isArray(x.after.parcels)||
  !Array.isArray(x.after.assignedByOrder)||!Array.isArray(x.outcomes)||
  x.outcomes.length!==2||x.cleanup?.verified!==true)
  throw Error('TOOL_ERROR: physical concurrency case incomplete');
 if(x.before.parcels.length!==1||x.before.parcels[0].members!==29||
    x.before.total!==29||x.after.total!==31||
    !x.after.parcels.some(p=>p.id===x.carrierParcel))
  throw Error('TOOL_ERROR: physical capacity fixture or expected total not controlled');
 const assignments=new Map(x.after.assignedByOrder.map(x=>[x.order,x.members]));
 if(assignments.size!==2||assignments.get(x.orderA)!==1||assignments.get(x.orderB)!==1)
  throw Error('TOOL_ERROR: both transactions must have inserted their own order items');
 for(const p of x.after.parcels)if(!p.id||!Number.isSafeInteger(p.members)||p.members<0||
  !['preparation','draft'].includes(p.status))
   throw Error('TOOL_ERROR: inconsistent parcel snapshot');
 if(x.after.parcels.reduce((n,p)=>n+p.members,0)!==x.after.total)
  throw Error('TOOL_ERROR: parcels and totals disagree');
 if(x.outcomes.some(o=>o.status!=='fulfilled'||o.result?.success!==true||
  o.result.items_assigned!==1))
  throw Error('TOOL_ERROR: unexpected owner exception or count, not a capacity race proof');
 return {maximum:Math.max(...x.after.parcels.map(p=>p.members)),
  primary:x.after.parcels.find(p=>p.id===x.carrierParcel).members,
  parcels:x.after.parcels.length,limit};
}
function inspect(raw){
 if(raw?.contract!=='komerce-canonical-pg-concurrency-raw/v15'||
  raw.scope!=='ACTUAL_OWNER_CANONICAL_PG_TWO_INDEPENDENT_CONNECTIONS'||
  raw.onlyLocalTestDb!==true||raw.allFixturesDeleted!==true||
  raw.routeHttpExecuted!==false||raw.productionIncidentConfirmed!==false||
  raw.preseed!==29||raw.limitFromActualOwner!==30||
  !Array.isArray(raw.cases)||raw.cases.length!==2||
  raw.cases[0].mode!=='SEQUENTIAL_CONTROL'||
  raw.cases[1].mode!=='FORCED_TWO_CONNECTION_RACE'||
  raw.cases[1].arrived!==2)
  throw Error('TOOL_ERROR: physical concurrency proof contract incomplete');
 const baseline=validateCase(raw.cases[0],raw.limitFromActualOwner);
 const raced=validateCase(raw.cases[1],raw.limitFromActualOwner);
 const controlRegressed=baseline.maximum>raw.limitFromActualOwner;
 const capacityBreach=raced.maximum>raw.limitFromActualOwner;
 const verdict=controlRegressed?'NOMINAL_REGRESSION':
  capacityBreach?'REPRODUCED_CANONICAL_PG_CONCURRENT_CAPACITY_BREACH':
  'CONTROLLED_CONCURRENT_PG_CAPACITY_SATISFIED';
 return {contract:'komerce-canonical-pg-concurrency-predicate/v15',verdict,
  invariant:'No open parcel contains more item memberships than MAX_ITEMS_PER_PARCEL',
  capacity:raw.limitFromActualOwner,
  sequential:baseline,concurrent:raced,
  observedConcurrencyBreach:capacityBreach,
  novelFamilyCandidate:capacityBreach,
  knownAtStart:false,
  reproductionScope:'TWO_LIVE_PG_CONNECTIONS_FORCED_SAME_CAPACITY_SNAPSHOT_NO_HTTP',
  productionIncidentConfirmed:false,
  businessPolicyReviewRequired:capacityBreach};
}
module.exports={inspect,validateCase};
