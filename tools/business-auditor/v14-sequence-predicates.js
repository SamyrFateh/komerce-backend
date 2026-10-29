'use strict';
/**
 * Independent, general-purpose predicates over return values and physical
 * database snapshots. Not tied to a preselected distribute/cancel script.
 * Findings are anomaly candidates: human policy adjudication remains required.
 */
const {generatePlans}=require('./v14-sequence-planner');
const KNOWN=new Set(['ASSIGNMENT_COUNT_DISAGREES_WITH_DB','OPEN_EMPTY_PARCEL_CREATED']);
function validateSnapshot(x,ids){
 if(!x||!Array.isArray(x.orders)||x.orders.length!==2||
  !Array.isArray(x.parcels)||!Array.isArray(x.members))
  throw Error('TOOL_ERROR: incomplete physical state');
 const validOrders=new Set([ids.A,ids.B]);
 if(x.orders.some(o=>!validOrders.has(o.order)||typeof o.status!=='string'))
  throw Error('TOOL_ERROR: malformed order snapshot');
 const parcelById=new Map(x.parcels.map(p=>[p.id,p]));
 if(parcelById.size!==x.parcels.length)throw Error('TOOL_ERROR: duplicate parcel snapshot');
 const counts=new Map(x.parcels.map(p=>[p.id,0]));
 const uniqueOrderItems=new Set();
 for(const m of x.members){
  if(!parcelById.has(m.parcel)||!validOrders.has(m.order)||
   !Number.isSafeInteger(m.quantity)||m.quantity<1)
   throw Error('TOOL_ERROR: membership inconsistent with fixture');
  if(uniqueOrderItems.has(m.item))throw Error('TOOL_ERROR: duplicate item membership in snapshot');
  uniqueOrderItems.add(m.item);
  if(m.parcelStatus!==parcelById.get(m.parcel).status)
   throw Error('TOOL_ERROR: parcel status disagreement');
  counts.set(m.parcel,counts.get(m.parcel)+1);
 }
 for(const p of x.parcels)if(!Number.isSafeInteger(p.members)||p.members<0||
   p.members!==counts.get(p.id))throw Error('TOOL_ERROR: physical count inconsistent');
}
function inspect(raw){
 if(raw?.contract!=='komerce-business-sequence-exploration-raw/v14'||
  raw.scope!=='CANONICAL_PG_REAL_OWNERS_SINGLE_CONNECTION'||
  raw.dbLocalOnly!==true||raw.rollbackVerified!==true||
  raw.allCasesSavepointRolledBack!==true||
  raw.concurrentTransactionsExecuted!==false||raw.routeHttpExecuted!==false||
  raw.productionIncidentConfirmed!==false||!Array.isArray(raw.cases)||
  raw.cases.length!==raw.generatedCases)
  throw Error('TOOL_ERROR: exploration input/provenance incomplete');
 const plans=generatePlans(raw.depth);
 if(plans.length!==raw.cases.length)
  throw Error('TOOL_ERROR: planner coverage or count missing');
 const findings=[],eventCounts={ASSIGN_A:0,ASSIGN_B:0,CANCEL_OPEN:0},exceptions=[];
 for(let idx=0;idx<plans.length;idx++){
  const c=raw.cases[idx],plan=plans[idx];
  if(c.id!==plan.id||c.actions.join('|')!==plan.actions.join('|')||
   c.steps.length!==c.actions.length||!c.ids?.A||!c.ids?.B||c.ids.A===c.ids.B)
   throw Error('TOOL_ERROR: generated actions or fixture identity mismatch');
  validateSnapshot(c.initial,c.ids);
  let before=c.initial;
  for(let step=0;step<c.steps.length;step++){
   const entry=c.steps[step],action=c.actions[step],after=entry.state;
   if(entry.action!==action||!Object.hasOwn(eventCounts,action))
    throw Error('TOOL_ERROR: action execution trace does not match planner');
   validateSnapshot(after,c.ids);
   eventCounts[action]++;
   const r=entry.result;
   if(!r||typeof r!=='object')throw Error('TOOL_ERROR: service response missing');
   const current=new Set(before.members.map(m=>m.item+'|'+m.parcel));
   const added=after.members.filter(m=>!current.has(m.item+'|'+m.parcel));
   const newOpenParcels=after.parcels.filter(p=>
    !before.parcels.some(q=>q.id===p.id)&&
    ['draft','preparation'].includes(p.status)&&p.members===0);
   const mention=(rule,details)=>findings.push({caseId:c.id,actions:[...c.actions],step:step+1,
    action,rule,priority:'P1',proofScope:'CANONICAL_PG_STATE_DELTA_AND_ACTUAL_SERVICE',
    previouslyKnownFamily:KNOWN.has(rule),details});
   if(r.threw){
    exceptions.push({caseId:c.id,step:step+1,action,code:r.code});
    // An exception is an observation. No business bug is asserted without
    // an independent rule concerning availability and allowed transitions.
   } else if(action.startsWith('ASSIGN_')){
    const target=entry.target;
    if(target!==(action==='ASSIGN_A'?c.ids.A:c.ids.B))
     throw Error('TOOL_ERROR: target order identity mismatch');
    const created=added.filter(m=>m.order===target).length;
    if(r.success===true&&!r.queued&&!r.already_assigned){
     if(!Number.isSafeInteger(r.items_assigned)||r.items_assigned!==created)
      mention('ASSIGNMENT_COUNT_DISAGREES_WITH_DB',{
       returned:r.items_assigned??null,physicalAdded:created});
     if(newOpenParcels.length>0)
      mention('OPEN_EMPTY_PARCEL_CREATED',{newEmptyCount:newOpenParcels.length});
    }
    if((r.already_assigned===true||r.queued===true)&&added.length!==0)
     mention('CLAIMED_NOOP_BUT_DB_CHANGED',{newMemberships:added.length,
      alreadyAssigned:r.already_assigned===true,queued:r.queued===true});
    const lost=before.members.filter(m=>!after.members.some(n=>n.item===m.item&&n.parcel===m.parcel));
    if(lost.length>0)
     mention('ASSIGNMENT_REMOVED_EXISTING_MEMBERSHIP',{removed:lost.length});
   } else if(action==='CANCEL_OPEN'&&!r.skipped){
    if(r.ok===true&&after.parcels.filter(p=>p.status==='cancelled').length<
       before.parcels.filter(p=>p.status==='cancelled').length+1)
     mention('CANCEL_RETURNED_OK_WITHOUT_STATUS_DELTA',{cancelledBefore:
      before.parcels.filter(p=>p.status==='cancelled').length,
      cancelledAfter:after.parcels.filter(p=>p.status==='cancelled').length});
    if(added.length!==0)
     mention('CANCELLATION_CREATED_MEMBERSHIP',{newMemberships:added.length});
   }
   before=after;
  }
 }
 const groups=Object.create(null);
 for(const f of findings)groups[f.rule]=(groups[f.rule]||0)+1;
 return {contract:'komerce-business-sequence-exploration-verdict/v14',
  scope:'CANONICAL_PG_REAL_OWNERS_SINGLE_CONNECTION',
  plannedCases:plans.length,evaluatedSteps:Object.values(eventCounts).reduce((a,b)=>a+b,0),
  eventCounts,signalCounts:groups,
  totalSignals:findings.length,
  knownFamilySignals:findings.filter(x=>x.previouslyKnownFamily).length,
  candidateNewFamilySignals:findings.filter(x=>!x.previouslyKnownFamily).length,
  findings,exceptions,
  productionIncidentConfirmed:false,
  generalBusinessCoverageComplete:false,
  note:'Unknown-family signals require human reproduction and business-invariant acceptance; none is automatically a confirmed bug'};
}
module.exports={inspect,validateSnapshot,KNOWN};
