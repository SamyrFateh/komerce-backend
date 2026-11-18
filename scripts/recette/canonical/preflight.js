/** @komerce-arch-lite
 * @role g6-canonical-readonly-preflight
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose Read-only market and cohort readiness gate; never prepare fixtures by SQL or API.
 * @impact-areas staging-only
 */
'use strict';
const {loadManifest}=require('./manifest-loader');
const COHORTS=require('../../../docs/recette/canonical/cohorts.json');
const REQUIRED_PROBES=['catalog','relayAssignment','dialCodes','featureFlags'];
async function preflightScenario({scenarioId,market,cohort,env={},readOnly={}}){
 const reasons=[];
 let manifest;
 try{manifest=loadManifest(scenarioId)}catch(e){return{verdict:'NOT_READY',reasons:[e.message],mutations:0}}
 const config=COHORTS.cohorts[cohort];
 if(!config||!config.markets.includes(market)||!manifest.market_options.includes(market))
  reasons.push('G6_PREFLIGHT_MARKET_COHORT_UNSUPPORTED');
 if(!config||config.binding_status!=='READY')reasons.push('G6_PREFLIGHT_COHORT_UNBOUND');
 if(manifest.binding_status!=='READY_FOR_REVIEW')reasons.push('G6_PREFLIGHT_SCENARIO_UNBOUND');
 if(env.KOMERCE_ENV!=='staging'||env.KOMERCE_TARGET_ENV!=='staging'||env.EXPECTED_RAILWAY_ENVIRONMENT!=='staging')
  reasons.push('G6_PREFLIGHT_NOT_SHARED_STAGING');
 if(!/^[a-f0-9]{40}$/.test(env.E2E_EXPECTED_DEPLOY_SHA||''))
  reasons.push('G6_PREFLIGHT_SHA_NOT_PINNED');
 for(const key of REQUIRED_PROBES)if(typeof readOnly[key]!=='function')reasons.push('G6_PREFLIGHT_READONLY_PROBE_MISSING_'+key);
 if(market==='KM'||market==='CG')
  if(typeof readOnly.localStock!=='function')reasons.push('G6_PREFLIGHT_READONLY_PROBE_MISSING_localStock');
 if(reasons.length)return{verdict:'NOT_READY',reasons,mutations:0};
 // Only injected READ-ONLY probes: no SQL client or HTTP mutation belongs in this module.
 const queries=['catalog','relayAssignment','dialCodes','featureFlags'];
 if(market==='KM'||market==='CG')queries.push('localStock');
 const results={};
 try{
  for(const name of queries)results[name]=await readOnly[name]({scenarioId,market,cohort});
 }catch(e){return{verdict:'NOT_READY',reasons:['G6_PREFLIGHT_READONLY_PROBE_FAILED_'+String(e.message||e).slice(0,80)],mutations:0}}
 if(!(results.catalog?.ready===true))reasons.push('G6_PREFLIGHT_CATALOG_MISSING');
 if(!(results.relayAssignment?.ready===true))reasons.push('G6_PREFLIGHT_RELAY_NOT_ASSIGNED');
 if(!(results.dialCodes?.ready===true))reasons.push('G6_PREFLIGHT_DIAL_CODE_NOT_SUPPORTED');
 if(!(results.featureFlags?.ready===true))reasons.push('G6_PREFLIGHT_FLAGS_UNREADY');
 if(results.localStock && results.localStock.ready!==true)reasons.push('G6_PREFLIGHT_LOCAL_STOCK_UNREADY');
 return{verdict:reasons.length?'NOT_READY':'READY',reasons,checks:results,mutations:0};
}
module.exports={preflightScenario,REQUIRED_PROBES};
