/**
 * @komerce-arch-lite
 * @role staging-real-source-unit-reconciliation
 * @domain sourcing
 * @layer script
 * @owner backend-core
 * @purpose Diagnose actual AliExpress supplier import runs and select at most one canonically certifiable unlinked candidate.
 * @db-read import_runtime_runs, sourcing_candidates, products
 * @db-write none
 * @impact-areas sourcing, catalog, staging-only, e2e-certification
 */
'use strict';
const fs=require('fs');
const path=require('path');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {loadRunCandidates,classifyCandidate,summarizeCandidates}=require('../aliexpress-promote-run-staging');
const {evaluateSourcingCandidateOutcome}=require('../../services/sourcing-certification');
const HOST='https://komerce-backend-production.up.railway.app';
const OUT=path.resolve('test-results/staging-p1/source-unit-reconciliation.json');
const FOCUS='KIR-000009';
function reconcileRun(run,candidates,linked,seen){
 const s=summarizeCandidates(candidates);
 const expected=run.intake?.ready_for_refinery;
 const announced=Number.isInteger(Number(expected))&&expected!==null&&expected!==undefined?Number(expected):null;
 const counted=s.certified_total;
 const consistent=announced!==null&&announced===counted;
 const details=candidates.map(c=>{
   const verdict=evaluateSourcingCandidateOutcome(c);
   const x=classifyCandidate(c);
   const p=linked.get(String(c.product_id))||null;
   const foreignLinkCount=seen.get(String(c.supplier_product_id))||0;
   return {candidate_id:c.id,supplier_product_id:c.supplier_product_id,
     state:c.state,decision:verdict.decision,outcome:verdict.outcome,
     certification_valid:verdict.outcome_valid,sourcing_certified:verdict.sourcing_certified,
     reasons:verdict.reasons,contract_v2:String(c.normalized_source_contract?.schema_version)==='2',
     promotion:x.status,blocker:x.reason||null,
     prior_global_product:p?{ref:p.product_ref,active:p.is_active,lifecycle:p.lifecycle_status}:null,
     foreign_link_count:foreignLinkCount,
     unlinked_unique:x.status==='promotable'&&foreignLinkCount===0};
 });
 const options=details.filter(x=>x.unlinked_unique);
 return {run_ref:run.run_ref,import_id:run.import_id,provider:run.provider,
   source_type:run.source_type,pipeline_status:run.intake?.pipeline_status||null,
   recorded_ready_for_refinery:announced,recomputed_certified_total:counted,
   delta:announced===null?null:counted-announced,
   accounting_consistent:consistent,summary:s,
   options:options.length,details};
}
function chooseCandidate(runs){
 const eligible=runs.filter(run=>run.accounting_consistent &&
   run.source_type==='api'&&run.pipeline_status==='CANONICAL_RESOLVED'&&
   run.summary.blocked===0);
 const c=[];
 for(const run of eligible)
  for(const row of run.details)
   if(row.unlinked_unique)c.push({run_ref:run.run_ref,
     import_id:run.import_id,candidate_id:row.candidate_id,
     supplier_product_id:row.supplier_product_id});
 c.sort((a,b)=>a.run_ref.localeCompare(b.run_ref)||a.supplier_product_id.localeCompare(b.supplier_product_id));
 return c[0]||null;
}
async function main(){
 const out={schema_version:1,generated_at:new Date().toISOString(),target:HOST,
   purpose:'Real supplier candidate accounting; no import, price market, approval, publication or mutation',
   focus_run:FOCUS,selected:null,run_count:0,runs:[],failure:null,
   status:'BLOCKED',no_business_writes:true};
 let c;
 fs.mkdirSync(path.dirname(OUT),{recursive:true});
 try{
   if(process.env.KOMERCE_ENV!=='staging'||process.env.NODE_ENV==='production'||
      process.env.STAGING_BASE_URL!==HOST)throw Error('P1_STAGING_TARGET_REQUIRED');
   const identity=await confirmTarget({db});
   if(identity?.confirmed!==true)throw Error('P1_TARGET_FINGERPRINT_MISMATCH');
   const v=await fetch(HOST+'/health/version',{signal:AbortSignal.timeout(10000)});
   if(!v.ok)throw Error('P1_DEPLOY_VERSION_MISSING');
   const version=await v.json();
   out.runtime_sha=version.commit||version.sha||null;
   c=await db.pool.connect();
   await c.query('BEGIN READ ONLY');
   await c.query("SET LOCAL statement_timeout='12000ms'");
   const {rows}=await c.query(
     "SELECT id,run_ref,import_id,provider,source_type,status,intake "+
     "FROM import_runtime_runs WHERE lower(provider)='aliexpress' AND import_id IS NOT NULL "+
     "ORDER BY run_ref DESC LIMIT 35");
   out.run_count=rows.length;
   if(!rows.length)throw Error('P1_NO_REAL_ALIEXPRESS_RUNS');
   const collected=[];
   for(const run of rows){
     const candidates=await loadRunCandidates(run.import_id,c);
     collected.push({run,candidates});
   }
   const ids=collected.flatMap(x=>x.candidates.filter(c=>c.product_id).map(c=>c.product_id));
   const linked=new Map();
   if(ids.length){
     const res=await c.query('SELECT id,product_ref,is_active,lifecycle_status FROM products WHERE id=ANY($1::uuid[])',[ids]);
     for(const row of res.rows)linked.set(String(row.id),row);
   }
   const productIds=[...new Set(collected.flatMap(x=>x.candidates
     .filter(c=>classifyCandidate(c).status==='promotable').map(c=>c.supplier_product_id)).filter(Boolean))];
   const seen=new Map();
   if(productIds.length){
     const res=await c.query("SELECT supplier_product_id,COUNT(*)::int AS n FROM sourcing_candidates "+
       "WHERE lower(supplier_name)='aliexpress' AND supplier_product_id=ANY($1::text[]) "+
       "AND product_id IS NOT NULL GROUP BY supplier_product_id",[productIds]);
     for(const row of res.rows)seen.set(String(row.supplier_product_id),row.n);
   }
   out.runs=collected.map(({run,candidates})=>reconcileRun(run,candidates,linked,seen));
   out.selected=chooseCandidate(out.runs);
   out.status=out.selected?'ONE_REAL_SOURCE_CANDIDATE_IDENTIFIED':'NO_ELIGIBLE_CANDIDATE_PROVEN';
   await c.query('ROLLBACK');c.release();c=null;
   console.log(JSON.stringify({status:out.status,runs:out.run_count,
     focus:out.runs.find(x=>x.run_ref===FOCUS)||null,
     selection:out.selected,inventory:out.runs.map(x=>({
       run_ref:x.run_ref,delta:x.delta,recorded:x.recorded_ready_for_refinery,
       computed:x.recomputed_certified_total,promotable:x.summary.promotable,options:x.options
     }))},null,2));
 }catch(e){
   out.failure=String(e.code||e.message||e).slice(0,230);
   process.exitCode=2;
   console.error('P1_SOURCE_AUDIT_BLOCKED:'+out.failure);
 }finally{
   if(c){try{await c.query('ROLLBACK');}catch(_){}c.release();}
   fs.writeFileSync(OUT,JSON.stringify(out,null,2)+'\n');
   await db.pool.end();
 }
}
if(require.main===module)main();
module.exports={reconcileRun,chooseCandidate};
