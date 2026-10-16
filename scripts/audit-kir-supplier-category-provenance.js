/** @komerce-arch
 * @role supplier-category-source-audit
 * @domain sourcing
 * @layer script
 * @criticality low
 * @inputs historical KIR run reference, persisted source payload
 * @outputs read-only supplier category provenance and mapping readiness
 * @depends db.js
 * @db-read import_runtime_runs, import_runtime_item_events, sourcing_candidates
 * @db-write none
 * @db-txn none
 */
'use strict';
const db = require('../db');

function clean(value) {
  return value == null ? null : String(value).trim().slice(0, 250) || null;
}
function sourceCategory(row) {
  const raw = row.raw_payload || {};
  const ae = raw.aliexpress || {};
  const feed = ae.feed || {};
  const detail = ae.detail || {};
  const cj = raw.cj || {};
  const isCj = /cj/i.test(row.provider || raw.source || '');
  const path = (isCj
    ? [cj.oneCategoryName, cj.twoCategoryName, cj.threeCategoryName]
    : [feed.first_level_category_name, feed.second_level_category_name])
    .map(clean).filter(Boolean);
  const categoryId = isCj
    ? clean(cj.categoryId ?? cj.category_id ?? cj.cid)
    : clean(detail.category_id ?? detail.categoryId ?? feed.category_id ?? feed.categoryId
      ?? ae.category_id ?? raw.category_id);
  return {
    supplier_product_id:clean(row.supplier_product_id),
    candidate_ref:clean(row.candidate_ref),
    supplier_category:clean(row.supplier_category),
    category_id:categoryId,
    category_path:path,
    source_locale:clean(raw.source_locale || (isCj ? 'en' : feed.source_locale)) || null,
    missing_category_metadata:!categoryId && !path.length && !clean(row.supplier_category),
  };
}
async function audit(runRef, deps=db) {
  if (!/^KIR-\d{6}$/.test(runRef)) throw new Error('KIR_REF_INVALID');
  const {rows:[run]} = await deps.query(
    'SELECT id,run_ref,provider,source_total FROM import_runtime_runs WHERE run_ref=$1',[runRef]);
  if (!run) throw new Error('KIR_NOT_FOUND');
  const {rows} = await deps.query(
    `WITH members AS (
      SELECT DISTINCT candidate_id FROM import_runtime_item_events
      WHERE run_id=$1 AND candidate_id IS NOT NULL
    ), flag AS (SELECT EXISTS(SELECT 1 FROM members) AS has_events)
    SELECT sc.candidate_ref,sc.supplier_product_id,sc.supplier_category,sc.raw_payload
    FROM import_runtime_runs ir CROSS JOIN flag
    JOIN sourcing_candidates sc ON
      ((flag.has_events AND sc.id IN (SELECT candidate_id FROM members))
        OR (NOT flag.has_events AND sc.import_id=ir.import_id))
    WHERE ir.id=$1 ORDER BY sc.candidate_ref LIMIT 501`,[run.id]);
  if (rows.length > 500) throw new Error('AUDIT_LIMIT_500');
  const items=rows.map(row=>sourceCategory({...row,provider:run.provider}));
  return {
    run_ref:run.run_ref,provider:run.provider,source_total:run.source_total,
    inspected:items.length,
    with_category_id:items.filter(x=>x.category_id).length,
    with_category_path:items.filter(x=>x.category_path.length).length,
    with_supplier_category:items.filter(x=>x.supplier_category).length,
    missing_category_metadata:items.filter(x=>x.missing_category_metadata).length,
    items,
    writes:0,provider_calls:0,
    note:'Historical source-language evidence only; does not classify customs, translate, or mutate products.',
  };
}
if(require.main===module){
  const run=process.argv.find(a=>a.startsWith('--run='))?.slice(6)||'';
  audit(run).then(x=>console.log(JSON.stringify(x,null,2)))
    .catch(e=>{console.error(e.message);process.exitCode=1;})
    .finally(()=>db.pool.end());
}
module.exports={audit,sourceCategory};
