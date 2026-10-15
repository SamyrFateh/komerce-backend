/** @komerce-arch
 * @role kir-commercial-category-preview
 * @domain sourcing
 * @layer script
 * @criticality low
 * @inputs KIR ref and supplier product IDs
 * @outputs read-only commercial proposals, separate from customs decisions
 * @depends scripts/audit-aliexpress-kir-category-preview, services/catalog-candidate-product-service
 * @db-read import_runtime_runs, import_runtime_item_events, sourcing_candidates, boutique_categories, boutique_subcategories
 * @db-write none
 * @db-txn none
 */
'use strict';
const db = require('../db');
const { audit } = require('./audit-aliexpress-kir-category-preview');
const { resolveCommercialObjectTaxonomy } = require('../services/catalog-candidate-product-service');

async function inspect(runRef, supplierIds, deps = {}) {
  const runAudit = deps.audit || audit;
  const resolve = deps.resolve || resolveCommercialObjectTaxonomy;
  const query = deps.query || db;
  if (!supplierIds.length) throw new Error('SUPPLIER_IDS_REQUIRED');
  const result = await runAudit(runRef, supplierIds);
  const items = await Promise.all(result.items.map(async item => {
    const proposal = await resolve(query, {product_name:item.title});
    return {
      candidate_ref:item.candidate_ref,
      supplier_product_id:item.supplier_product_id,
      commercial_proposal:proposal.category && proposal.subcategory
        ? {category:proposal.category,subcategory:proposal.subcategory,status:'PROPOSED_NOT_APPLIED'}
        : {category:null,subcategory:null,status:'REVIEW_REQUIRED'},
      customs_category:item.saved_customs_category,
      customs_prediction:item.prediction.key,
      customs_validated:false,
      safe_to_promote:false,
    };
  }));
  return {
    run_ref:result.run_ref,
    missing_supplier_product_ids:result.missing_supplier_product_ids,
    items,
    db_writes:0,
    supplier_calls:0,
    note:'READ ONLY: commercial proposals are not customs classification or permission to publish.',
  };
}

if (require.main === module) {
  const run = process.argv.find(a=>a.startsWith('--run='))?.slice(6) || '';
  const ids = process.argv.filter(a=>a.startsWith('--supplier-id=')).map(a=>a.slice(14));
  inspect(run,ids).then(result=>console.log(JSON.stringify(result,null,2)))
    .catch(err=>{console.error(err.message);process.exitCode=1;})
    .finally(()=>db.pool.end());
}
module.exports={inspect};
