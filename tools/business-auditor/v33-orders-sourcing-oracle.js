'use strict';
/** Independent V3.3 oracles. No source service imported, SQL snapshots are truth.
 * A source bug found in a clone is BUSINESS_VIOLATION, not a test tool failure.
 */
const tool=e=>{throw Error('V33_ORACLE_TOOL_ERROR: '+e)};
function base(x){
 if(x?.contract!=='komerce-orders-sourcing-physical/v33'||
  !x.ownerInvoked||!x.canonicalPg||!x.noExternalNetwork||
  x.noProductionTouch!==true||x.authenticatedHttpRouteTested!==false||
  !x.before||!x.ids)tool('source/physical provenance missing');
}
function orderOracle(x){
 base(x);if(x.mode!=='ORDER'||!x.afterRejected||!x.afterAccepted||!x.final)
  tool('order snapshots incomplete');
 const s=[],before=x.before,rejected=x.afterRejected,accepted=x.afterAccepted,final=x.final;
 if(before.order?.status!=='confirmed'||before.events.length!==0||
  !x.invalid||!x.unauthorized||!x.accepted||!x.replay||!x.rewind)
  tool('order nominal and adversarial inputs absent');
 if(x.invalid.success||x.unauthorized.success||
  rejected.order.status!=='confirmed'||rejected.events.length!==0)
  s.push('ORD1_FORBIDDEN_TRANSITION_OR_ROLE_MUTATED_ORDER');
 if(!x.accepted.success||x.accepted.noop||
  accepted.order.status!=='ordered'||!accepted.order.ordered_at||
  accepted.events.length!==1||
  accepted.events[0].status!=='ordered')
  s.push('ORD2_VALID_TRANSITION_LACKS_CANONICAL_HISTORY');
 if(!x.replay.success||!x.replay.noop||
  !x.rewind.success||!x.rewind.noop||
  final.order.status!=='ordered'||final.events.length!==1||
  final.events[0].status!=='ordered'||
  String(final.order.ordered_at)!==String(accepted.order.ordered_at))
  s.push('ORD3_IDEMPOTENT_REPLAY_OR_BACKWARD_SCAN_CHANGED_STATE');
 if(accepted.events.length&&accepted.events[0].changed_by!==null)
  s.push('ORD4_INCORRECT_ACTOR_ATTRIBUTION');
 return {contract:'komerce-independent-order-transition-oracle/v33',
  signals:[...new Set(s)],violation:s.length>0,historyCount:final.events.length,
  finalStatus:final.order.status,scope:'CONFIRMED_TO_ORDERED_PATCH_AND_REPLAY_ONLY'};
}
function sourcingOracle(x){
 base(x);if(x.mode!=='SOURCING'||!x.after||!Array.isArray(x.before.candidates)||
  !Array.isArray(x.after.candidates)||!Array.isArray(x.after.events))
  tool('sourcing canonical audit snapshots missing');
 const states=Object.fromEntries(x.before.candidates.map(c=>[c.supplier_product_id,c]));
 const after=Object.fromEntries(x.after.candidates.map(c=>[c.supplier_product_id,c]));
 if(!['MISSING','KEEP','PUBLISHED','REJECTED'].every(k=>states[k]&&after[k])||
  states.MISSING.state!=='raw_imported'||states.KEEP.state!=='scanned'||
  states.PUBLISHED.state!=='imported_to_catalog'||states.REJECTED.state!=='rejected'||
  x.before.events.length!==0)tool('four independent lifecycle preconditions absent');
 const s=[];
 if(x.archived!==1||after.MISSING.state!=='archived'||
  after.KEEP.state!=='scanned'||after.PUBLISHED.state!=='imported_to_catalog'||
  after.REJECTED.state!=='rejected')
  s.push('SRC1_FULL_SNAPSHOT_ARCHIVE_PROTECTION_BROKEN');
 if(x.after.candidates.length!==4||x.after.events.length!==1)
  s.push('SRC2_ARCHIVE_EVENT_COUNT_OR_IDENTITY_INCORRECT');
 const e=x.after.events.find(z=>z.supplier_product_id==='MISSING');
 if(!e||e.old_state!=='raw_imported'||e.new_state!=='archived'||
  e.event_type!=='state_change')
  s.push('SRC3_ARCHIVE_EVENT_OLD_STATE_LOST');
 // All original payloads must survive state and audit writes.
 for(const id of ['MISSING','KEEP','PUBLISHED','REJECTED']){
  if(JSON.stringify(after[id].raw_payload)!==JSON.stringify(states[id].raw_payload)||
   after[id].product_id!==states[id].product_id)
   s.push('SRC4_SOURCE_PROVENANCE_OR_PRODUCT_LINK_CHANGED');
 }
 return {contract:'komerce-independent-sourcing-archive-oracle/v33',
  signals:[...new Set(s)],violation:s.length>0,
  expectedOldState:'raw_imported',persistedOldState:e?.old_state||null,
  archiveCount:x.archived,protectedStatesUnchanged:
   after.PUBLISHED.state==='imported_to_catalog'&&after.REJECTED.state==='rejected',
  scope:'FULL_SNAPSHOT_ARCHIVE_EVENT_PROVENANCE_NOT_FULL_REFINERY_CERTIFICATION'};
}
function inspect(x){return x?.mode==='ORDER'?orderOracle(x):
 x?.mode==='SOURCING'?sourcingOracle(x):tool('unknown mode')}
function counterfeit(x){
 const z=structuredClone(x);
 if(x.mode==='ORDER'){
  z.final.events.push({status:'ordered',changed_by:null,note:'forged replay'});
  return {name:'FORGED_DUPLICATE_HISTORY',signals:inspect(z).signals};
 }
 if(x.mode==='SOURCING'){
  const row=z.after.events.find(e=>e.supplier_product_id==='MISSING');
  if(!row)tool('missing archive event for counterfactual');
  row.old_state='raw_imported';
  const corrected=inspect(z);
  z.after.candidates.find(c=>c.supplier_product_id==='PUBLISHED').state='archived';
  const forged=inspect(z);
  return {name:'CORRECTED_OLD_STATE_THEN_FORGED_TERMINAL_ARCHIVE',
   correctedSignals:corrected.signals,forgedSignals:forged.signals,
   correctedContractWouldPass:!corrected.violation};
 }
 tool('unknown mutant')
}
module.exports={orderOracle,sourcingOracle,inspect,counterfeit};
