'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {compareEquivalentPaths}=require('./business-path-compare');

const observation=(path,intent,decision,persistedAllocations,reason=null,metadata={})=>
  ({path,intent,decision,persistedAllocations,reason,metadata});

test('equivalent paths with different physical implementations agree',()=>{
 const report=compareEquivalentPaths({
  pairId:'example',contractRefs:['features/example.feature.js'],
  cases:[{left:observation('old','ready','ACCEPT',1,null,{table:'purchase_orders'}),
          right:observation('new','ready','ACCEPT',2,null,{table:'purchase_lines'})}],
 });
 assert.equal(report.mismatchCount,0);
 assert.equal(report.verdict,'NO_PATH_ASYMMETRY_OBSERVED');
 assert.equal(report.oracleApproval,'UNAPPROVED');
});
test('detects an unsafe accepted path when the other rejects with no DB effect',()=>{
 const report=compareEquivalentPaths({pairId:'example',cases:[
  {left:observation('old','not-submitted','ACCEPT',1),
   right:observation('new','not-submitted','QUARANTINE',0,'NOT_SUBMITTED')},
 ]});
 assert.equal(report.mismatchCount,1);
 assert.deepEqual(report.results[0].differences.map(x=>x.field),
   ['decision','reason','economicAllocationEffect']);
});
test('does not accept an announced quarantine if persisted DB effect disagrees',()=>{
 const report=compareEquivalentPaths({pairId:'example',cases:[
  {left:observation('old','wrong-sku','QUARANTINE',1,'SKU'),
   right:observation('new','wrong-sku','QUARANTINE',0,'SKU')},
 ]});
 assert.deepEqual(report.results[0].differences.map(x=>x.field),['economicAllocationEffect']);
});
test('rejects a comparison between different intents',()=>{
 assert.throws(()=>compareEquivalentPaths({pairId:'example',cases:[
  {left:observation('old','submitted','ACCEPT',1),
   right:observation('new','not-submitted','ACCEPT',1)},
 ]}),/different business intents/);
});
