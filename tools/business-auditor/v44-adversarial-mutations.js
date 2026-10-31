'use strict';
/**
 * Adversarial inventory source mutations, isolated from the G3 fixture
 * generator and G3 internal two-mutant calibration. This is an inspectable
 * held-out regression set, NOT a sealed independent blind benchmark.
 */
const cases=Object.freeze([
 {id:'SKIP_ASSIGNMENT',truth:'VIOLATION',class:'assignment-omission',
  from:'const proposal = await proposeAssignment(inv.id, client);',
  to:'const proposal = null;'},
 {id:'WRONG_BUFFER_STATUS',truth:'VIOLATION',class:'persisted-state',
  from:"SET status = 'buffered', buffer_reason",
  to:"SET status = 'received', buffer_reason"},
 {id:'BAD_BUFFER_REASON',truth:'VIOLATION',class:'buffer-reason',
  from:"buffer_reason = 'no_compatible_parcel', buffer_until",
  to:"buffer_reason = 'unexpected', buffer_until"},
 {id:'DUPLICATE_ITEM',truth:'VIOLATION',class:'duplicate-reception',
  from:'const proposal = await proposeAssignment(inv.id, client);',
  to:`await client.query(
      "INSERT INTO inventory_items (id, order_item_id, order_id, status, received_at) VALUES (gen_random_uuid(), $1, $2, 'received', NOW())",
      [order_item_id, oi.order_id]);
    const proposal = await proposeAssignment(inv.id, client);`},
 {id:'FAKE_PROPOSAL',truth:'VIOLATION',class:'response-state-drift',
  from:'return { item: inv, proposal };',
  to:"return { item: inv, proposal: { status: 'proposed' } };"},
 {id:'EQUIV_INITIAL_BUFFERED',truth:'EQUIVALENT_ON_FIXTURES',class:'equivalent-initial-state',
  from:"VALUES (gen_random_uuid(), $1, $2, 'received', NOW())",
  to:"VALUES (gen_random_uuid(), $1, $2, 'buffered', NOW())"},
 {id:'EQUIV_SQL_TIMESTAMP',truth:'EQUIVALENT_ON_FIXTURES',class:'equivalent-timestamp',
  from:"VALUES (gen_random_uuid(), $1, $2, 'received', NOW())",
  to:"VALUES (gen_random_uuid(), $1, $2, 'received', CURRENT_TIMESTAMP)"}
]);
function mutate(source,id){
 const item=cases.find(x=>x.id===id);
 if(!item)throw Error('V44_MUTANT_UNKNOWN');
 if(typeof source!=='string'||source.split(item.from).length!==2)
  throw Error('V44_MUTANT_ANCHOR_NON_UNIQUE: '+id);
 return source.replace(item.from,item.to);
}
function judge(results){
 if(!Array.isArray(results)||results.length!==cases.length)throw Error('V44_INVALID_RESULTS');
 const records=[],seen=new Set();
 for(const r of results){
  const c=cases.find(x=>x.id===r.id);
  if(!c||seen.has(r.id)||!Array.isArray(r.executions)||r.executions.length!==2)
   throw Error('V44_INVALID_CASE_OR_FIXTURE_COUNT');
  seen.add(r.id);
  if(r.executions.some(x=>!x.cloneDropped||!x.realOwnerCalled||!x.canonicalPostgres))
   throw Error('V44_PHYSICAL_PROVENANCE_MISSING');
  const detected=r.executions.filter(x=>x.verdict==='BUSINESS_VIOLATION').length;
  records.push({id:r.id,truth:c.truth,class:c.class,detected,
   tried:r.executions.length,signals:r.executions.map(x=>x.oracle.signals)});
 }
 const positives=records.filter(x=>x.truth==='VIOLATION');
 const equivalents=records.filter(x=>x.truth==='EQUIVALENT_ON_FIXTURES');
 return {records,summary:{realFaults:positives.length,
  truePositive:positives.filter(x=>x.detected===x.tried).length,
  falseNegative:positives.filter(x=>x.detected!==x.tried).length,
  equivalents:equivalents.length,
  falsePositive:equivalents.filter(x=>x.detected!==0).length,
  status:positives.every(x=>x.detected===x.tried)&&
   equivalents.every(x=>x.detected===0)?'PASS_ADVERSARIAL_INVENTORY':'FAIL'}};
}
module.exports={cases,mutate,judge};
