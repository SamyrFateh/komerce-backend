/** @komerce-arch
 * @role kir-commercial-mapping-coverage
 * @domain sourcing
 * @layer script
 * @criticality low
 * @inputs historical KIR reference, supplier category paths
 * @outputs read-only grouping by supplier taxonomy path and confirmed mapping coverage
 * @depends db.js, scripts/audit-kir-supplier-category-provenance.js, services/supplier-commercial-category-mapping.js
 * @db-read import_runtime_runs, import_runtime_item_events, sourcing_candidates, supplier_commercial_category_mappings, boutique_categories, boutique_subcategories
 * @db-write none
 * @db-txn none
 */
'use strict';
const db=require('../db');
const {audit:sourceAudit}=require('./audit-kir-supplier-category-provenance');
const {findConfirmed,normalizePath}=require('../services/supplier-commercial-category-mapping');
async function audit(runRef, deps={}) {
  const evidence=await (deps.sourceAudit || sourceAudit)(runRef);
  const find=deps.findConfirmed || findConfirmed;
  const query=deps.query || db;
  const groups=new Map();
  for(const item of evidence.items){
    const path=item.category_path.length?item.category_path.join(' > '):item.supplier_category;
    const key=normalizePath(path);
    if(!key)continue;
    if(!groups.has(key))groups.set(key,{source_path:path,source_locale:item.source_locale,product_refs:[]});
    groups.get(key).product_refs.push(item.candidate_ref);
  }
  const categories=[];
  for(const group of groups.values()){
    const mapping=await find(evidence.provider,group.source_path,query);
    categories.push({...group,count:group.product_refs.length,
      mapping:mapping||null,
      status:mapping?'AUTO_CLASSIFIABLE':'MAPPING_NEEDED'});
  }
  return {run_ref:runRef,provider:evidence.provider,inspected:evidence.inspected,
    source_category_groups:categories.length,
    auto_classifiable_products:categories.filter(g=>g.mapping).reduce((s,g)=>s+g.count,0),
    mapping_needed_groups:categories.filter(g=>!g.mapping).length,
    ungrouped_products:evidence.items.length-categories.reduce((s,g)=>s+g.count,0),
    categories,writes:0,provider_calls:0,
    note:'Read only. No customs classification, product mutation, automatic taxonomy creation or publication.'};
}
if(require.main===module){
 const run=process.argv.find(a=>a.startsWith('--run='))?.slice(6)||'';
 audit(run).then(x=>console.log(JSON.stringify(x,null,2)))
   .catch(e=>{console.error(e.message);process.exitCode=1;})
   .finally(()=>db.pool.end());
}
module.exports={audit};
