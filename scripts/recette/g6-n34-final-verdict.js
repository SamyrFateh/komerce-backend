#!/usr/bin/env node
/** @komerce-arch-lite
 * @role g6-n34-combined-proof-verdict
 * @domain sourcing
 * @layer test
 * @owner backend-core
 * @purpose Bind two independently executed N34a/N34b Chromium+API+PG proofs into the canonical stage graph, never treating a historical KM source as a new CM/CG import.
 * @db-read none
 * @db-write none
 * @impact-areas staging-only
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),{isDeepStrictEqual}=require('node:util');
const {graphFor}=require('./canonical/stage-registry');
const env=process.env;
const OUT=path.resolve('test-results/g6-n34-combined');
const inputs=Object.freeze({
 N34_CENTRAL_IMMUTABILITY:path.resolve('test-results/g6-n34a-delete-refusal/report.json'),
 N34_EXPLICIT_SOURCE:path.resolve('test-results/g6-n34b-final-readonly/report.json')
});
const report={schema:'komerce-g6-n34-combined/1',scenario_id:'N34',
 market:env.G6_TARGET_MARKET,verdict:'NOT_PROVEN',scenario_bound:true,
 production_permitted:false,db_write:false,stages:[],not_new_supplier_import:true,
 evidence_scope:'GLOBAL_SYSTEM_IDENTITY_AND_GLOBAL_SOURCE_LINEAGE;KM_HISTORICAL_IMPORT',
 external_supplier_calls:0,external_payment_executed:false};
function check(ok,code){if(!ok)throw Error('G6_N34_FINAL_'+code)}
function save(){fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n')}
function assertRuntime(data,stage){
 check(data&&data.market===env.G6_TARGET_MARKET,'MARKET_DRIFT_'+stage);
 check(/^[0-9a-f]{40}$/.test(String(env.E2E_EXPECTED_DEPLOY_SHA||''))&&
  data.sha===env.E2E_EXPECTED_DEPLOY_SHA,'SHA_DRIFT_'+stage);
 check(typeof data.db_fingerprint==='string'&&data.db_fingerprint.length>8,
  'PG_FINGERPRINT_ABSENT_'+stage);
 check(data.production_permitted===false&&data.external_supplier_calls===0&&
  data.external_payment_executed===false&&data.db_write===false,
  'SIDE_EFFECT_OR_REPORT_INVALID_'+stage);
}
const validators={
 N34_CENTRAL_IMMUTABILITY:data=>{
  check(data.verdict==='N34A_CENTRAL_HUB_DELETE_REFUSED_HTTP409_PG_UNCHANGED_NOT_FULL',
   'DELETE_NEGATIVE_NOT_PROVEN');
  check(data.steps?.some(x=>x.stage==='supplier360-readonly'&&x.no_mutation_controls===true),
   'SUPPLIER_360_UI_UNPROVEN');
  check(data.attempts?.length===2&&data.attempts[0].force===false&&data.attempts[1].force===true,
   'DELETE_NORMAL_FORCE_NOT_PLAYED');
  for(const attempt of data.attempts)check(attempt.http_status===409&&
   attempt.error_code==='CENTRAL_HUB_SUPPLIER_IMMUTABLE'&&
   attempt.allowed_count===1&&attempt.unexpected_request_count===0,
   'DELETE_NOT_409_OR_EXTRA_REQUEST');
  check(isDeepStrictEqual(data.before,data.after),'SUPPLIER_AND_PO_PG_CHANGED');
  check(typeof data.supplier_id==='string'&&!!data.before?.supplier_hash,
   'HUB_SYSTEM_IDENTITY_MISSING');
 },
 N34_EXPLICIT_SOURCE:data=>{
  check(data.verdict==='N34B_SHARED_PROVENANCE_PG_CHROMIUM_REVALIDATED_NOT_NEW_IMPORT',
   'REAL_SOURCE_NOT_PROVEN');
  check(data.original_positive_run===45023874015&&
   data.evidence_scope==='GLOBAL_SUPPLIER_IDENTITY_ORIGINAL_KM_FIXTURE',
   'HISTORICAL_SOURCE_SCOPE_MISSING');
  check(data.provenance?.preserved===true&&data.provenance_after?.preserved===true&&
   data.provenance.selected_supplier_id===data.provenance_after.selected_supplier_id,
   'SUPPLIER_SUBSTITUTED');
  check(data.steps?.some(x=>x.step==='n34b-real-supplier-live-chromium-selected'&&
   x.passed===true&&x.ui===true&&x.mutations===0),'LIVE_UI_NOT_PROVEN');
  check(data.hub_supplier_id&&data.hub_supplier_id!==data.provenance.selected_supplier_id,
   'CENTRAL_HUB_SILENT_FALLBACK');
 }
};
async function main(){
 try{
  save();check(['KM','CM','CG'].includes(env.G6_TARGET_MARKET),'MARKET_INVALID');
  check(env.GITHUB_EVENT_NAME==='issues'&&env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&
   env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&env.G6_N34_FINAL_READONLY==='1',
   'OWNER_READONLY_GUARD');
  const graph=graphFor('N34'),done=new Map();
  check(isDeepStrictEqual(graph.order,['N34_CENTRAL_IMMUTABILITY','N34_EXPLICIT_SOURCE']),
   'N34_STAGE_ORDER_DRIFT');
  const ctx={
   async runCertifiedStage(id){
    check(Object.hasOwn(inputs,id),'NON_CERTIFIED_STAGE_'+id);
    const data=JSON.parse(fs.readFileSync(inputs[id],'utf8'));
    assertRuntime(data,id);
    for(const dependency of graph.byId.get(id).requires)check(done.has(dependency),
      'STAGE_DEPENDENCY_MISSING_'+id);
    return data;
   },
   validateCertifiedStage(id,data){
    check(Object.hasOwn(validators,id),'UNKNOWN_VALIDATOR_'+id);
    validators[id](data);
    done.set(id,data);
    return true;
   }
  };
  for(const id of graph.order){
   const stage=graph.byId.get(id),proof=await stage.run(ctx);
   stage.validate(ctx,proof);
   report.stages.push({id,verified:true,verdict:proof.verdict});
  }
  const a=done.get('N34_CENTRAL_IMMUTABILITY'),b=done.get('N34_EXPLICIT_SOURCE');
  check(a.sha===b.sha&&a.db_fingerprint===b.db_fingerprint,
   'NEGATIVES_AND_PROVENANCE_NOT_ON_SAME_SHA_OR_PG');
  check(a.supplier_id===b.hub_supplier_id,'SYSTEM_HUB_ID_CHANGED');
  report.sha=a.sha;report.db_fingerprint=a.db_fingerprint;report.system_supplier_id=a.supplier_id;
  report.source_supplier_id=b.provenance.selected_supplier_id;
  // KM was originally imported through the real UI; CM/CG only attest GLOBAL
  // source invariants against that existing KM-owned candidate. Never call them
  // local fresh-import/promotion PASS without a market-specific source fixture.
  report.verdict=env.G6_TARGET_MARKET==='KM'
   ?'N34_KM_SOURCE_INVARIANTS_CHROMIUM_API_PG_PASS'
   :'N34_GLOBAL_SOURCE_INVARIANTS_MARKET_SMOKE_NOT_MARKET_TRANSACTION';
  report.market_specific_import_proven=env.G6_TARGET_MARKET==='KM';
  save();
 }catch(e){report.error=String(e.stack||e);report.verdict='NOT_PROVEN';process.exitCode=2;save()}
 console.log(JSON.stringify(report));
}
if(require.main===module)main();
