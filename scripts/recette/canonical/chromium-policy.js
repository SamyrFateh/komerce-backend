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
// page.reload / page.goto ne sont pas dans la liste : navigation humaine (F5), sans mutation. Couvre aussi la spec p3.
// Raw locator gestures bypass render-ready, relocation and the no-retry-after-mutation rule.
const RAW_GESTURE=/(?<!keyboard)\.(?:click|fill|selectOption|check|press|dblclick|tap|setInputFiles|dispatchEvent)\s*\(/;
function assertGestureSourceUsesHelper(filename,source=fs.readFileSync(filename,'utf8')){
 const code=source.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
 if(RAW_GESTURE.test(code))throw Error('G6_GESTURE_OUTSIDE_HELPER_FORBIDDEN_'+path.basename(filename));
 return true;
}
// Exception propriétaire (19/11 00h47) : les écritures PG ne servent QU'À préparer des identités de test
// (client E2E, OTP haché préchargé, comptes et memberships relais), jamais un état métier.
// Tables réellement écrites (par les writers canoniques) par g6-p2-buyer-order-real, g6-canonical-client-pickup
// et g6-a-relay-cash-real : voir IDENTITY_WRITES_BY_SCRIPT.
const IDENTITY_TABLES=Object.freeze(['users','e2e_test_accounts','otp_codes','assignment_memberships','membership_capabilities','operator_market_scopes']);
const IDENTITY_WRITES_BY_SCRIPT=Object.freeze({
 'g6-p2-buyer-order-real-chromium.js':['users','e2e_test_accounts','otp_codes'],
 'g6-canonical-client-pickup-chromium.js':['otp_codes'],
 'g6-a-relay-cash-real-chromium.js':['users','e2e_test_accounts','assignment_memberships','membership_capabilities','operator_market_scopes']
});
function sqlWriteTables(source){
 const code=source.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
 const re=/\b(?:INSERT\s+INTO|DELETE\s+FROM|UPDATE(?=\s+[\w."]+\s+SET\b)|MERGE\s+INTO|TRUNCATE(?:\s+TABLE)?|ALTER\s+TABLE|DROP\s+TABLE)\s+([\w."]+)/gi;
 const out=[];let m;
 while((m=re.exec(code)))out.push(m[1].replace(/"/g,'').replace(/^public\./,'').toLowerCase());
 return out;
}
function assertStageSqlWritesIdentityOnly(filename,source=fs.readFileSync(filename,'utf8')){
 for(const t of sqlWriteTables(source))
  if(!IDENTITY_TABLES.includes(t))throw Error('G6_STAGE_SQL_WRITE_OUTSIDE_IDENTITY_TABLES_'+path.basename(filename)+'_'+t);
 return true;
}
function validateChromiumScriptSources(){
 const dir=path.join(__dirname,'..');
 const files=fs.readdirSync(dir).filter(f=>/^g6-.*chromium\.js$/.test(f));
 for(const f of files){assertGestureSourceUsesHelper(path.join(dir,f));assertTraceStartsAfterAuth(path.join(dir,f));}
 const spec=path.join(__dirname,'../../../tests/staging-clicks/g6-p3-kuyiyuk.spec.js');
 assertGestureSourceUsesHelper(spec);assertTraceStartsAfterAuth(spec);
 return files.length;
}
// Trace must start only after login/OTP/redirect: no raw tracing.start, and every
// startTraceAfterAuth call is preceded by an authentication-completion step.
function assertTraceStartsAfterAuth(filename,source=fs.readFileSync(filename,'utf8')){
 const code=source.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
 const base=path.basename(filename);
 if(/tracing\s*\.\s*(?:start|startChunk)\s*\(/.test(code))throw Error('G6_TRACE_STARTED_OUTSIDE_HELPER_'+base);
 const call=/startTraceAfterAuth\s*\(/g,done=/waitForURL\s*\(|await\s+ver\b|await\s+pending\b/;
 let m,n=0;
 while((m=call.exec(code))){n++;if(!done.test(code.slice(0,m.index)))throw Error('G6_TRACE_BEFORE_AUTH_COMPLETE_'+base);}
 if(/\.newContext\s*\(/.test(code)&&!n)throw Error('G6_TRACE_AFTER_AUTH_MISSING_'+base);
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
module.exports={IDENTITY_TABLES,IDENTITY_WRITES_BY_SCRIPT,sqlWriteTables,assertStageSqlWritesIdentityOnly,assertTraceStartsAfterAuth,assertGestureSourceUsesHelper,validateChromiumScriptSources,assertStageSourceSafe,validateStageModuleSources,assertCanonicalProof};
