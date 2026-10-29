'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {inspect,evaluate}=require('./v17-quantity-matrix-predicate');
const {cases}=require('./v17-quantity-matrix-runner');
function makeCase(d,usedOriginal) {
 const original={original:true,status:'preparation',
  lines:d.rows+(usedOriginal?1:0),
  units:d.rows*d.existingQty+(usedOriginal?d.incomingQty:0)};
 return {key:d.key,dimensions:d,rollbackVerified:true,cloneDropped:true,
  before:{lines:d.rows,units:d.rows*d.existingQty},
  after:usedOriginal?[original]:[original,{original:false,status:'preparation',
   lines:1,units:d.incomingQty}],
  incoming:{assignments:1,units:d.incomingQty},
  service:{success:true,created:!usedOriginal,usedOriginalParcel:usedOriginal,
   queued:false,alreadyAssigned:false,reportedAssigned:1}};
}
const raw=()=>({contract:'komerce-generated-capacity-data-raw/v17',
 schema:'CANONICAL_POSTGRESQL_16',dbLocalOnly:true,allClonesDropped:true,
 actualBusinessPolicyApproved:false,concurrentSessions:false,
 routeHttpExecuted:false,productionIncidentConfirmed:false,
 cases:cases().map(d=>makeCase(d,d.rows+d.incomingQty<=30))});
test('generator explores 12 independent combinations including 9x3+5 and 26x1+5',()=>{
 const c=cases();
 assert.equal(c.length,12);
 assert.ok(c.some(x=>x.rows===9&&x.existingQty===3&&x.incomingQty===5));
 assert.ok(c.some(x=>x.rows===26&&x.existingQty===1&&x.incomingQty===5));
});
test('realistic 9x3 plus 5 correctly signals units breach from valid baseline',()=>{
 const d=cases().find(x=>x.rows===9&&x.existingQty===3&&x.incomingQty===5);
 const x=evaluate(makeCase(d,true));
 assert.equal(x.baseline.units,27);
 assert.equal(x.physical.originalUnits,32);
 assert.ok(x.signals.includes('UNITS_EXCEED_30_FROM_VALID_PRESTATE'));
 assert.equal(x.linePolicy.reusePossible,true);
});
test('26 existing lines and one incoming item of 5 units triggers line-policy refusal',()=>{
 const d=cases().find(x=>x.rows===26&&x.existingQty===1&&x.incomingQty===5);
 const x=evaluate(makeCase(d,false));
 assert.ok(x.signals.includes('REUSE_REFUSED_UNDER_LINE_CAPACITY_POLICY'));
 assert.ok(!x.signals.includes('REUSE_REFUSED_UNDER_UNIT_CAPACITY_POLICY'));
});
test('no business policy is silently approved by divergent alternative oracles',()=>{
 const x=inspect(raw());
 assert.equal(x.evaluatedCases,12);
 assert.equal(x.approvedCapacityPolicy,null);
 assert.equal(x.semanticVerdict,'NO_SINGLE_POLICY_SATISFIED');
 assert.ok(x.counts.UNITS_EXCEED_30_FROM_VALID_PRESTATE>=1);
 assert.ok(x.counts.REUSE_REFUSED_UNDER_LINE_CAPACITY_POLICY>=1);
});
test('mismatched SQL counts and a missing generated combination invalidate proof',()=>{
 const a=raw();a.cases[0].before.units++;
 assert.throws(()=>inspect(a),/TOOL_ERROR/);
 const b=raw();b.cases.pop();
 assert.throws(()=>inspect(b),/TOOL_ERROR/);
});

test('corrected owner may queue without any physical assignment; it is not TOOL_ERROR',()=>{
 const d=cases().find(x=>x.rows===26&&x.existingQty===1&&x.incomingQty===5);
 const x=makeCase(d,false);
 x.after=x.after.filter(p=>p.original);
 x.incoming={assignments:0,units:0};
 x.service={success:true,queued:true,alreadyAssigned:false,
  created:false,usedOriginalParcel:false,reportedAssigned:null};
 const verdict=evaluate(x);
 assert.equal(verdict.physical.assigned,0);
 assert.equal(verdict.service.queued,true);
 assert.ok(verdict.signals.includes('REUSE_REFUSED_UNDER_LINE_CAPACITY_POLICY'));
 assert.ok(!verdict.signals.includes('REUSE_REFUSED_UNDER_UNIT_CAPACITY_POLICY'));
});
test('rejected allocation with unchanged DB is a business observation, not tool error',()=>{
 const d=cases().find(x=>x.rows===29&&x.existingQty===1&&x.incomingQty===5);
 const x=makeCase(d,false);
 x.after=x.after.filter(p=>p.original);
 x.incoming={assignments:0,units:0};
 x.service={success:false,queued:false,created:false,
   usedOriginalParcel:false,reportedAssigned:null};
 assert.equal(evaluate(x).physical.assigned,0);
});
