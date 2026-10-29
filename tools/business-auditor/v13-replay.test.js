'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {parse,signature}=require('./v13-replay');
test('replay CLI requires explicit output and rejects unknown switches',()=>{
 assert.deepEqual(parse(['--out','/tmp/probe','--against','/tmp/proof.json']),{
  out:'/tmp/probe',against:'/tmp/proof.json'});
 assert.throws(()=>parse([]),/Output directory required/);
 assert.throws(()=>parse(['--mystery','x']),/Usage/);
});
function verdict(id){
 const f=()=>({status:'ordered',activeMemberships:1,cancelledMemberships:0,
  emptyOpenParcels:0,openParcels:1,representedParcelIds:[id]});
 return {verdict:'CONTROLLED_CANONICAL_PG_SEQUENCE_SATISFIED',
  issues:[],stepsEvaluated:6,evidenceLevel:'REAL_CANONICAL_PG_SINGLE_CONNECTION_REAL_SERVICES_ROLLBACK',
  facts:{nominal_initial:f(),nominal_retry:f(),before_cancel:f(),after_cancel:f(),after_redistribute:f(),after_repeat:f()}};
}
test('replay signature ignores random fixture UUIDs but detects state drift',()=>{
 const a=verdict('random-id-1'),b=verdict('random-id-2');
 assert.equal(signature(a),signature(b));
 b.facts.after_redistribute.activeMemberships=0;
 assert.notEqual(signature(a),signature(b));
});
