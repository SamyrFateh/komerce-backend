'use strict';
/** @komerce-arch
 * @role cj-mapping-confirmation-preview
 * @domain sourcing
 * @layer script
 * @criticality low
 * @inputs historical KIR, existing conservative proposed mappings
 * @outputs reviewed plan, explicit exclusion and fingerprint
 * @depends db.js, scripts/audit-kir-cj-commercial-proposals.js
 * @db-read boutique_categories, boutique_subcategories, sourcing_candidates, supplier_commercial_category_mappings, import_runtime_runs, import_runtime_item_events
 * @db-write none
 * @db-txn none
 */
const crypto=require('crypto');
const db=require('../db');
const {audit:proposalsAudit}=require('./audit-kir-cj-commercial-proposals');
const {normalizePath}=require('../services/supplier-commercial-category-mapping');

function buildPlan(report) {
 if(report.provider!=='CJdropshipping')throw new Error('CJ_PROVIDER_REQUIRED');
 if(!/^KIR-\\d{6}$/.test(report.run_ref))throw new Error('KIR_REF_INVALID');
 const candidates=(report.all_groups||[]).map(g=>({
   source_path:g.source_path,normalized_path:normalizePath(g.source_path),
   affected_products:g.count,product_refs:[...g.product_refs],
   category:g.proposal?.category||null,subcategory:g.proposal?.subcategory||null,
   reason:g.reason,decision:g.proposal&&g.reason==='SOURCE_PATH_PHRASE'
     ?'AWAITING_OPERATOR_CONFIRMATION':'MANUAL_REVIEW_ONLY',
 }));
 const eligible=candidates.filter(g=>g.decision==='AWAITING_OPERATOR_CONFIRMATION');
 const excluded=candidates.filter(g=>g.decision==='MANUAL_REVIEW_ONLY');
 const normalizedIds=new Set();
 for(const g of candidates){
   if(normalizedIds.has(g.normalized_path))throw new Error('DUPLICATE_CANONICAL_SOURCE_PATH');
   normalizedIds.add(g.normalized_path);
 }
 const fingerprint=crypto.createHash('sha256').update(JSON.stringify({run_ref:report.run_ref,candidates})).digest('hex');
 return {run_ref:report.run_ref,provider:report.provider,
   inspected:report.inspected,proposed_groups:candidates.length,
   eligible_groups:eligible.length,eligible_products:eligible.reduce((n,g)=>n+g.affected_products,0),
   manual_groups:excluded.length,manual_products:excluded.reduce((n,g)=>n+g.affected_products,0),
   fingerprint,confirmation_state:'NOT_APPROVED',write_enabled:false,
   eligible,manual_review:excluded,writes:0,provider_calls:0,
   note:'Preview only. No mapping is confirmed. An operator must review each eligible path; no apply mode.'};
}
async function preview(runRef,deps={}){
 const report=await (deps.proposalsAudit||proposalsAudit)(runRef,{query:deps.query||db});
 return buildPlan(report);
}
if(require.main===module){
 const args=process.argv.slice(2);
 if(args.some(x=>x==='--apply'||x.startsWith('--confirm')||x.startsWith('--write'))) {
   console.error('READ_ONLY_PREVIEW: confirmation and writes are not supported by this script');
   process.exitCode=2;
 } else {
   const run=args.find(x=>x.startsWith('--run='))?.slice(6)||'';
   preview(run).then(x=>console.log(JSON.stringify(x,null,2)))
    .catch(e=>{console.error(e.message);process.exitCode=1;})
    .finally(()=>db.pool.end());
 }
}
module.exports={preview,buildPlan};
