'use strict';
/**
 * Opus P0-1 fix: assess persisted state, NEVER assume final total=31 or
 * both owner calls must return items_assigned=1. Correct locking must turn
 * a violation into SATISFIED without any modification to these predicates.
 */
const CAPACITY_INVARIANT='MAX_OPEN_PARCEL_MEMBERSHIPS_LE_30';
function evaluate(c){
 if(!['SEQUENTIAL','UNLOCKED_RACE','SERIALIZED_MUTANT'].includes(c.mode)||
  !c.dbCloned||!c.cloneDropped||!c.before||!c.after||
  !Array.isArray(c.before.parcels)||!Array.isArray(c.after.parcels)||
  !Array.isArray(c.after.assignedByOrder)||!Array.isArray(c.outcomes)||
  c.outcomes.length!==2)
  throw Error('TOOL_ERROR: malformed independent physical proof');
 if(c.before.parcels.length!==1||c.before.parcels[0].members!==29||
  c.before.total!==29||!c.after.parcels.some(x=>x.id===c.originalParcel))
  throw Error('TOOL_ERROR: uncontrolled initial fixture');
 if(!Number.isSafeInteger(c.after.total)||c.after.total<0||
  c.after.parcels.some(p=>!Number.isSafeInteger(p.members)||p.members<0)||
  c.after.parcels.reduce((n,p)=>n+p.members,0)!==c.after.total)
  throw Error('TOOL_ERROR: inconsistent physical SQL totals');
 if(c.mode!=='SEQUENTIAL'&&!(c.gate?.arrived===2||(c.gate?.arrived===1&&c.gate?.serialized===true)))
  throw Error('TOOL_ERROR: no overlapping reads or verified lock serialization');
 const byOrder=new Map(c.after.assignedByOrder.map(o=>[o.order,o.members]));
 if(byOrder.size!==2||!byOrder.has(c.orderA)||!byOrder.has(c.orderB))
  throw Error('TOOL_ERROR: missing observed order counts');
 for(const v of byOrder.values())if(!Number.isSafeInteger(v)||v<0||v>1)
  throw Error('TOOL_ERROR: unexpected fixture membership multiplicity');
 if(c.after.total!==c.before.total+byOrder.get(c.orderA)+byOrder.get(c.orderB))
  throw Error('TOOL_ERROR: observed physical delta inconsistent');
 const max=Math.max(0,...c.after.parcels.filter(p=>['draft','preparation'].includes(p.status)).map(p=>p.members));
 const errors=c.outcomes.filter(x=>x.status!=='fulfilled');
 const mismatches=c.outcomes.filter(x=>{
  const physical=byOrder.get(x.order==='A'?c.orderA:c.orderB);
  const result=x.value;
  // Count check is a separate signal, not a condition for capacity proof.
  return x.status==='fulfilled'&&result?.success===true&&!result.queued&&!result.already_assigned&&
   result.items_assigned!==physical;
 });
 const capacityBreach=max>30;
 return {mode:c.mode,maximum:max,capacityBreach,errors:errors.map(x=>x.code||'UNKNOWN'),
  countMismatches:mismatches.length,assignedA:byOrder.get(c.orderA),
  assignedB:byOrder.get(c.orderB),physicalTotal:c.after.total,
  synchronizedReads:c.gate?.arrived||0,lockWaitObserved:c.gate?.serialized===true,
  verdict:capacityBreach?'CAPACITY_BREACH':
   errors.length?'OWNER_ERROR_AFTER_SYNCHRONIZATION':'CAPACITY_SATISFIED'};
}
function interpret(raw){
 if(raw?.contract!=='komerce-opus-healing-experiment-raw/v16'||
  raw.dbIsolation!=='CREATE_DATABASE_TEMPLATE_KOMERCE_TEST_DROP_PER_CASE'||
  raw.allClonesDropped!==true||raw.realCanonicalSchema!==true||
  raw.realOwnerInvoked!==true||raw.productionOwnerModified!==false||
  raw.routeHttpExecuted!==false||raw.productionIncidentConfirmed!==false||
  !Array.isArray(raw.cases)||raw.cases.length!==3)
  throw Error('TOOL_ERROR: V1.6 controlled proof missing');
 const observed=raw.cases.map(evaluate);
 const [seq,race,locked]=observed;
 if(seq.mode!=='SEQUENTIAL'||race.mode!=='UNLOCKED_RACE'||locked.mode!=='SERIALIZED_MUTANT')
  throw Error('TOOL_ERROR: wrong experiment order');
 const calibrated=seq.verdict==='CAPACITY_SATISFIED'&&locked.verdict==='CAPACITY_SATISFIED'&&locked.lockWaitObserved;
 const uncorrected=calibrated&&race.verdict==='CAPACITY_BREACH';
 const corrected=calibrated&&race.verdict==='CAPACITY_SATISFIED';
 return {contract:'komerce-opus-healing-oracle/v16',
  verdict:uncorrected?'HEALING_ORACLE_CALIBRATED':corrected?'ACTUAL_OWNER_HEALED':'REVIEW_REQUIRED',
  invariant:CAPACITY_INVARIANT,
  observed,actualServiceRaceDemonstrated:race.capacityBreach,
  actualOwnerFixedRecognized:corrected,
  lockedMutantRecognizedAsFixed:locked.verdict==='CAPACITY_SATISFIED'&&locked.lockWaitObserved,
  noProductionIncidentConfirmed:true,
  note:'This is a manually designed mutation control, NOT autonomous bug discovery. Rule applies to line memberships; quantity semantics are not approved.'};
}
module.exports={evaluate,interpret};
