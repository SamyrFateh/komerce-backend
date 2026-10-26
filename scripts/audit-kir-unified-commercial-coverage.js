/** @komerce-arch
 * @role kir-unified-commercial-coverage
 * @domain sourcing
 * @layer script
 * @criticality low
 * @inputs historical KIR reference and persisted sourcing candidates
 * @outputs per-product unified classification coverage and grouped exceptions
 * @depends db.js, scripts/audit-kir-supplier-category-provenance.js, services/catalog-candidate-product-service.js
 * @db-read import_runtime_runs, import_runtime_item_events, sourcing_candidates, supplier_commercial_category_mappings, boutique_categories, boutique_subcategories
 * @db-write none
 * @db-txn none
 */
'use strict';
const db=require('../db');
const {audit:sourceAudit}=require('./audit-kir-supplier-category-provenance');
const {resolveCommercialTaxonomyVerdict}=require('../services/catalog-candidate-product-service');
const {normalizePath}=require('../services/supplier-commercial-category-mapping');

async function audit(runRef,deps={}) {
  const provenance=await (deps.sourceAudit||sourceAudit)(runRef);
  const q=deps.query||db;
  const verdict=deps.resolveVerdict||resolveCommercialTaxonomyVerdict;
  const refs=provenance.items.map(x=>x.candidate_ref).filter(Boolean);
  const {rows}=refs.length?await q.query(
    'SELECT candidate_ref,product_name,supplier_name,supplier_category,normalized_source_contract,raw_payload,commercial_taxonomy_review FROM sourcing_candidates WHERE candidate_ref=ANY($1::text[])',
    [refs]):{rows:[]};
  const byRef=new Map(rows.map(row=>[row.candidate_ref,row]));
  const results=[];
  for(const item of provenance.items) {
    const candidate=byRef.get(item.candidate_ref);
    if(!candidate) {
      results.push({candidate_ref:item.candidate_ref,status:'REVIEW_REQUIRED',source:'CANDIDATE_MISSING',source_path:item.supplier_category||item.category_path.join(' > ')});
      continue;
    }
    // Re-run classification without saved discovery hints or historical human
    // review, so coverage measures what a fresh import can reproduce.
    const historical=candidate.commercial_taxonomy_review?.status==='CONFIRMED'
      ? {category:candidate.commercial_taxonomy_review.category,
        subcategory:candidate.commercial_taxonomy_review.subcategory,
        source:'CONFIRMED_REVIEW'}
      : candidate.raw_payload?.discovery?.target_category
        ? {category:candidate.raw_payload.discovery.target_category,
          subcategory:candidate.raw_payload.discovery.target_subcategory,
          source:'DISCOVERY_HINT'} : null;
    const replay={...candidate,commercial_taxonomy_review:null,
      raw_payload:{...(candidate.raw_payload||{}),discovery:null}};
    const decision=await verdict(q,replay);
    const mismatch=historical?.category && decision.status==='AUTO_CLASSIFIED'
      && (historical.category!==decision.category || historical.subcategory!==decision.subcategory);
    results.push({candidate_ref:item.candidate_ref,product_name:candidate.product_name||null,
      status:mismatch?'REVIEW_REQUIRED':decision.status,
      source:mismatch?'HISTORICAL_CLASSIFICATION_CONFLICT':decision.source,
      category:mismatch?null:decision.category,subcategory:mismatch?null:decision.subcategory,
      historical_category:historical?.category||null,
      historical_subcategory:historical?.subcategory||null,
      historical_source:historical?.source||null,
      source_path:item.category_path.length?item.category_path.join(' > '):item.supplier_category});
  }
  const automatic=results.filter(x=>x.status==='AUTO_CLASSIFIED');
  const human=results.filter(x=>x.status==='REVIEW_REQUIRED');
  const explicit=results.filter(x=>x.status==='EXPLICIT_REVIEW');
  const groups=new Map();
  for(const item of human){
    const path=normalizePath(item.source_path)||'__MISSING_SOURCE_CATEGORY__';
    if(!groups.has(path)) groups.set(path,{source_path:item.source_path||null,affected_products:0,sample_product_refs:[]});
    const group=groups.get(path); group.affected_products++;
    if(group.sample_product_refs.length<3)group.sample_product_refs.push(item.candidate_ref);
  }
  const ordered=[...groups.values()].sort((a,b)=>b.affected_products-a.affected_products
    || String(a.source_path).localeCompare(String(b.source_path)));
  const count=results.length;
  return {run_ref:runRef,provider:provenance.provider,inspected:count,
    auto_classifiable_products:automatic.length,
    automatic_coverage_pct:count?Number((100*automatic.length/count).toFixed(2)):0,
    target_pct:95,target_met:count>0 && automatic.length/count>=0.95,
    via_supplier_mapping:automatic.filter(x=>x.source==='CONFIRMED_SUPPLIER_PATH').length,
    via_object_name:automatic.filter(x=>x.source==='OBJECT_NAME_MATCH').length,
    explicit_review_products:explicit.length,
    historically_classified_products:results.filter(x=>x.historical_category && x.historical_subcategory).length,
    conflicting_classifications:results.filter(x=>x.source==='HISTORICAL_CLASSIFICATION_CONFLICT').length,
    unresolved_products:human.length,
    human_review_groups:ordered.length,
    review_workpack:ordered.slice(0,10),deferred_review_groups:Math.max(0,ordered.length-10),
    products:results,writes:0,provider_calls:0,
    note:'Read only. Classification prediction, not proof of catalog creation or human visual approval.'};
}
if(require.main===module){
  const run=process.argv.find(a=>a.startsWith('--run='))?.slice(6)||'';
  audit(run).then(x=>console.log(JSON.stringify(x,null,2)))
    .catch(e=>{console.error(e.message);process.exitCode=1;})
    .finally(()=>db.pool.end());
}
module.exports={audit};
