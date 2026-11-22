'use strict';
/**
 * @komerce-arch-lite
 * @role          economic-result-staging-only-pin
 * @domain        economic-engine
 * @layer         test
 * @owner         backend-core
 * @purpose       Pin a deployed #5131-or-newer runtime only when the HEAD delta consists of explicitly reviewed non-runtime certification files.
 * @impact-areas  staging-only, ci, certification
 */
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const BASE='https://komerce-backend-production.up.railway.app';
const MIN_RUNTIME_SHA='ef4556add486717cbda72f2b6150cc8a385564d8'; // #5131 merged
const SHA=/^[a-f0-9]{40}$/i;
const ALLOWED=new Set([
  '.github/workflows/staging-economic-result-real-readonly.yml',
  'docs/BUSINESS_FEATURE_GRAPH.json',
  'docs/BUSINESS_FEATURE_GRAPH.md',
  'docs/FEATURE_360.json',
  'docs/FEATURE_360.md',
  'features/economic-engine.feature.js',
  // M06-only staging recipe scripts already merged into main while this proof runs:
  // never imported by the deployed backend or the economic UI.
  'scripts/recette/canonical/m06-receipt-plan.js',
  'scripts/recette/g6-m06-receiving-chromium.js',
  'tests/unit/g6-m06-receipt-plan.test.js',
  'scripts/recette/economic-result-real-readonly.js',
  'scripts/recette/economic-result-readonly-pin.js',
  'tests/unit/economic-result-real-readonly.test.js',
  'tests/unit/economic-result-readonly-pin.test.js',
]);
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
function decide({staging,head,isAncestor,hasRequiredFix,changed,manifestOnlyTests}) {
  if(!SHA.test(String(staging||''))||!SHA.test(String(head||'')))return {allowed:false,reason:'INVALID_SHA'};
  if(!hasRequiredFix)return {allowed:false,reason:'DEPLOYED_RUNTIME_PREDATES_5131'};
  if(staging===head)return {allowed:true,reason:'EXACT_DEPLOYMENT'};
  if(!isAncestor)return {allowed:false,reason:'STAGING_NOT_ANCESTOR_OF_HEAD'};
  const excluded=(changed||[]).filter(p=>!ALLOWED.has(p));
  if(excluded.length)return {allowed:false,reason:'DEPLOYED_SOURCE_DIFFERS',excluded};
  if(!manifestOnlyTests)return {allowed:false,reason:'FEATURE_MANIFEST_UNREVIEWED_CHANGE'};
  return {allowed:true,reason:'ONLY_EXPLICIT_TEST_AND_METADATA_DELTA'};
}
function manifestTestOnly(staging,head) {
  const file='features/economic-engine.feature.js';
  const old=git('show',staging+':'+file);
  const now=fs.readFileSync(path.resolve(file),'utf8').trim();
  const normalized=now
    .replace(/^      'tests\/unit\/economic-result-real-readonly\.test\.js',\r?\n/gm,'')
    .replace(/^      'tests\/unit\/economic-result-readonly-pin\.test\.js',\r?\n/gm,'')
    .trim();
  // The two newly owned Jest files are the only permitted feature declaration change.
  return normalized===old;
}
async function main(){
  const env=process.env;
  if(env.STAGING_BASE_URL!==BASE||env.KOMERCE_ENV!=='staging'||env.EXPECTED_RAILWAY_ENVIRONMENT!=='staging')
    throw Error('PIN_STAGING_ONLY');
  const res=await fetch(BASE+'/health/version',{redirect:'error'});
  if(!res.ok)throw Error('STAGING_VERSION_HTTP_'+res.status);
  const staging=String((await res.json()).commit||'');
  const head=git('rev-parse','HEAD');
  let ancestor=false,fix=false,changed=[],manifest=false;
  if(SHA.test(staging)&&SHA.test(head)){
    try{git('merge-base','--is-ancestor',staging,head);ancestor=true}catch(_){}
    try{git('merge-base','--is-ancestor',MIN_RUNTIME_SHA,staging);fix=true}catch(_){}
    if(ancestor)changed=git('diff','--name-only',staging+'..'+head).split('\n').filter(Boolean);
    if(ancestor && (changed.includes('features/economic-engine.feature.js')))manifest=manifestTestOnly(staging,head);
    else manifest=true;
  }
  const verdict=decide({staging,head,isAncestor:ancestor,hasRequiredFix:fix,changed,manifestOnlyTests:manifest});
  const report={staging_sha:staging,head_sha:head,decision:verdict.allowed?'ACCEPTED':'REFUSED',
    reason:verdict.reason,changed_files:changed,excluded:verdict.excluded||[]};
  const out='test-results/hub-v1-http/deploy-pin.json';
  fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
  if(!verdict.allowed)throw Error('ECONOMIC_READONLY_PIN_REFUSED:'+verdict.reason);
  if(env.GITHUB_ENV)fs.appendFileSync(env.GITHUB_ENV,'E2E_EXPECTED_DEPLOY_SHA='+staging+'\n');
}
if(require.main===module)main().catch(e=>{console.error(String(e.message).slice(0,250));process.exitCode=2});
module.exports={decide,ALLOWED,MIN_RUNTIME_SHA};
