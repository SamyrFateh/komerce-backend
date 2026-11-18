/** @komerce-arch-lite
 * @role g6-canonical-chromium-policy
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose Reject non-Chromium human gestures and direct stage writes without an owner-approved external response.
 * @impact-areas staging-only
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const Ajv=require('ajv');
const {STAGE_IDS,loadGoldenStages}=require('./stage-registry');
const schema=require('../../../docs/recette/canonical/proof.schema.json');
const exceptions=require('../../../docs/recette/canonical/external-responses.json');
const validate=new Ajv({allErrors:true,strict:false}).compile(schema);
const FORBIDDEN=[
 /require\s*\(\s*['"](?:axios|node:http|http|node:https|https|node:net|net)['"]\s*\)/,
 /require\s*\(\s*['"][^'"]*(?:\/db|\/pg|postgres)['"]\s*\)/,
 /\b(?:fetch|axios)\s*\(/,
 /\.request\.(?:post|put|patch|delete)\s*\(/,
 /\.query\s*\(\s*['"`]\s*(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE|ALTER|CREATE|DROP)\b/i
];
function assertStageSourceSafe(filename,source=fs.readFileSync(filename,'utf8')){
 for(const f of FORBIDDEN)if(f.test(source))throw Error('G6_STAGE_DIRECT_WRITE_FORBIDDEN_'+path.basename(filename));
 return true;
}
function validateStageModuleSources(){
 for(const id of STAGE_IDS)assertStageSourceSafe(path.join(__dirname,'stages',id+'.js'));
 return STAGE_IDS.length;
}
function assertCanonicalProof(proof){
 if(!validate(proof))throw Error('G6_PROOF_SCHEMA_INVALID');
 const seen=new Set(proof.gestures.map(g=>g.step));
 if(proof.verdict==='PASS'){
  if(proof.screen_coverage.required===0||proof.screen_coverage.covered!==proof.screen_coverage.required)
   throw Error('G6_PROOF_SCREEN_COVERAGE_NOT_100');
  const stages=new Map(loadGoldenStages().map(s=>[s.id,s]));
  for(const stage of proof.steps.filter(x=>x.verdict==='PASS')){
   const spec=stages.get(stage.id);
   if(!spec||spec.roles.length&&!seen.has(stage.id))
    throw Error('G6_PROOF_HUMAN_GESTURE_MISSING_'+stage.id);
  }
 }
 const approved=new Set(exceptions.approved.map(e=>e.id));
 for(const e of proof.external_responses)
  if(!approved.has(e.id))throw Error('G6_EXTERNAL_RESPONSE_NOT_OWNER_APPROVED_'+e.id);
 return true;
}
module.exports={assertStageSourceSafe,validateStageModuleSources,assertCanonicalProof};
