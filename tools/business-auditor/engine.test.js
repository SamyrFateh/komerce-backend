'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {RULES,validateReadOnlySql,scanData,withReadOnlyTransaction,reportMarkdown}=require('./engine');
test('auditor ships seven traceable independent P1-P7 SQL rules',()=>{
 assert.equal(RULES.length,7);
 assert.equal(new Set(RULES.map(x=>x.id)).size,RULES.length);
 assert.ok(RULES.every(x=>x.issue&&x.boundary&&x.owner&&x.grain&&validateReadOnlySql(x.sql)));
});
test('static SQL guard rejects mutations, extra statements and unbounded SELECT',()=>{
 for(const sql of ['UPDATE orders SET status = 1','SELECT 1; DELETE FROM orders',
  'SELECT x FROM orders', 'SELECT 1 INTO TEMP foo LIMIT $1','CREATE TABLE x (a int)']){
  assert.equal(validateReadOnlySql(sql),false,sql);
 }
});
test('one mismatching cost yields a classified signal with evidence grain',async()=>{
 const seen=[];
 const client={query:async(sql,params)=>{seen.push({sql,params});
  return {rows:[{ref:'allocation-uuid'}]};}};
 const data=await scanData(client,{ruleIds:['KBA-001'],sampleLimit:2});
 assert.equal(data[0].status,'DATA_INTEGRITY_SIGNAL');
 assert.equal(data[0].detectedAtLeast,1);
 assert.equal(data[0].confirmedBusinessBug,false);
 assert.deepEqual(data[0].samples,['allocation-uuid']);
 assert.deepEqual(seen[0].params,[3]);
});
test('zero matches is no signal for that RULE, never global certification',async()=>{
 const data=await scanData({query:async()=>({rows:[]})},{ruleIds:['KBA-004']});
 assert.equal(data[0].status,'NO_SIGNAL_IN_SAMPLE_QUERY');
 assert.equal(data[0].confirmedBusinessBug,false);
});
test('limit +1 flags truncated samples and lower bound, never exact global count',async()=>{
 const data=await scanData({query:async()=>({rows:[
  {ref:'id1'},{ref:'id2'},{ref:'id3'}]})},{ruleIds:['KBA-001'],sampleLimit:2});
 assert.equal(data[0].detectedAtLeast,3);
 assert.equal(data[0].sampleTruncated,true);
 assert.equal(data[0].exhaustiveCount,false);
 assert.deepEqual(data[0].samples,['id1','id2']);
});
test('malformed data and unknown requested SQL rule fail closed',async()=>{
 await assert.rejects(scanData({query:async()=>({rows:[{ref:1}]})},{ruleIds:['KBA-003']}),/Malformed evidence/);
 await assert.rejects(scanData({query:async()=>({rows:[]})},{ruleIds:['OTHER']}),/Unknown rules/);
 await assert.rejects(scanData({query:async()=>({rows:[]})},{sampleLimit:101}),/sampleLimit/);
});
test('read-only snapshot verifies server state then rolls back and releases',async()=>{
 const calls=[];let released=0;
 const client={query:async(sql)=>{
  calls.push(sql);
  if(sql.includes('current_setting'))return {rows:[{value:'on'}]};
  return {rows:[]};
 },release:()=>{released++}};
 const result=await withReadOnlyTransaction({connect:async()=>client},async tx=>{
  assert.equal(tx,client);return 'OK';
 });
 assert.equal(result,'OK');assert.equal(released,1);
 assert.equal(calls[0],'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
 assert.ok(calls.includes('ROLLBACK'));
});
test('query failure still rolls back and releases (no positive report)',async()=>{
 const calls=[];let released=0;
 const client={query:async sql=>{
  calls.push(sql);
  if(sql.includes('current_setting'))return {rows:[{value:'on'}]};
  if(sql==='BREAK')throw Error('simulated SQL failure');
  return {rows:[]};
 },release:()=>{released++}};
 await assert.rejects(withReadOnlyTransaction({connect:async()=>client},
  async tx=>{await tx.query('BREAK')}),/simulated SQL failure/);
 assert.ok(calls.includes('ROLLBACK'));assert.equal(released,1);
});
test('refuse to proceed if PostgreSQL does not attest READ ONLY',async()=>{
 let released=0;let rolled=false;
 const client={query:async sql=>{
  if(sql.includes('current_setting'))return {rows:[{value:'off'}]};
  if(sql==='ROLLBACK')rolled=true;
  return {rows:[]};
 },release:()=>released++};
 await assert.rejects(withReadOnlyTransaction({connect:async()=>client},async()=>true),/READ ONLY/);
 assert.equal(rolled,true);assert.equal(released,1);
});
test('markdown report explicitly warns against automatic bug confirmation',()=>{
 const report={contract:'test',mode:'data',git:{sha:'abc'},
  summary:{staticFilesReviewed:null,staticSuspicions:null,dataRulesExecuted:1,rulesWithEvidence:1},
  data:{results:[{id:'KBA-001',boundary:'P3_P6_PURCHASE_COST',priority:'P1',
   status:'DATA_INTEGRITY_SIGNAL',detectedAtLeast:1,samples:['cost-1'],issue:3064}]}};
 const text=reportMarkdown(report);
 assert.match(text,/KBA-001/);assert.match(text,/cost-1/);
 assert.match(text,/jamais une certification métier automatique/);
});

test('PayPal owner-chain evidence appears in Markdown but never claims PSP duplicate',()=>{
 const report={contract:'komerce-independent-business-auditor/v1',mode:'code',
  git:{sha:'test'},summary:{staticFilesReviewed:1,staticSuspicions:0,
   dataRulesExecuted:null,rulesWithEvidence:0},
  code:{paypalRefundBoundary:{
   id:'KBA-C03',owner:'Refunds / PayPal',
   status:'LIVE_LEGACY_CALL_WITHOUT_DURABLE_REQUEST_KEY',
   observations:{routeConnected:true,ownerPassesStableProviderKey:false,
    ownerReservesDurableIntent:false,ownerClaimsDurableIntent:false,
    clientHasTimestampFallback:true},
   nextProof:'mocked timeout replay only',
  }},
 };
 const md=reportMarkdown(report);
 assert.match(md,/KBA-C03/);
 assert.match(md,/LIVE_LEGACY_CALL_WITHOUT_DURABLE_REQUEST_KEY/);
 assert.match(md,/Remboursement PSP réellement dupliqué démontré : \*\*NON\*\*/);
 assert.match(md,/mocked timeout replay only/);
});
