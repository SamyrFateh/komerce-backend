'use strict';
/**
 * Independent business invariants for parcel-assignment result vs actual
 * canonical PostgreSQL effects. Never imports service code.
 * Domain rule: success must not masquerade as "this request assigned item"
 * when the INSERT changed zero rows. A zero-insert result with pre-existing
 * active membership can be classified as already_assigned (single-item fixture).
 */
function checkMembership(raw){
 if(!raw||!raw.fixture||raw.fixture.itemCount!==1||
  !raw.realOwnerCalled||!raw.realCanonicalSchema||raw.sessionCount!==2||
  !raw.after||!raw.before||!raw.response||
  !Array.isArray(raw.physicalRows)||raw.ownerInsertCalls<1||
  raw.physicalRows.some(n=>!Number.isInteger(n)||n<0||n>1))
  throw Error('V27_ORACLE_TOOL_ERROR: incomplete physical proof');
 const x=raw.response,b=raw.before,a=raw.after;
 const signals=[];
 const total=raw.physicalRows.reduce((sum,n)=>sum+n,0);
 if(total!==raw.ownerInserted)throw Error('V27_ORACLE_TOOL_ERROR: physical rowCount drift');
 if(!Number.isInteger(x.items_assigned)||x.items_assigned!==total)
  signals.push('L1_REPORTED_ASSIGNMENTS_DO_NOT_MATCH_OWNER_INSERTS');
 // A successful request that did NOT insert a membership must classify an
 // already-present active assignment, otherwise success is misleading.
 if(x.success===true&&x.queued!==true&&x.already_assigned!==true&&total===0)
  signals.push('L2_SUCCESS_WITHOUT_WRITE_OR_IDEMPOTENT_CLASSIFICATION');
 // A truthful outcome must result in the single ordered item being present
 // in one active parcel; an existing cancelled membership is not coverage.
 if(x.success===true&&x.queued!==true&&a.activeCount!==1)
  signals.push('L3_ORDER_NOT_IN_EXACTLY_ONE_ACTIVE_PARCEL');
 if(x.already_assigned===true&&a.activeCount!==1)
  signals.push('L4_IDEMPOTENT_RESULT_WITHOUT_ACTIVE_MEMBERSHIP');
 if(x.items_assigned>0&&a.openCount!==1)
  signals.push('L5_REPORTED_TARGET_MEMBERSHIP_MISSING');
 return {mode:raw.mode,signals,violation:signals.length>0,
  ownerInserted:total,reported:x.items_assigned,
  activeBefore:b.activeCount,activeAfter:a.activeCount,
  ownerSuccess:x.success,alreadyAssigned:Boolean(x.already_assigned),
  authority:'INDEPENDENT_CANONICAL_PG_MEMBERSHIP_ORACLE',
  productionIncidentConfirmed:false};
}
module.exports={checkMembership};
