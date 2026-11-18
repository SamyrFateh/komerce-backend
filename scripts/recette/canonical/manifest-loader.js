/** @komerce-arch-lite
 * @role g6-canonical-scenario-manifest-loader
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose Fail-closed scenario binding to the ONLY G6 business truth; manifest never self-certifies.
 * @impact-areas staging-only
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const Ajv=require('ajv');
const MATRIX=require('../../../docs/recette/G6_PRE_STRESS_BUSINESS_SCENARIOS.json');
const SCHEMA=require('../../../docs/recette/canonical/scenario-manifest.schema.json');
const ROOT=path.resolve(__dirname,'../../..'),DIR=path.join(ROOT,'docs/recette/scenarios');
const validateSchema=new Ajv({allErrors:true,strict:false}).compile(SCHEMA);
const ID=/^(?:M0[1-6]|N(?:0[1-9]|[1-3][0-9]|40))$/;
function loadManifest(id){
 if(!ID.test(id||''))throw Error('G6_MANIFEST_ID_INVALID');
 const filename=path.join(DIR,id+'.json');
 if(!fs.existsSync(filename))throw Error('G6_MANIFEST_MISSING_'+id);
 let manifest;try{manifest=JSON.parse(fs.readFileSync(filename,'utf8'))}
 catch(_){throw Error('G6_MANIFEST_JSON_INVALID_'+id)}
 if(!validateSchema(manifest))throw Error('G6_MANIFEST_SCHEMA_INVALID_'+id);
 const scenario=MATRIX.scenarios.find(x=>x.id===id);
 if(!scenario||manifest.scenario_id!==id||manifest.matrix_ref.id!==id||
  manifest.matrix_ref.version!==MATRIX.version||
  JSON.stringify(manifest.market_options)!==JSON.stringify(scenario.markets)||
  JSON.stringify(manifest.expected_oracle_ids)!==JSON.stringify(scenario.oracles||[])||
  manifest.cohort_options.length!==2||!manifest.cohort_options.includes('GPT-G6')||
  !manifest.cohort_options.includes('CLAUDE-PAR'))
  throw Error('G6_MANIFEST_MATRIX_DRIFT_'+id);
 return manifest;
}
function assertManifestCoverage(ids=fs.readdirSync(DIR).filter(x=>x.endsWith('.json')).map(x=>x.slice(0,-5))){
 const expected=MATRIX.scenarios.map(x=>x.id).sort();
 const actual=ids.slice().sort();
 if(JSON.stringify(actual)!==JSON.stringify(expected))
  throw Error('G6_MANIFEST_MATRIX_BIJECTION_INVALID');
 for(const id of expected)loadManifest(id);
 return {count:expected.length,ids:expected,version:MATRIX.version};
}
function requireExecutableManifest(id,{market,cohort}={}){
 const manifest=loadManifest(id),config=manifest.configuration;
 if(manifest.binding_status!=='READY_FOR_REVIEW'||manifest.historical_proof||
  !market||!cohort||config.market!==market||config.cohort!==cohort||
  !manifest.market_options.includes(market)||!manifest.cohort_options.includes(cohort)||
  !config.basket.source||!config.payment.method||config.steps.length===0)
  throw Error('G6_MANIFEST_NOT_BOUND_'+id);
 return manifest;
}
module.exports={loadManifest,assertManifestCoverage,requireExecutableManifest};
