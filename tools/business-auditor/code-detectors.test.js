'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path');
const {detectIgnoredInsertCount,scanRelevantCode}=require('./code-detectors');
const sql=['INSERT','INTO','parcel_items','(parcel_id,order_item_id)',
 'VALUES ($1,$2)','ON','CONFLICT','DO','NOTHING'].join(' ');
test('detect ignored conflict as assigned++ without verifying affected row count',()=>{
 const src='async function assign(){await client.query("'+sql+'",[]);assigned++;}';
 const out=detectIgnoredInsertCount(src,'services/example.js');
 assert.equal(out.length,1);
 assert.equal(out[0].id,'KBA-C01');
 assert.equal(out[0].counter,'assigned');
 assert.equal(out[0].verifiedBusinessBug,false);
});
test('no report when insert count is actually checked',()=>{
 const src='const result=await query("'+sql+'");if(result.rowCount)assigned++;';
 assert.deepEqual(detectIgnoredInsertCount(src,'services/good.js'),[]);
});
test('no report on non-parcel benign ignore or simple insertion',()=>{
 const query=['INSERT','INTO','orders','(id)','VALUES ($1)','ON','CONFLICT','DO','NOTHING'].join(' ');
 assert.deepEqual(detectIgnoredInsertCount('await query("'+query+'");assigned++;','services/other.js'),[]);
 assert.deepEqual(detectIgnoredInsertCount('await query("INSERT INTO parcel_items");assigned++;','services/good.js'),[]);
});
test('real tracked Komerce code has two different count-after-conflict source sites',()=>{
 const root=path.resolve(__dirname,'../..');
 const findings=[
  {rule:'LS-05',file:'services/auto-parcel.js'},
  {rule:'LS-05',file:'services/parcelOptimizationService.js'},
  {rule:'LS-05',file:'services/parcel-item-mutation-service.js'},
 ];
 const out=scanRelevantCode(findings,root);
 assert.ok(out.some(x=>x.file==='services/auto-parcel.js'&&x.counter==='assigned'));
 assert.ok(out.some(x=>x.file==='services/parcelOptimizationService.js'&&x.counter==='totalAssigned'));
 assert.ok(out.every(x=>x.verifiedBusinessBug===false));
 assert.equal(out.find(x=>x.file==='services/auto-parcel.js').previousEvidence.issue,2949);
});
test('path traversal and absolute paths are rejected prior to reading source',()=>{
 for(const file of ['../server.js','/tmp/danger'])
  assert.throws(()=>scanRelevantCode([{rule:'LS-05',file}],__dirname),/Unsafe static finding path/);
});
