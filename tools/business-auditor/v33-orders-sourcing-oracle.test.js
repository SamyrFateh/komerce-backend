'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {inspect,counterfeit}=require('./v33-orders-sourcing-oracle');
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const item=(id,state)=>({id:uuid(10+id.charCodeAt(0)),supplier_product_id:id,
 state,raw_payload:{id},product_id:null});
function order(){
 const before={order:{status:'confirmed'},events:[]};
 const accepted={order:{status:'ordered',ordered_at:'2026-01-01T01:00:00Z'},
  events:[{status:'ordered',changed_by:null}]};
 return {contract:'komerce-orders-sourcing-physical/v33',
  ownerInvoked:true,canonicalPg:true,noExternalNetwork:true,noProductionTouch:true,
  authenticatedHttpRouteTested:false,mode:'ORDER',ids:{order:uuid(1)},
  before,invalid:{success:false},unauthorized:{success:false},
  afterRejected:{order:{status:'confirmed'},events:[]},
  accepted:{success:true,noop:false},afterAccepted:accepted,
  replay:{success:true,noop:true},rewind:{success:true,noop:true},
  final:structuredClone(accepted)};
}
function sourcing(old='archived'){
 const items=[item('MISSING','raw_imported'),item('KEEP','scanned'),
  item('PUBLISHED','imported_to_catalog'),item('REJECTED','rejected')];
 return {contract:'komerce-orders-sourcing-physical/v33',
  ownerInvoked:true,canonicalPg:true,noExternalNetwork:true,noProductionTouch:true,
  authenticatedHttpRouteTested:false,mode:'SOURCING',ids:{supplier:'V33'},
  before:{candidates:items,events:[]},
  archived:1,
  after:{candidates:items.map(x=>({...x,raw_payload:{...x.raw_payload},state:x.supplier_product_id==='MISSING'?'archived':x.state})),
   events:[{supplier_product_id:'MISSING',old_state:old,new_state:'archived',
    event_type:'state_change'}]}};
}
test('canonical status confirmation->ordered, role 403-equivalent guard and replay pass',()=>{
 const r=inspect(order());
 assert.equal(r.violation,false);
 assert.equal(r.historyCount,1);
});
test('forged duplicated history on retry is not accepted as idempotent',()=>{
 assert.ok(counterfeit(order()).signals.includes('ORD3_IDEMPOTENT_REPLAY_OR_BACKWARD_SCAN_CHANGED_STATE'));
});
test('forbidden status mutation is detected despite unchanged owner error text',()=>{
 const x=order();x.afterRejected.order.status='shipped';
 assert.ok(inspect(x).signals.includes('ORD1_FORBIDDEN_TRANSITION_OR_ROLE_MUTATED_ORDER'));
});
test('sourcing archived state is correct but SQL audit old_state gets lost',()=>{
 const x=inspect(sourcing());
 assert.deepEqual(x.signals,['SRC3_ARCHIVE_EVENT_OLD_STATE_LOST']);
 assert.equal(x.persistedOldState,'archived');
 assert.equal(x.expectedOldState,'raw_imported');
});
test('corrected old_state is accepted while fake archived terminal still fails',()=>{
 const x=counterfeit(sourcing());
 assert.equal(x.correctedContractWouldPass,true);
 assert.ok(x.forgedSignals.includes('SRC1_FULL_SNAPSHOT_ARCHIVE_PROTECTION_BROKEN'));
});
test('protected imported and rejected candidates must survive snapshot',()=>{
 const x=sourcing('raw_imported');x.after.candidates.find(c=>c.supplier_product_id==='REJECTED').state='archived';
 assert.ok(inspect(x).signals.includes('SRC1_FULL_SNAPSHOT_ARCHIVE_PROTECTION_BROKEN'));
});
test('missing physical provenance is TOOL ERROR not business pass',()=>{
 const x=sourcing();x.ownerInvoked=false;
 assert.throws(()=>inspect(x),/V33_ORACLE_TOOL_ERROR/);
});
test('oracle recognizes absent journal as independent defect',()=>{
 const x=sourcing();x.after.events=[];
 assert.ok(inspect(x).signals.includes('SRC2_ARCHIVE_EVENT_COUNT_OR_IDENTITY_INCORRECT'));
});
