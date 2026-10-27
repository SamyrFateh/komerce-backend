/** @komerce-arch-lite
 * @role cj-real-staging-cohort-census
 * @domain sourcing
 * @layer tooling
 * @owner backend-core
 * @purpose Discover real CJ KIR cohorts in guarded staging; replay commercial taxonomy.
 * @db-read import_runtime_runs, import_runtime_item_events, sourcing_candidates, boutique_categories, boutique_subcategories, supplier_commercial_category_mappings
 * @db-write none
 * @impact-areas sourcing, catalog, staging-only, certification
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const db = require('../db');
const {confirmTarget} = require('./recette/target-guard');
const {audit} = require('./audit-kir-unified-commercial-coverage');
const {audit:sourceAudit} = require('./audit-kir-supplier-category-provenance');

const HOST='https://komerce-backend-production.up.railway.app';
const OUT=path.resolve('test-results/cj-staging-cohort-census/report.json');

function assertTarget(env=process.env) {
  if(env.KOMERCE_ENV!=='staging'||env.NODE_ENV==='production'
    ||env.STAGING_BASE_URL!==HOST) throw Error('CJ_CENSUS_STAGING_ONLY');
}

async function inspect({database=db,confirm=confirmTarget,replay=audit}={}) {
  assertTarget();
  const identity=await confirm({db:database});
  if(identity?.confirmed!==true) throw Error('CJ_CENSUS_STAGING_FINGERPRINT_MISMATCH');
  const q=await database.pool.connect();
  try {
    await q.query('BEGIN READ ONLY');
    await q.query("SET LOCAL statement_timeout='25000ms'");
    const {rows}=await q.query(`
      SELECT ir.id,ir.run_ref,ir.provider,ir.source_total,ir.status,
        ir.source_type,ir.mode,ir.import_id IS NOT NULL AS has_import_link,
        ir.intake,ir.stages,
        (SELECT COALESCE(jsonb_object_agg(outcome, n), '{}'::jsonb)
           FROM (SELECT COALESCE(ev.outcome,'<absent>') AS outcome,COUNT(*)::int AS n
                   FROM import_runtime_item_events ev WHERE ev.run_id=ir.id
                  GROUP BY 1) ev_counts) AS item_outcomes,
        sci.total_items AS batch_declared,sci.status AS batch_status,
        sci.ready_count,sci.quarantined_count,sci.rejected_count,sci.error_code,
        (SELECT COUNT(*)::int FROM supplier_catalog_import_rejections rej
          WHERE rej.import_id=ir.import_id) AS rejection_rows,
        (SELECT COUNT(*)::int FROM import_runtime_item_events ev
          WHERE ev.run_id=ir.id) AS event_rows,
        (SELECT COUNT(DISTINCT ev.candidate_id)::int
           FROM import_runtime_item_events ev
          WHERE ev.run_id=ir.id AND ev.candidate_id IS NOT NULL) AS event_candidates,
        (SELECT COUNT(*)::int
           FROM sourcing_candidates sc WHERE sc.import_id=ir.import_id) AS batch_candidates
      FROM import_runtime_runs ir
      LEFT JOIN supplier_catalog_imports sci ON sci.id=ir.import_id
      WHERE LOWER(ir.provider) LIKE 'cj%'
      ORDER BY ir.run_ref DESC LIMIT 50
    `);
    const {rows:[providerCount]}=await q.query(
      "SELECT COUNT(*)::int AS n,COUNT(DISTINCT import_id)::int AS batches FROM sourcing_candidates WHERE LOWER(supplier_name) LIKE 'cj%'"
    );
    const intakeFields=['accepted','duplicates','rejected','quarantined',
      'deferred','fx_pending','ready_for_refinery','certification_blocked',
      'pipeline_status','canonical_resolved'];
    const {rows:activePairs}=await q.query(
      `SELECT bc.key AS category,bc.label AS category_label,
              bs.key AS subcategory,bs.label AS subcategory_label
         FROM boutique_categories bc
         JOIN boutique_subcategories bs ON bs.category_key=bc.key
        WHERE bc.is_active=TRUE AND bs.is_active=TRUE
        ORDER BY bc.key,bs.key`
    );
    const cohorts=rows.map(r=>({
      run_ref:r.run_ref,provider:r.provider,status:r.status,
      source_type:r.source_type,mode:r.mode,has_import_link:r.has_import_link,
      intake:Object.fromEntries(intakeFields.filter(k=>r.intake?.[k]!==undefined)
        .map(k=>[k,r.intake[k]])),
      reject_reasons:Object.entries(r.intake?.reject_reasons||{}).slice(0,20)
        .map(([reason,n])=>({reason:String(reason).slice(0,200),count:Number(n||0)})),
      item_outcomes:r.item_outcomes||{},
      stages:Object.fromEntries(Object.entries(r.stages||{}).map(([k,v])=>
        [k,{started:!!v?.started_at,finished:!!v?.finished_at}])),
      batch:{declared:r.batch_declared,status:r.batch_status,
        ready:r.ready_count,quarantined:r.quarantined_count,
        rejected:r.rejected_count,error_code:r.error_code},
      rejection_rows:Number(r.rejection_rows||0),
      event_rows:Number(r.event_rows||0),
      source_total:Number(r.source_total||0),
      event_candidates:Number(r.event_candidates||0),
      batch_candidates:Number(r.batch_candidates||0),
      inspected_candidates:Number(r.event_candidates||0)>0
        ?Number(r.event_candidates):Number(r.batch_candidates),
      member_basis:Number(r.event_candidates||0)>0?'ITEM_EVENTS':'IMPORT_BATCH'
    }));
    const exact=cohorts.filter(x=>x.inspected_candidates===20);
    const larger=cohorts.filter(x=>x.inspected_candidates>=20&&x.inspected_candidates<=500);
    const chosen=exact[0]||larger[0]||null;
    let classification=null;
    if(chosen){
      const result=await replay(chosen.run_ref,{
        query:q,sourceAudit:ref=>sourceAudit(ref,q)
      });
      classification={
        run_ref:chosen.run_ref,provider:result.provider,
        inspected:result.inspected,automatic:result.auto_classifiable_products,
        unresolved:result.unresolved_products,
        manual_review:result.explicit_review_products,
        meets_exact_twenty:result.inspected===20,
        certified_20_of_20:result.inspected===20
          &&result.auto_classifiable_products===20
          &&result.unresolved_products===0
          &&result.conflicting_classifications===0,
        products:result.products.map(p=>({
          candidate_ref:p.candidate_ref,product_name:p.product_name,
          source_path:p.source_path,status:p.status,source:p.source,
          category:p.category,subcategory:p.subcategory
        }))
      };
    }
    await q.query('ROLLBACK');
    return {target:HOST,mode:'READ_ONLY',writes:0,provider_calls:0,
      cj_runs_found:cohorts.length,eligible_exact_twenty:exact.length,
      provider_candidate_population:Number(providerCount?.n||0),
      provider_candidate_batches:Number(providerCount?.batches||0),
      boutique_active_pairs:activePairs,
      candidates:cohorts,selected:chosen?.run_ref||null,
      classification,verdict:classification?.certified_20_of_20
        ?'CJ_20_CLASSIFICATION_CERTIFIED'
        :cohorts.length===0?'NO_CJ_KIR_IN_STAGING'
        :!chosen?'CJ_COHORT_BELOW_20_OR_OVER_500'
        :'CJ_CLASSIFICATION_NOT_YET_20_OF_20'};
  } catch(err) {
    await q.query('ROLLBACK').catch(()=>{});
    throw err;
  } finally {q.release();}
}

async function main() {
  fs.mkdirSync(path.dirname(OUT),{recursive:true});
  try {
    const report=await inspect();
    fs.writeFileSync(OUT,JSON.stringify(report,null,2)+'\n');
    console.log('[CJ_STAGING_CENSUS] '+JSON.stringify({
      verdict:report.verdict,found:report.cj_runs_found,
      provider_population:report.provider_candidate_population,
      run_summaries:report.candidates.map(x=>({run:x.run_ref,source_total:x.source_total,
        linked:x.has_import_link,batch:x.batch,event_rows:x.event_rows,
        rejection_rows:x.rejection_rows,intake:x.intake,
        reject_reasons:x.reject_reasons,item_outcomes:x.item_outcomes})),
      exact_twenty:report.eligible_exact_twenty,
      boutique_active_pair_count:report.boutique_active_pairs.length,
      selected:report.selected,
      classification:report.classification&&{
        inspected:report.classification.inspected,
        automatic:report.classification.automatic,
        unresolved:report.classification.unresolved
      }
    }));
    // Missing CJ cohorts are actionable evidence, not a technical error.
  } catch(e) {
    const error={verdict:'CENSUS_EXECUTION_ERROR',reason:String(e.code||e.message).slice(0,160),
      writes:0,provider_calls:0};
    fs.writeFileSync(OUT,JSON.stringify(error,null,2)+'\n');
    console.error('[CJ_STAGING_CENSUS] '+error.reason);
    process.exitCode=1;
  } finally {await db.pool.end();}
}
if(require.main===module) main();
module.exports={inspect,assertTarget};
