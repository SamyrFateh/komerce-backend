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
        (SELECT COUNT(DISTINCT ev.candidate_id)::int
           FROM import_runtime_item_events ev
          WHERE ev.run_id=ir.id AND ev.candidate_id IS NOT NULL) AS event_candidates,
        (SELECT COUNT(*)::int
           FROM sourcing_candidates sc WHERE sc.import_id=ir.import_id) AS batch_candidates
      FROM import_runtime_runs ir
      WHERE LOWER(ir.provider) LIKE 'cj%'
      ORDER BY ir.run_ref DESC LIMIT 50
    `);
    const cohorts=rows.map(r=>({
      run_ref:r.run_ref,provider:r.provider,status:r.status,
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
      exact_twenty:report.eligible_exact_twenty,
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
