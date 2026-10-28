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
  throw Error('TOOL_ERROR: missing generated data case or physical proof');
 const initialLines=Number(c.before.lines),initialUnits=Number(c.before.units);
 if(initialLines!==d.rows||initialUnits!==d.rows*d.existingQty)
  throw Error('TOOL_ERROR: precondition SQL count inconsistent with generator');
 const original=c.after.filter(x=>x.original);
 if(original.length!==1||!['draft','preparation'].includes(original[0].status)||
   c.after.some(p=>!Number.isSafeInteger(p.lines)||p.lines<0||
    !Number.isSafeInteger(p.units)||p.units<0)||c.after.length>2)
  throw Error('TOOL_ERROR: invalid physical parcel state');
 if(c.incoming.assignments!==1||c.incoming.units!==d.incomingQty||
   c.service.success!==true||c.service.reportedAssigned!==1)
  throw Error('TOOL_ERROR: nominal owner result or incoming item fixture not valid');
 const newParcels=c.after.filter(p=>!p.original);
 const usedOriginal=c.service.usedOriginalParcel;
 const originalDeltaLines=original[0].lines-initialLines;
 const originalDeltaUnits=original[0].units-initialUnits;
 if(usedOriginal){
  if(c.service.created||newParcels.length!==0||
    originalDeltaLines!==1||originalDeltaUnits!==d.incomingQty)
   throw Error('TOOL_ERROR: owner chosen original parcel but physical state differs');
 }else{
  if(!c.service.created||newParcels.length!==1||
    originalDeltaLines!==0||originalDeltaUnits!==0||
    newParcels[0].lines!==1||newParcels[0].units!==d.incomingQty)
   throw Error('TOOL_ERROR: owner chosen new parcel but physical state differs');
 }
 const validLineBaseline=initialLines<=MAX;
 const validUnitBaseline=initialUnits<=MAX;
 const desiredReuseLines=validLineBaseline && initialLines+1<=MAX;
 const desiredReuseUnits=validUnitBaseline && initialUnits+d.incomingQty<=MAX;
 const signals=[];
 if(validLineBaseline&&original[0].lines>MAX)
  signals.push('LINES_EXCEED_30_FROM_VALID_PRESTATE');
 if(validUnitBaseline&&original[0].units>MAX)
  signals.push('UNITS_EXCEED_30_FROM_VALID_PRESTATE');
 if(!usedOriginal&&desiredReuseLines)
  signals.push('REUSE_REFUSED_UNDER_LINE_CAPACITY_POLICY');
 if(!usedOriginal&&desiredReuseUnits)
  signals.push('REUSE_REFUSED_UNDER_UNIT_CAPACITY_POLICY');
 return {key:c.key,dimensions:d,baseline:{lines:initialLines,units:initialUnits},
  physical:{usedOriginal,originalLines:original[0].lines,originalUnits:original[0].units,
   totalParcels:c.after.length},
  linePolicy:{baselineValid:validLineBaseline,reusePossible:desiredReuseLines},
  unitPolicy:{baselineValid:validUnitBaseline,reusePossible:desiredReuseUnits},
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
  semanticVerdict:Object.keys(counts).length?'SEMANTIC_INCONSISTENCIES_REPRODUCED':
   'NO_SEMANTIC_DISAGREEMENT_IN_SEARCHED_CASES',
  approvedCapacityPolicy:null,productionIncidentConfirmed:false,
  note:'Alternative line/unit oracles; inconclusive on which business rule is right.'};
}
module.exports={inspect,evaluate};
