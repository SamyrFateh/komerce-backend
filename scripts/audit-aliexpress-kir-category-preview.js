/** @komerce-arch
 * @role aliexpress-kir-category-preview
 * @domain sourcing
 * @layer script
 * @criticality low
 * @inputs KIR run ref, persisted sourcing candidates, active classification config
 * @outputs JSON read-only category preview for exact KIR membership
 * @depends services/customs-dynamic-category-classifier
 * @db-read import_runtime_runs, import_runtime_item_events, sourcing_candidates, customs_categories, boutique_subcategories
 * @db-write none
 * @db-txn none
 * @impact-areas sourcing, customs
 */
'use strict';
const db = require('../db');
const pricing = require('../services/pricing-engine');
const classifier = require('../services/customs-dynamic-category-classifier');

function preview(rows, config, productIds = []) {
  const requested = new Set(productIds.map(String));
  const categories = Object.values(config.categories || {})
    .filter(row => row && row.is_active !== false);
  const items = rows.filter(row => !requested.size || requested.has(String(row.supplier_product_id)));
  return {
    present: items.length,
    missing_supplier_product_ids: [...requested].filter(id => !items.some(row => String(row.supplier_product_id) === id)),
    items:items.map(row => {
      const current = row.scan_result || {};
      const prediction = classifier.classifySupplierProduct({
        product_name:row.product_name,
        supplier_category:row.supplier_category,
        description:row.description,
        raw_payload:row.raw_payload || {},
      },categories,{boutique_customs_affinities:config.boutique_customs_affinities || []});
      return {
        candidate_id:row.id,
        candidate_ref:row.candidate_ref,
        supplier_product_id:row.supplier_product_id,
        title:row.product_name,
        saved_customs_category:row.komerce_category,
        saved_decision:current.sourcing_decision || null,
        prediction:{
          key:prediction.source === 'default' ? null : prediction.key,
          source:prediction.source,
          confidence:prediction.confidence,
          reason:prediction.reason,
          score:prediction.score,
          second_candidate_key:prediction.second_candidate_key || null,
          second_score:prediction.second_score || 0,
          evidence:(prediction.evidence || []).slice(0,15)
        },
        safe_to_auto_rescan:prediction.source === 'mapped'
          && prediction.confidence === 'high'
          && !prediction.second_candidate_key,
      };
    })
  };
}
async function audit(runRef, productIds = [], deps = {
  query:(...args) => db.query(...args),
  loadConfig:() => pricing.loadGlobalConfig(),
}) {
  if (!/^KIR-\\d{6}$/.test(runRef)) throw new Error('KIR_REF_INVALID');
  const {rows:[run]} = await deps.query(
    'SELECT id,run_ref,provider,source_total FROM import_runtime_runs WHERE run_ref=$1',[runRef]);
  if (!run) throw new Error('KIR_NOT_FOUND');
  if (!/aliexpress/i.test(run.provider)) throw new Error('KIR_NOT_ALIEXPRESS');
  const {rows} = await deps.query(
    `WITH membership AS (
       SELECT DISTINCT candidate_id FROM import_runtime_item_events
       WHERE run_id=$1 AND candidate_id IS NOT NULL
     ), flag AS (SELECT EXISTS(SELECT 1 FROM membership) AS has_events)
     SELECT sc.id,sc.candidate_ref,sc.supplier_product_id,sc.product_name,
            sc.supplier_category,sc.description,sc.komerce_category,sc.raw_payload,sc.scan_result
     FROM import_runtime_runs r CROSS JOIN flag
     JOIN sourcing_candidates sc ON
       ((flag.has_events AND sc.id IN (SELECT candidate_id FROM membership))
        OR (NOT flag.has_events AND sc.import_id=r.import_id))
     WHERE r.id=$1 ORDER BY sc.candidate_ref LIMIT 101`,[run.id]);
  if (rows.length > 100) throw new Error('AUDIT_LIMIT_100');
  return {run_ref:run.run_ref,provider:run.provider,source_total:run.source_total,
    ...preview(rows,await deps.loadConfig(),productIds),
    note:'READ ONLY. Prediction uses CURRENT taxonomy, not historical taxonomy. No supplier calls or DB updates.',
    db_writes:0,provider_api_calls:0};
}
if (require.main === module) {
  const runRef = process.argv.find(a => a.startsWith('--run='))?.slice(6) || '';
  const ids = process.argv.filter(a => a.startsWith('--supplier-id=')).map(a=>a.slice(14));
  audit(runRef,ids).then(out => console.log(JSON.stringify(out,null,2)))
    .catch(e => {console.error(e.message);process.exitCode=1;})
    .finally(()=>db.pool.end());
}
module.exports={preview,audit};
