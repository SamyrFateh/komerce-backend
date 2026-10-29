#!/usr/bin/env node
'use strict';
/**
 * G5 comparison against the frozen pre-V4 integration baseline. This is an
 * independently reproducible change-scope attestation, NOT a human review.
 * It never authorizes main merges or release tags.
 */
const cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'../..');
const BASE='dcba1a63368a65334465aad788d61451a5a23820';
const sha256=x=>crypto.createHash('sha256').update(x).digest('hex');
const fail=s=>{throw Error('G5_MAIN_DIFF_TOOL_ERROR: '+s)};
function allowed(file){
 return file.startsWith('tools/business-auditor/')||
   file==='.github/workflows/auditor-v4-evidence-campaign.yml'||
   file==='package.json';
}
function analyze({head,base=BASE,files,patch,unmerged='',whitespaceClean=true}){
 if(!/^[a-f0-9]{40}$/.test(head||'')||!(/^[a-f0-9]{40}$/.test(base||''))||
   !Array.isArray(files)||!files.length||files.length>250||typeof patch!=='string')
  fail('missing source SHA or diff evidence');
 const invalid=files.filter(x=>typeof x!=='string'||x.startsWith('/')||
   x.includes('..')||!allowed(x));
 const isSafe=invalid.length===0&&unmerged===''&&whitespaceClean&&
  patch.length>0;
 return {contract:'komerce-reviewed-main-integration/v1',
  targetSha:head,baselineSha:base,baseBranch:'main',
  changedFiles:files,changedFileCount:files.length,patchSha256:sha256(patch),
  diffBytes:Buffer.byteLength(patch,'utf8'),unrelatedRuntimeChanges:invalid.length,
  forbiddenPaths:invalid,conflicts:unmerged?unmerged.split('\n').filter(Boolean).length:0,
  whitespaceClean,automatedScopeVerified:isSafe,
  fullDiffInspected:false,
  humanReviewApproved:false,
  reviewStatus:'AUTOMATED_SCOPE_CHECK_ONLY_HUMAN_REVIEW_REQUIRED',
  mergeApproved:false,
  releaseApproved:false};
}
function run({out}={},env=process.env,deps={}){
 if(!out)fail('usage --out DIR');
 const git=deps.git||((...args)=>cp.execFileSync('git',args,{
  cwd:ROOT,encoding:'utf8',timeout:30000,maxBuffer:30*1024*1024}));
 const head=git('rev-parse','HEAD').trim();
 if(head!==env.GITHUB_SHA)fail('checkout SHA differs from CI provenance');
 try{git('merge-base','--is-ancestor',BASE,'HEAD');}
 catch{fail('frozen baseline not an ancestor of checkout');}
 const fileText=git('diff','--name-only',BASE,'HEAD').trim();
 const files=fileText?fileText.split('\n'):[];
 const patch=git('diff','--binary','--full-index',BASE,'HEAD');
 let clean=true;
 try{git('diff','--check',BASE,'HEAD');}catch{clean=false;}
 const unmerged=git('ls-files','-u').trim();
 const report=analyze({head,files,patch,unmerged,whitespaceClean:clean});
 if(!report.automatedScopeVerified)
  fail('unsafe diff or unresolved conflicts: '+report.forbiddenPaths.join(','));
 // Even a fully inspected machine patch is not an approved human review.
 const dir=path.resolve(out);fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'g5-main-diff.json'),JSON.stringify(report,null,2)+'\n');
 fs.writeFileSync(path.join(dir,'g5-main-diff.md'),[
  '# G5 isolated integration boundary','',
  '- Baseline: '+BASE,
  '- Tested SHA: '+head,
  '- Changed files: '+files.length,
  '- Patch SHA256: '+report.patchSha256,
  '- Forbidden product runtime paths: '+report.unrelatedRuntimeChanges,
  '- Machine diff scope: **PASS**',
  '- Independent human review: **NOT YET ATTESTED**',
  '- V4.0 release authorization: **NO**','',
  'Machine scope control cannot replace semantic and blind G4 evidence.',
  ''].join('\n'));
 console.log('AUDITOR_G5_MAIN_DIFF '+JSON.stringify({
  sha:head,files:files.length,forbidden:report.unrelatedRuntimeChanges,
  scope:report.automatedScopeVerified,humanReviewed:false}));
 return report;
}
if(require.main===module){
 const args=process.argv.slice(2);
 if(args.length!==2||args[0]!=='--out')fail('usage --out DIR');
 try{run({out:args[1]});}catch(e){console.error(e.stack||e.message);process.exitCode=2}
}
module.exports={BASE,allowed,analyze,run};
