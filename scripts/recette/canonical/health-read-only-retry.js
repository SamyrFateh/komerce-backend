/** @komerce-arch-lite
 * @role g6-staging-health-read-only-retry
 * @domain recette
 * @layer script
 * @owner backend-core
 * @purpose Bound transport retries for the GET health/version pin; never retry a business mutation or accept a changed SHA.
 * @impact-areas staging-only, e2e-certification
 */
'use strict';

const RETRY_DELAYS_MS=Object.freeze([250,750]);
const HEALTH_TIMEOUT_MS=8000;

/**
 * The network between the Actions runner and Railway can fail transiently even
 * while staging serves 200s to other clients. Reissue ONLY the idempotent,
 * read-only GET /health/version. A response with a wrong SHA, an HTTP error or
 * malformed JSON fails immediately: no retry can turn it into an attestation.
 *
 * No POST is retried. Never use this helper for an E2E business command.
 * A successful retry still attests the exact SHA of the immutable staging run.
 */
async function attestHealthVersion({fetchImpl,url,expectedSha,sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms))}){
 if(typeof fetchImpl!=='function'||typeof url!=='string'||
    !url.endsWith('/health/version')||!/^https:\/\//.test(url)||
    !/^[a-f0-9]{40}$/.test(String(expectedSha||'')))
  throw Error('G6_DYNAMIC_DEPLOY_HEALTH_ARGUMENTS_INVALID');

 for(let attempt=0;attempt<=RETRY_DELAYS_MS.length;attempt++){
  let response;
  try{
   response=await fetchImpl(url,{
    method:'GET',redirect:'error',signal:AbortSignal.timeout(HEALTH_TIMEOUT_MS)
   });
  }catch(error){
   if(attempt===RETRY_DELAYS_MS.length){
    const finalError=new Error('G6_DYNAMIC_DEPLOY_HEALTH_TRANSPORT_EXHAUSTED');
    finalError.cause=error;
    throw finalError;
   }
   await sleep(RETRY_DELAYS_MS[attempt]);
   continue;
  }
  // HTTP failures, redirect policy violations, malformed bodies or a changed
  // deployment are not mere transport hiccups and cannot be silently retried.
  if(!response?.ok||(typeof response.status==='number'&&response.status!==200))
   throw Error('G6_DYNAMIC_DEPLOY_HEALTH_FAILURE');
  let version;
  try{version=await response.json();}
  catch(error){
   const invalid=new Error('G6_DYNAMIC_DEPLOY_HEALTH_JSON_INVALID');
   invalid.cause=error;
   throw invalid;
  }
  if(version?.commit!==expectedSha)
   throw Error('G6_DYNAMIC_DEPLOY_SHA_DRIFT');
  return version;
 }
 throw Error('G6_DYNAMIC_DEPLOY_HEALTH_UNREACHABLE');
}
module.exports={attestHealthVersion};
