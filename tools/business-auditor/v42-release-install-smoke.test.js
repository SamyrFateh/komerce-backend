'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {accepts}=require('./v42-release-install-smoke');
const sha='a'.repeat(40);
function report(){
 return {contract:'komerce-g5-installation-smoke/v1',sha,
  checks:{packageScriptsPresent:true,docsPresent:true,quickNoDatabase:true,
   targetedNoExecution:true,fullClonesDropped:true,blockedRemoteTargets:3,
   strictG5Exit:1},
  evidence:{quickContract:'komerce-unified-business-logic-auditor/v35',
   targetedContract:'komerce-impacted-risk-plan/v36',
   fullPhysicalCases:12,docsHash:'b'.repeat(64)}};
}
test('G5 operator smoke requires exact SHA and all protected modes',()=>{
 assert.equal(accepts(report(),sha),true);
 assert.equal(accepts(report(),'c'.repeat(40)),false);
 for(const key of Object.keys(report().checks)){
  const p=report();p.checks[key]=false;
  assert.equal(accepts(p,sha),false,key);
 }
});
test('G5 operator smoke rejects fake quick/targeted or missing documentation proof',()=>{
 const x=report();x.evidence.fullPhysicalCases=0;
 assert.equal(accepts(x,sha),false);
 const y=report();y.evidence.docsHash='not-a-hash';
 assert.equal(accepts(y,sha),false);
 const z=report();z.evidence.quickContract='fake';
 assert.equal(accepts(z,sha),false);
});
