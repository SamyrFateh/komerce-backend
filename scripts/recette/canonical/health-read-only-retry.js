/** @komerce-arch-lite
 * @role g6-staging-health-read-only-retry
 * @domain recette
 * @layer script
 * @owner backend-core
 * @purpose Bound transport retries for the GET staging health/target pin; never retry business mutations or accept identity drift.
 * @impact-areas staging-only, e2e-certification
 */
'use strict';

const RETRY_DELAYS_MS=Object.freeze([250,750]);
const HEALTH_TIMEOUT_MS=8000;
const BASE='https://komerce-backend-production.up.railway.app';
const ALLOWED_HEALTH_URLS=new Set([BASE+'/health/version',BASE+'/health']);

/**
 * Railway/Actions can drop a read-only health connection after long E2E runs.
 * Retry only an actual transport/timeout exception from the fetch itself:
 * at most 3 attempts, with fresh 8s timeouts. HTTP errors fail immediately.
 * Never retry POST/PUT/PATCH/DELETE, or any call off these two fixed endpoints.
 *
 * A successful GET is not an attestation by itself. Consumers MUST still
 * independently compare pinned SHA and/or PostgreSQL target fingerprint.
 */
async function fetchHealthReadOnly({fetchImpl,url,sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms))}){
 if(typeof fetchImpl!=='function'||!ALLOWED_HEALTH_URLS.has(url))
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
  if(!response?.ok||(typeof response.status==='number'&&response.status!==200))
   throw Error('G6_DYNAMIC_DEPLOY_HEALTH_FAILURE');
  return response;
 }
 throw Error('G6_DYNAMIC_DEPLOY_HEALTH_UNREACHABLE');
}

async function attestHealthVersion({fetchImpl,url,expectedSha,sleep}){
 if(url!==BASE+'/health/version'||!/^[a-f0-9]{40}$/.test(String(expectedSha||'')))
  throw Error('G6_DYNAMIC_DEPLOY_HEALTH_ARGUMENTS_INVALID');
 const response=await fetchHealthReadOnly({fetchImpl,url,sleep});
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
module.exports={fetchHealthReadOnly,attestHealthVersion};
