'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {preflightOnly}=require('./v23-preflight-mutant');
test('negative-control mutant rejects a sequential refund already recorded, no owner call',async()=>{
  let ownerCalls=0;
  const owner=async()=>{ownerCalls++;return {status:200}};
  const guarded=preflightOnly(owner);
  const result=await guarded({orderId:'o1',db:{query:async(q,ids)=>{
    assert.match(q,/FROM refunds/);assert.deepEqual(ids,['o1']);
    return {rows:[{id:'r1'}]};
  }}});
  assert.equal(result.status,409);
  assert.equal(ownerCalls,0);
});
test('negative-control mutant still calls owner if concurrent refund is not yet recorded',async()=>{
  let ownerCalls=0;
  const guarded=preflightOnly(async()=>{ownerCalls++;return {status:200}});
  const r=await guarded({orderId:'o2',db:{query:async()=>({rows:[]})}});
  assert.equal(r.status,200);assert.equal(ownerCalls,1);
});
test('missing refund read is not silently interpreted as permission',async()=>{
  const guard=preflightOnly(async()=>({status:200}));
  await assert.rejects(()=>guard({orderId:'o',db:{query:async()=>({})}}),/TOOL_ERROR/);
  await assert.rejects(()=>guard({orderId:'o'}),/TOOL_ERROR/);
  assert.throws(()=>preflightOnly(null),/TOOL_ERROR/);
});
