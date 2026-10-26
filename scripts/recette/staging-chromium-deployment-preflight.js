#!/usr/bin/env node
'use strict';
/**
 * @komerce-arch-lite
 * @role staging-chromium-deployed-sha-preflight
 * @domain dashboard
 * @layer script
 * @owner backend-core
 * @purpose Detect staging/main drift before spending an hour on Chromium.
 * @impact-areas dashboard, staging-only
 */
const fs=require('fs');
const path=require('path');
const ORIGIN='https://komerce-backend-production.up.railway.app';
const OUTPUT=path.resolve('test-results/staging-chromium/deployment-preflight.json');
const TIMEOUT_MS=120000;
const INTERVAL_MS=5000;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function checkEnv(env=process.env) {
  const expected=String(env.E2E_EXPECTED_DEPLOY_SHA||'').trim();
  if(!/^[0-9a-f]{40}$/.test(expected))throw Error('EXPECTED_COMMIT_SHA_INVALID');
  if(env.E2E_STAGING_BASE_URL!==ORIGIN)throw Error('UNTRUSTED_STAGING_ORIGIN');
  return expected;
}
async function readVersion(fetcher=fetch) {
  const response=await fetcher(ORIGIN+'/health/version',{
    headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(8000)
  });
  if(!response.ok)return {status:'VERSION_HTTP_'+response.status,sha:null};
  const raw=await response.json();
  const sha=String(raw.commit||raw.sha||'');
  return /^[0-9a-f]{8,40}$/.test(sha)
    ? {status:'VERSION_OBSERVED',sha}
    : {status:'VERSION_MISSING_SHA',sha:null};
}
async function inspect(env=process.env,{fetcher=fetch,wait=sleep,now=()=>Date.now(),timeoutMs=TIMEOUT_MS}={}) {
  const expected=checkEnv(env);
  const started=now();
  let observed=null, reason='VERSION_UNVERIFIED', attempts=0;
  do {
    attempts++;
    try {
      const result=await readVersion(fetcher);
      observed=result.sha;
      reason=result.status;
      if(observed && (expected.startsWith(observed)||observed.startsWith(expected))){
        return {status:'DEPLOY_SHA_MATCHED',expected_sha:expected,observed_sha:observed,attempts};
      }
    }catch(_){reason='VERSION_REQUEST_FAILED';}
    if(now()-started>=timeoutMs)break;
    await wait(INTERVAL_MS);
  }while(now()-started<=timeoutMs);
  return {status:'DEPLOY_SHA_NOT_READY',reason,expected_sha:expected,
    observed_sha:observed,attempts};
}
async function main(env=process.env,options) {
  let report;
  try{report=await inspect(env,options);}
  catch(err){report={status:'DEPLOY_PREFLIGHT_CONFIGURATION_INVALID',reason:err.message};}
  fs.mkdirSync(path.dirname(OUTPUT),{recursive:true});
  fs.writeFileSync(OUTPUT,JSON.stringify(report,null,2)+'\n');
  console.log('[staging-version] '+JSON.stringify(report));
  if(report.status!=='DEPLOY_SHA_MATCHED')process.exitCode=2;
  return report;
}
if(require.main===module) main();
module.exports={checkEnv,readVersion,inspect,main,ORIGIN};
