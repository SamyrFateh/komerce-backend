'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {barrier}=require('./v15-concurrency-runner');
const {inspect}=require('./v15-concurrency-predicate');
function example(race=31){
 const entry=(mode,arrived,counts)=>({
  mode,arrived,carrierParcel:'P0',orderA:'A',orderB:'B',cleanup:{verified:true,remaining:{}},
  before:{parcels:[{id:'P0',status:'preparation',members:29}],total:29,assignedByOrder:[]},
  after:{parcels:counts.map((n,i)=>({id:i?'P1':'P0',status:'preparation',members:n})),
   total:31,assignedByOrder:[{order:'A',members:1},{order:'B',members:1}]},
  outcomes:[{target:'A',status:'fulfilled',result:{success:true,items_assigned:1}},
   {target:'B',status:'fulfilled',result:{success:true,items_assigned:1}}]});
 return {contract:'komerce-canonical-pg-concurrency-raw/v15',
  scope:'ACTUAL_OWNER_CANONICAL_PG_TWO_INDEPENDENT_CONNECTIONS',
  onlyLocalTestDb:true,allFixturesDeleted:true,routeHttpExecuted:false,
  productionIncidentConfirmed:false,preseed:29,limitFromActualOwner:30,
  cases:[entry('SEQUENTIAL_CONTROL',0,[30,1]),
   entry('FORCED_TWO_CONNECTION_RACE',2,race===31?[31]:[30,1])]};
}
test('sequential control conforms, synchronized race exceeds owner capacity',()=>{
 const r=inspect(example());
 assert.equal(r.sequential.maximum,30);assert.equal(r.concurrent.maximum,31);
 assert.equal(r.verdict,'REPRODUCED_CANONICAL_PG_CONCURRENT_CAPACITY_BREACH');
 assert.equal(r.novelFamilyCandidate,true);assert.equal(r.productionIncidentConfirmed,false);
});
test('same independent oracle accepts a corrected owner that rechecks capacity inside atomic section',()=>{
 const r=inspect(example(30));
 assert.equal(r.verdict,'CONTROLLED_CONCURRENT_PG_CAPACITY_SATISFIED');
 assert.equal(r.novelFamilyCandidate,false);
});
test('broken fixture is a tool error, not an interesting new business bug',()=>{
 const x=example();x.cases[1].after.total=32;
 assert.throws(()=>inspect(x),/TOOL_ERROR/);
 const y=example();y.cases[1].arrived=1;
 assert.throws(()=>inspect(y),/TOOL_ERROR/);
 const z=example();z.allFixturesDeleted=false;
 assert.throws(()=>inspect(z),/TOOL_ERROR/);
});
test('barrier releases two independent racing callers',async()=>{
 const sync=barrier(2,1000),hit=[];
 await Promise.all([sync.wait().then(()=>hit.push('A')),sync.wait().then(()=>hit.push('B'))]);
 assert.equal(sync.arrived,2);assert.equal(hit.length,2);
});
