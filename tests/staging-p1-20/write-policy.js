/**
 * @komerce-arch-lite
 * @role staging-p1-twenty-human-curation-write-policy
 * @domain catalog
 * @layer test-fixture
 * @owner backend-core
 * @purpose Restrict human Playwright actions to canonical P1 staging APIs, never allow checkout or business side effects.
 * @impact-areas sourcing, catalog, pricing, market, staging-only
 */
'use strict';

const ORIGIN='https://komerce-backend-production.up.railway.app';
const SAFE_METHODS=new Set(['GET','HEAD','OPTIONS']);
const ALLOW=Object.freeze([
  ['sourcing','POST',/^\/api\/admin\/workspaces\/sourcing\/candidates\/[A-Za-z0-9_-]+\/(update|scan|promote)$/],
  ['sourcing','POST',/^\/api\/admin\/workspaces\/sourcing\/sources\/[A-Za-z0-9_-]+\/import-now$/],
  ['catalog','POST',/^\/api\/admin\/workspaces\/catalog\/approval\/KPR-[0-9]+\/(prepare-fr|approve)$/],
  ['market','POST',/^\/api\/market-delegation\/markets\/KM\/catalog\/review\/[0-9a-f-]{36}\/validate$/i],
  ['market','PUT',/^\/api\/market-delegation\/markets\/KM\/catalog\/exposure\/[0-9a-f-]{36}$/i],
  ['pricing','POST',/^\/api\/admin\/workspaces\/pricing\/market\/KM\/products\/KPR-[0-9]+\/local-price(\/activate)?$/],
]);

function allowedRequest({url,method,area,humanApproved=false}){
  let parsed;
  try{parsed=new URL(url);}catch(_){return {allowed:false,reason:'INVALID_URL'};}
  if(parsed.origin!==ORIGIN)return {allowed:false,reason:'UNTRUSTED_ORIGIN'};
  const verb=String(method).toUpperCase();
  if(SAFE_METHODS.has(verb))return {allowed:true,reason:'READ_ONLY'};
  if(!humanApproved)return {allowed:false,reason:'READ_ONLY_SESSION'};
  if(ALLOW.some(([scope,m,path])=>scope===area&&m===verb&&path.test(parsed.pathname))){
    // Market is server-authoritative; no CM/CG/DJ writes in a KM campaign.
    return {allowed:true,reason:'EXPLICIT_HUMAN_P1_GESTURE'};
  }
  return {allowed:false,reason:'NON_P1_WRITE_FORBIDDEN'};
}
module.exports={ORIGIN,SAFE_METHODS,ALLOW,allowedRequest};
