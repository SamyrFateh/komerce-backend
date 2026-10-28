'use strict';
/**
 * Two competing capacity semantics: maximum ITEM LINES or maximum UNITS.
 * Neither is treated as approved business policy. The oracle computes both,
 * using actual SQL snapshots; it never copies the owner's mixed comparison.
 */
const {cases:RANGE_CASES}=require('./v17-quantity-matrix-runner');
const MAX=30;
function evaluate(c){
 const d=c?.dimensions,expected=RANGE_CASES().find(x=>x.key===c?.key);
 if(!d||!expected||JSON.stringify(d)!==JSON.stringify(expected)||
    c.rollbackVerified!==true||c.cloneDropped!==true||
    !Array.isArray(c.after)||!c.before||!c.incoming||!c.service)
  throw Error('TOOL_ERROR: missing generated case or SQL evidence');
 const initialLines=Number(c.before.lines),initialUnits=Number(c.before.units);
 if(initialLines!==d.rows||initialUnits!==d.rows*d.existingQty)
  throw Error('TOOL_ERROR: initial DB state disagrees with fixture');
 const original=c.after.filter(x=>x.original);
 if(original.length!==1||!['draft','preparation'].includes(original[0].status)||
    c.after.some(p=>!Number.isSafeInteger(p.lines)||p.lines<0||
     !Number.isSafeInteger(p.units)||p.units<0))
  throw Error('TOOL_ERROR: invalid parcel SQL state');
 const assigned=c.incoming.assignments,units=c.incoming.units;
 if(!Number.isSafeInteger(assigned)||assigned<0||
    !Number.isSafeInteger(units)||units<0)
  throw Error('TOOL_ERROR: invalid SQL membership measurements');
 const fresh=c.after.filter(x=>!x.original);
 const initialLineDelta=original[0].lines-initialLines;
 const initialUnitDelta=original[0].units-initialUnits;
 const freshLines=fresh.reduce((n,x)=>n+x.lines,0);
 const freshUnits=fresh.reduce((n,x)=>n+x.units,0);
 if(initialLineDelta<0||initialUnitDelta<0||
    assigned!==initialLineDelta+freshLines||
    units!==initialUnitDelta+freshUnits)
  throw Error('TOOL_ERROR: physical association deltas do not reconcile');
 const queued=c.service.queued===true,alreadyAssigned=c.service.alreadyAssigned===true;
 const reused=initialLineDelta>0;
 const validLineBaseline=initialLines<=MAX;
 const validUnitBaseline=initialUnits<=MAX;
 const lineCanReuse=validLineBaseline&&initialLines+1<=MAX;
 const unitCanReuse=validUnitBaseline&&initialUnits+d.incomingQty<=MAX;
 const signals=[];
 if(assigned>1||assigned===1&&units!==d.incomingQty)
  signals.push('UNEXPECTED_INCOMING_MEMBERSHIP_QUANTITY');
 if(validLineBaseline&&original[0].lines>MAX)
  signals.push('LINES_EXCEED_30_FROM_VALID_PRESTATE');
 if(validUnitBaseline&&original[0].units>MAX)
  signals.push('UNITS_EXCEED_30_FROM_VALID_PRESTATE');
 if(!reused&&lineCanReuse)
  signals.push('REUSE_REFUSED_UNDER_LINE_CAPACITY_POLICY');
 if(!reused&&unitCanReuse)
  signals.push('REUSE_REFUSED_UNDER_UNIT_CAPACITY_POLICY');
 if((queued||alreadyAssigned)&&assigned>0)
  signals.push('OWNER_CLAIMED_NOOP_BUT_MEMBERSHIP_CHANGED');
 if(c.service.success===true&&!queued&&!alreadyAssigned&&
    c.service.reportedAssigned!==assigned)
  signals.push('OWNER_REPORTED_COUNT_MISMATCH');
 if(c.service.success===false&&assigned>0)
  signals.push('OWNER_REPORTED_REJECTION_AFTER_WRITE');
 if(c.service.created===true&&fresh.length===0)
  signals.push('OWNER_REPORTED_PARCEL_CREATION_WITHOUT_PHYSICAL_PARCEL');
 return {key:c.key,dimensions:d,baseline:{lines:initialLines,units:initialUnits},
  physical:{usedOriginal:reused,originalLines:original[0].lines,
   originalUnits:original[0].units,totalParcels:c.after.length,
   assigned,assignedUnits:units},
  service:{queued,alreadyAssigned,success:c.service.success===true},
  linePolicy:{baselineValid:validLineBaseline,reusePossible:lineCanReuse},
  unitPolicy:{baselineValid:validUnitBaseline,reusePossible:unitCanReuse},
  signals,policyStatus:'NEEDS_BUSINESS_ARBITRATION'};
}
function inspect(raw){
 if(raw?.contract!=='komerce-generated-capacity-data-raw/v17'||
    raw.schema!=='CANONICAL_POSTGRESQL_16'||raw.dbLocalOnly!==true||
    raw.allClonesDropped!==true||raw.actualBusinessPolicyApproved!==false||
    raw.concurrentSessions!==false||raw.routeHttpExecuted!==false||
    raw.productionIncidentConfirmed!==false||!Array.isArray(raw.cases))
  throw Error('TOOL_ERROR: generated quantity evidence incomplete');
 const expected=RANGE_CASES();
 if(raw.cases.length!==expected.length)
  throw Error('TOOL_ERROR: generator coverage incomplete');
 const seen=new Set();const results=[];
 for(const x of raw.cases) {
  if(seen.has(x.key))throw Error('TOOL_ERROR: duplicate generated case');
  seen.add(x.key);results.push(evaluate(x));
 }
 const counts={};
 for(const v of results)for(const signal of v.signals)
  counts[signal]=(counts[signal]||0)+1;
 return {contract:'komerce-generated-capacity-interpretation/v17',
  evaluatedCases:results.length,capacity:MAX,counts,results,
  semanticVerdict:(
   (counts.LINES_EXCEED_30_FROM_VALID_PRESTATE||0)+
   (counts.REUSE_REFUSED_UNDER_LINE_CAPACITY_POLICY||0)>0 &&
   (counts.UNITS_EXCEED_30_FROM_VALID_PRESTATE||0)+
   (counts.REUSE_REFUSED_UNDER_UNIT_CAPACITY_POLICY||0)>0
   ?'NO_SINGLE_POLICY_SATISFIED':
   Object.keys(counts).length?'SINGLE_POLICY_PLAUSIBLE_OR_OTHER_SIGNALS':
   'NO_POLICY_CONTRADICTION_OBSERVED'),
  approvedCapacityPolicy:null,productionIncidentConfirmed:false,
  note:'Neither line nor unit policy fits all observed cases if both families appear. Weight or volume is a separate business hypothesis.'};
}
module.exports={inspect,evaluate};
