'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {parseArgs,assertLocalTestTarget,execute}=require('./p1-p7-audit-once');
const UUID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const args=['--market','KM','--product',UUID,'--order-ref','CMD-KM-1','--order-item',UUID];
const env={NODE_ENV:'test',KOMERCE_DISABLE_CRONS:'true',
 DATABASE_URL:'postgresql://user:pass@127.0.0.1:5432/komerce_test'};
test('command requires all identifiers without silently selecting an order',()=>{
 assert.deepEqual(parseArgs(args),{marketCode:'KM',productId:UUID,orderReference:'CMD-KM-1',orderItemId:UUID});
 assert.throws(()=>parseArgs(args.slice(0,-2)),/All exact/);
 assert.throws(()=>parseArgs([...args,'--product',UUID]),/Usage/);
 assert.throws(()=>parseArgs([...args,'--limit','10']),/Usage/);
});
test('rejects staging, production, unknown DB and disabled read-only safety',()=>{
 assertLocalTestTarget(env);
 for(const url of ['postgresql://u@prod.rlwy.net/komerce_test',
  'postgresql://u@localhost/railway','postgresql://u@localhost/komerce',
  'postgresql://u@foo.internal/komerce_test']) {
  assert.throws(()=>assertLocalTestTarget({...env,DATABASE_URL:url}),/Only local/);
 }
 assert.throws(()=>assertLocalTestTarget({...env,NODE_ENV:'production'}),/requires NODE_ENV/);
 assert.throws(()=>assertLocalTestTarget({...env,KOMERCE_DISABLE_CRONS:'false'}),/requires NODE_ENV/);
});
test('executes injected scanner only after BEGIN READ ONLY and always rolls back',async()=>{
 const seen=[];
 const client={query:async(sql)=>{seen.push(sql);return {rows:[]}},release:()=>seen.push('RELEASE')};
 const result=await execute(args,env,{
  db:{connect:async()=>client},
  collect:async(db,exact)=>{
   assert.equal(db,client);
   assert.equal(exact.marketCode,'KM');
   seen.push('CANONICAL_READ');
   return {totals:{seams:13,observed:4,notWired:9},owner_read_errors:[]};
  }
 });
 assert.deepEqual(seen,[
   'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
   "SET LOCAL statement_timeout = '15000ms'",
   'CANONICAL_READ','ROLLBACK','RELEASE'
 ]);
 assert.equal(result.localTestOnly,true);
 assert.equal(result.command,'audit:logic:p1p7');
});
test('read failure still rolls back and releases connection',async()=>{
 const seen=[],client={query:async(s)=>{seen.push(s)},release:()=>seen.push('RELEASE')};
 await assert.rejects(()=>execute(args,env,{
  db:{connect:async()=>client},collect:async()=>{throw Error('owner unavailable')}
 }),/owner unavailable/);
 assert.deepEqual(seen.slice(-2),['ROLLBACK','RELEASE']);
});
