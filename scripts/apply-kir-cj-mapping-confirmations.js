'use strict';
/** @komerce-arch
 * @role cj-mapping-confirmation-apply
 * @domain sourcing
 * @layer script
 * @criticality medium
 * @inputs operator-approved fingerprint, run and actor
 * @outputs atomic confirmed supplier mappings
 * @depends db.js, scripts/preview-kir-cj-mapping-confirmations.js, services/supplier-commercial-category-mapping.js
 * @db-read boutique_categories, boutique_subcategories, sourcing_candidates, supplier_commercial_category_mappings, import_runtime_runs, import_runtime_item_events
 * @db-write supplier_commercial_category_mappings
 * @db-txn apply
 */
const db=require('../db');
const {preview}=require('./preview-kir-cj-mapping-confirmations');
const {confirmMapping,sourceKey}=require('../services/supplier-commercial-category-mapping');
function validate(plan,expected) {
 if(plan.fingerprint!==expected)throw new Error('STALE_PLAN_FINGERPRINT');
 if(plan.provider!=='CJdropshipping'||plan.eligible_groups!==12||plan.eligible_products!==19||
   plan.manual_groups!==1||plan.manual_products!==1||plan.inspected!==20||
   plan.eligible.length!==12||plan.manual_review.length!==1||
   !plan.manual_review[0].product_refs.includes('KSC-000143'))
   throw new Error('KIR_CJ_COHORT_CHANGED');
 const paths=new Set();
 for(const e of plan.eligible){
   if(e.decision!=='AWAITING_OPERATOR_CONFIRMATION'||e.reason!=='SOURCE_PATH_PHRASE'||
      !e.category||!e.subcategory||!e.normalized_path||paths.has(e.normalized_path))
      throw new Error('INVALID_CONFIRMATION_ENTRY');
   paths.add(e.normalized_path);
 }
 return plan;
}
async function apply(options,deps={}) {
 const {runRef,fingerprint,actor}=options;
 if(runRef!=='KIR-000008'||!/^[a-f0-9]{64}$/.test(fingerprint||'')||
   !actor||!String(actor).trim())throw new Error('EXPLICIT_CONFIRMATION_REQUIRED');
 const pool=deps.pool||db.pool;
 const client=await pool.connect();
 let began=false;
 try {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  began=true;
  const plan=validate(await (deps.preview||preview)(runRef,{query:client}),fingerprint);
  // A read-only guard on existing confirmed decisions: no silent overwrite.
  const keys=plan.eligible.map(e=>sourceKey(plan.provider,e.source_path).path);
  const {rows:existing}=await client.query(
   `SELECT source_category_path,boutique_category_key,boutique_subcategory_key,status
      FROM supplier_commercial_category_mappings
     WHERE provider=$1 AND source_category_path=ANY($2::text[]) FOR UPDATE`,
   ['cjdropshipping',keys]);
  const byPath=new Map(existing.map(x=>[x.source_category_path,x]));
  for(const e of plan.eligible){
   const old=byPath.get(e.normalized_path);
   if(old&&old.status==='CONFIRMED'&&
      (old.boutique_category_key!==e.category||old.boutique_subcategory_key!==e.subcategory))
      throw new Error('EXISTING_CONFIRMED_MAPPING_CONFLICT');
  }
  const results=[];
  for(const e of plan.eligible){
   results.push(await (deps.confirmMapping||confirmMapping)(
     {provider:plan.provider,source_category_path:e.source_path,
      category:e.category,subcategory:e.subcategory},actor,client));
  }
  await client.query('COMMIT');
  began=false;
  return {run_ref:runRef,fingerprint,confirmed_groups:results.length,
   manual_review:plan.manual_review.map(x=>({source_path:x.source_path,product_refs:x.product_refs})),
   note:'Mappings confirmed. Re-run unified coverage; this is not a catalog E2E certification.'};
 } catch(e) {
  if(began)await client.query('ROLLBACK');
  throw e;
 } finally {client.release();}
}
if(require.main===module){
 const args=process.argv.slice(2);
 const params=Object.fromEntries(args.filter(x=>x.startsWith('--')&&x.includes('='))
  .map(x=>{const i=x.indexOf('=');return [x.slice(2,i),x.slice(i+1)];}));
 if(args.some(x=>x==='--help')) {
  console.log('Usage: node scripts/apply-kir-cj-mapping-confirmations.js --run=KIR-000008 --fingerprint=<sha256 from preview> --actor=<operator> --approve=CONFIRM_12_CJ_MAPPINGS');
 } else if(args.some(x=>x==='--dry-run')||params.approve!=='CONFIRM_12_CJ_MAPPINGS') {
  console.error('NO_WRITE: pass --approve=CONFIRM_12_CJ_MAPPINGS after operator review of each proposed group.');
  process.exitCode=2;
 } else {
  apply({runRef:params.run,fingerprint:params.fingerprint,actor:params.actor})
   .then(x=>console.log(JSON.stringify(x,null,2)))
   .catch(e=>{console.error(e.message);process.exitCode=1;})
   .finally(()=>db.pool.end());
 }
}
module.exports={apply,validate};
