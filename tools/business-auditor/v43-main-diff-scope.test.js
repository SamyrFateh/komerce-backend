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

test('G5 manual comparison honestly labels excluded unrelated main work',()=>{
 const p=analyze(example());
 assert.equal(p.fullDiffInspected,false);
 assert.equal(p.automatedScopeVerified,true);
 // run() includes comparisonMode and excludedNonAuditorPaths from the git diff;
 // analyze() never converts a machine scope check to human approval.
 assert.equal(p.humanReviewApproved,false);
});

test('G5 reviews PR merge relative to actual current base, not stale webhook base',()=>{
 const {run}=require('./v43-main-diff-scope');
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'g5-pr-merge-'));
 const current='b'.repeat(40),branch='c'.repeat(40),old='d'.repeat(40);
 const calls=[];
 const git=(...args)=>{
  calls.push(args.join(' '));
  if(args.join(' ')==='rev-parse HEAD')return head+'\n';
  if(args[0]==='rev-list')return [head,current,branch].join(' ')+'\n';
  if(args[0]==='merge-base')return '';
  if(args[0]==='ls-files')return '';
  if(args[0]==='diff'&&args[1]==='--name-only')
   return 'tools/business-auditor/v47-bounded-release-evidence.js\n';
  if(args[0]==='diff'&&args[1]==='--check')return '';
  if(args[0]==='diff'&&args[1]==='--binary')
   return 'diff --git a/tools/business-auditor/x.js b/tools/business-auditor/x.js\n+safe\n';
  throw Error('UNEXPECTED_GIT '+args.join(' '));
 };
 try{
  const p=run({out:dir},{GITHUB_SHA:head,AUDITOR_PR_BASE_SHA:old},{git});
  assert.equal(p.comparisonMode,'PR_COMPLETE_DIFF');
  assert.equal(p.comparisonBaseSha,current);
  assert.equal(p.eventBaseSha,old);
  assert.equal(p.prHeadSha,branch);
  assert.ok(calls.some(x=>x.includes('diff --name-only '+current+' HEAD')));
  assert.equal(p.automatedScopeVerified,true);
  assert.equal(p.humanReviewApproved,false);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('G5 rejects PR checkout that is not the synthetic merge with two parents',()=>{
 const {run}=require('./v43-main-diff-scope');
 const git=(...a)=>a[0]==='rev-parse'?head+'\n':
  a[0]==='rev-list'?head+' '+('b'.repeat(40))+'\n':'';
 assert.throws(()=>run({out:'/tmp/not-created'},
  {GITHUB_SHA:head,AUDITOR_PR_BASE_SHA:'d'.repeat(40)},{git}),
  /PR checkout must be a two-parent merge commit/);
});
