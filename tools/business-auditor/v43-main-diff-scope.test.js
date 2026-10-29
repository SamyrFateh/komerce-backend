'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {analyze,allowed}=require('./v43-main-diff-scope');
const head='a'.repeat(40);
const example=()=>({head,files:['tools/business-auditor/x.js','package.json'],
 patch:'diff --git a/file b/file\n+test\n',unmerged:'',whitespaceClean:true});
test('G5 accepts scanner-only diff as machine scope, never human GO',()=>{
 const p=analyze(example());
 assert.equal(p.automatedScopeVerified,true);
 assert.equal(p.fullDiffInspected,false);
 assert.equal(p.humanReviewApproved,false);
 assert.equal(p.mergeApproved,false);
 assert.equal(p.releaseApproved,false);
 assert.equal(p.unrelatedRuntimeChanges,0);
});
test('G5 refuses any business service or non-auditor CI workflow',()=>{
 for(const f of ['services/finance.js','routes/orders.js',
   'migrations/999.sql','.github/workflows/disable-security.yml']){
  const p=analyze({...example(),files:[f]});
  assert.equal(p.automatedScopeVerified,false);
  assert.equal(p.unrelatedRuntimeChanges,1);
 }
});
test('G5 rejects unmerged conflicts, whitespace errors, bad source SHA',()=>{
 assert.equal(analyze({...example(),unmerged:'conflict'}).automatedScopeVerified,false);
 assert.equal(analyze({...example(),whitespaceClean:false}).automatedScopeVerified,false);
 assert.throws(()=>analyze({...example(),head:'incorrect'}),/G5_MAIN_DIFF_TOOL_ERROR/);
 assert.equal(allowed('tools/business-auditor/abc.js'),true);
 assert.equal(allowed('services/inventory-service.js'),false);
});
