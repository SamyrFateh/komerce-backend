/**
 * @komerce-arch-lite
 * @role staging-p1-commercial-category-mapping-review
 * @domain catalog
 * @layer tooling
 * @owner backend-core
 * @purpose Read-only source-specific commercial taxonomy audit before any P1 promotion.
 * @db-read import_runtime_runs, import_runtime_item_events, sourcing_candidates, supplier_commercial_category_mappings, boutique_categories, boutique_subcategories
 * @db-write none
 * @impact-areas sourcing, catalog, staging-only, e2e-certification
 */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {audit:categoryAudit}=require('../audit-kir-unified-commercial-coverage');
const {audit:sourceAudit}=require('../audit-kir-supplier-category-provenance');
const {resolveCommercialTaxonomyVerdict}=require('../../services/catalog-candidate-product-service');
const {evaluateSourcingCandidateOutcome}=require('../../services/sourcing-certification');

const HOST='https://komerce-backend-production.up.railway.app';
const REF='KIR-000009';
const OUTPUT=path.resolve('test-results/staging-p1-20/commercial-taxonomy-review.json');

function inputs(env=process.env){
  if(env.KOMERCE_ENV!=='staging'||env.NODE_ENV==='production'
    ||env.STAGING_BASE_URL!==HOST)throw Error('STAGING_ONLY');
  return REF;
}
function summarize(rows){
  const total=rows.length, promotable=rows.filter(x=>x.sourcing_certified&&!x.catalog_linked);
  return {
    inspected:total,
    sourced_certified:rows.filter(x=>x.sourcing_certified).length,
    promotable_source_candidates:promotable.length,
    promotable_with_active_commercial_taxonomy:promotable.filter(x=>x.commercial_taxonomy_active).length,
    promotable_blocked_taxonomy:promotable.filter(x=>!x.commercial_taxonomy_active).length,
    needs_review:rows.filter(x=>x.taxonomy.status==='REVIEW_REQUIRED').length,
    no_business_writes:true
  };
}
async function inspect({database=db,confirm=confirmTarget}={}){
  inputs();
  const target=await confirm({db:database});
  if(target?.confirmed!==true)throw Error('STAGING_DB_FINGERPRINT_MISMATCH');
  const tx=await database.pool.connect();
  try {
    await tx.query('BEGIN READ ONLY');
    await tx.query("SET LOCAL statement_timeout='15000ms'");
    const basic=await categoryAudit(REF,{
      query:tx,
      sourceAudit:ref=>sourceAudit(ref,tx),
    });
    const {rows:[run]}=await tx.query(
      'SELECT import_id FROM import_runtime_runs WHERE run_ref=$1',[REF]);
    if(!run)throw Error('SOURCE_RUN_NOT_FOUND');
    const {rows}=await tx.query(
      `SELECT * FROM sourcing_candidates WHERE import_id=$1
       ORDER BY supplier_product_id, id`,[run.import_id]);
    const results=[];
    for(const candidate of rows){
      const decision=evaluateSourcingCandidateOutcome(candidate);
      const tax=await resolveCommercialTaxonomyVerdict(tx,candidate);
      let active=false;
      if(tax.category&&tax.subcategory){
        const pair=await tx.query(
          `SELECT 1 FROM boutique_categories bc
            JOIN boutique_subcategories bs ON bs.category_key=bc.key
           WHERE bc.key=$1 AND bs.key=$2
             AND bc.is_active=TRUE AND bs.is_active=TRUE LIMIT 1`,
          [tax.category,tax.subcategory]);
        active=pair.rows.length===1;
      }
      const note=basic.products.find(x=>x.candidate_ref===candidate.candidate_ref)||null;
      results.push({
        candidate_ref:candidate.candidate_ref,
        supplier_product_id:candidate.supplier_product_id,
        sourcing_decision:decision.decision,
        sourcing_certified:decision.sourcing_certified,
        catalog_linked:Boolean(candidate.product_id),
        taxonomy:{
          status:tax.status,source:tax.source,
          category:tax.category||null,subcategory:tax.subcategory||null,
        },
        commercial_taxonomy_active:active,
        source_path:note?.source_path||null,
        independent_classification:note?{
          status:note.status,source:note.source,
          category:note.category||null,subcategory:note.subcategory||null,
          historical_category:note.historical_category||null,
          historical_subcategory:note.historical_subcategory||null,
        }:null,
        blocker:decision.sourcing_certified&&!candidate.product_id&&!active
          ?'HUMAN_COMMERCIAL_TAXONOMY_REVIEW_REQUIRED':null
      });
    }
    await tx.query('ROLLBACK');
    return {
      schema_version:1,source_run:REF,target:HOST,
      generated_at:new Date().toISOString(),
      immutable_import_unchanged:true,
      automatic_coverage_pct:basic.automatic_coverage_pct,
      automatic_coverage_target_met:basic.target_met,
      source_mapping_workpack:basic.review_workpack,
      summary:summarize(results),candidates:results,writes:0
    };
  }catch(error){
    await tx.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{tx.release();}
}
async function main(){
  fs.mkdirSync(path.dirname(OUTPUT),{recursive:true});
  let report;
  try{
    report=await inspect();
    console.log('[P1-TAXONOMY] '+JSON.stringify({
      run:report.source_run,summary:report.summary,
      automatic_coverage_pct:report.automatic_coverage_pct,
      review:report.source_mapping_workpack
    }));
  }catch(error){
    report={status:'READ_ONLY_AUDIT_FAILED',
      reason:String(error.code||error.message).slice(0,150),
      writes:0,source_run:REF};
    process.exitCode=2;
    console.error('[P1-TAXONOMY] '+report.reason);
  }finally{
    fs.writeFileSync(OUTPUT,JSON.stringify(report,null,2)+'\n');
    await db.pool.end();
  }
}
if(require.main===module)main();
module.exports={inputs,summarize,inspect};
