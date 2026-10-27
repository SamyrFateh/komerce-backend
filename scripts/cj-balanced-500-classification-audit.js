#!/usr/bin/env node
/** @komerce-arch-lite
 * @role cj-balanced-real-candidate-classification-audit
 * @domain sourcing
 * @layer tooling
 * @owner backend-core
 * @purpose Preserve per-product semantic classification evidence from disposable real-CJ batches, including incomplete batches.
 * @db-read sourcing_candidates, boutique_categories, boutique_subcategories, supplier_commercial_category_mappings
 * @db-write none
 * @impact-areas sourcing, catalog, isolated-ci-only, certification
 */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const db=require('../db');
const {resolveCommercialTaxonomyVerdict}=require('../services/catalog-candidate-product-service');
const {semanticConflict}=require('../services/commercial-taxonomy-semantics');

const EXPECTED_URL='postgresql://komerce:komerce@127.0.0.1:5432/komerce_real_catalog_stress';
const CAMPAIGN='cj-balanced-e2e-500-v1';
const OUTPUT=path.resolve('artifacts/cj-balanced-e2e-500/classification-evidence.json');
const inc=(o,key)=>{o[key]=(o[key]||0)+1;};
const isString=x=>typeof x==='string'&&x.trim().length>0;
// Product discovery search targets are unverified input, never a human
// confirmation. Remove only target fields while preserving source identity,
// category breadcrumb, title and canonical candidate fields.
function stripUnconfirmedDiscoveryTarget(candidate={}) {
  const raw={...(candidate.raw_payload||{})};
  const discovery={...(raw.discovery||{})};
  delete discovery.target_category;
  delete discovery.target_subcategory;
  raw.discovery=discovery;
  return {...candidate,raw_payload:raw};
}
function assertIsolated(env=process.env){
  if(env.GITHUB_ACTIONS!=='true'||env.NODE_ENV!=='test'
    ||env.KOMERCE_ENV!=='staging'||env.DATABASE_URL!==EXPECTED_URL
    ||env.KOMERCE_DISABLE_CRONS!=='true')
    throw Error('ISOLATED_CLASSIFICATION_AUDIT_ONLY');
}
function buildReport(items,{target=500,activePairs=[]}={}){
  if(!Array.isArray(items)||!Array.isArray(activePairs))throw Error('AUDIT_INPUT_INVALID');
  const bySegment={},byEvidence={},byPair={},byStatus={},seenIds=new Set();
  const details=[],risks=[];
  for(const item of items){
    const c=item.candidate||{},v=item.verdict||{},disc=c.raw_payload?.discovery||{};
    const operational=item.operationalVerdict||null;
    const ref=String(c.candidate_ref||'');
    const supplierId=String(c.supplier_product_id||'');
    const key=String(disc.segment_id||'NO_SEGMENT');
    const picked=v.category&&v.subcategory?v.category+'/'+v.subcategory:null;
    const intended=disc.target_category&&disc.target_subcategory
      ?disc.target_category+'/'+disc.target_subcategory:null;
    const auto=v.status==='AUTO_CLASSIFIED';
    const source=String(v.source||'UNSPECIFIED');
    const actualConflict=auto?semanticConflict(c,v):null;
    const reasons=[];
    if(source==='OPERATOR_OR_DISCOVERY')reasons.push('UNVERIFIED_DISCOVERY_TARGET_MASKS_INDEPENDENT_CLASSIFIER');
    if(operational?.source==='OPERATOR_OR_DISCOVERY')reasons.push('PRODUCTION_DISCOVERY_PROPOSAL_UNVERIFIED');
    if(!isString(supplierId)||seenIds.has(supplierId))reasons.push('MISSING_OR_DUPLICATE_SUPPLIER_ID');
    seenIds.add(supplierId);
    if(auto&&!activePairs.some(p=>p.category===v.category&&p.subcategory===v.subcategory))
      reasons.push('DESTINATION_NOT_ACTIVE');
    if(actualConflict)reasons.push('SEMANTIC_CONTRADICTION:'+actualConflict);
    // A discovery keyword/target is metadata, never an independent truth label.
    if(auto&&intended&&picked!==intended)reasons.push('DISCOVERY_TARGET_MISMATCH_REVIEW_ONLY');
    if(auto&&['PRODUCT_IDENTITY_MATCH','SUPPLIER_CATEGORY_MATCH','KNOWN_COMMERCIAL_MAPPING','CONFIRMED_SUPPLIER_PATH'].includes(source))
      reasons.push('INDEPENDENT_SEMANTIC_REVIEW_REQUIRED');
    const d={candidate_ref:ref,supplier_product_id:supplierId,
      product_name:c.product_name||null,supplier_category:c.supplier_category||null,
      segment_id:key,discovery_keyword:disc.keyword||null,discovery_target:intended,
      status:v.status||'NO_VERDICT',category:v.category||null,subcategory:v.subcategory||null,
      operational_status:operational?.status||null,
      operational_evidence:operational?.source||null,
      operational_category:operational?.category||null,
      operational_subcategory:operational?.subcategory||null,
      evidence:source,conflict:actualConflict||null,review_flags:reasons,
      fx_gate:c.scan_result?.fx_gate?.status||null,
      candidate_state:c.state||null,publication_linked:Boolean(c.product_id)};
    details.push(d);
    inc(byEvidence,source);inc(byStatus,d.status);
    if(auto)inc(byPair,picked);
    const seg=bySegment[key]||(bySegment[key]={total:0,automatic:0,review:0,discordant_metadata:0,semantic_conflicts:0});
    seg.total++;
    if(auto)seg.automatic++;else seg.review++;
    if(reasons.some(x=>x.startsWith('DISCOVERY_TARGET_MISMATCH')))seg.discordant_metadata++;
    if(actualConflict||source.includes('CONTRADICTION')||source.includes('CONFLICT'))seg.semantic_conflicts++;
    if(reasons.length||!auto)risks.push({ref,segment:key,reasons:reasons.length?reasons:[source]});
  }
  details.sort((a,b)=>a.candidate_ref.localeCompare(b.candidate_ref));
  const total=details.length,automatic=byStatus.AUTO_CLASSIFIED||0;
  return {kind:'INDEPENDENT_READ_ONLY_CLASSIFICATION_DIAGNOSTIC',
    certification:'NOT_ASSERTED',target,inspected:total,shortfall:Math.max(0,target-total),
    automatic,needs_review:total-automatic,by_status:byStatus,
    by_evidence:byEvidence,by_category:byPair,by_segment:bySegment,
    active_pair_count:activePairs.length,
    metadata_mismatches:risks.filter(r=>r.reasons.some(z=>z.startsWith('DISCOVERY_TARGET_MISMATCH'))).length,
    explicit_semantic_conflicts:risks.filter(r=>r.reasons.some(z=>z.startsWith('SEMANTIC_CONTRADICTION'))).length,
    proposal_masking_independent:details.filter(d=>d.operational_evidence==='OPERATOR_OR_DISCOVERY').length,
    independent_without_discovery:true,
    publication_linked:details.filter(d=>d.publication_linked).length,
    note:'AUTO_CLASSIFIED is not proof of correctness. Discovery targets and search keywords are NOT semantic ground truth. Review product names and source breadcrumbs before GO.',
    products:details};
}
async function run({query=db,output=OUTPUT}={}){
  assertIsolated();
  const {rows:identity}=await query.query('SELECT current_database() AS name');
  if(identity[0]?.name!=='komerce_real_catalog_stress')throw Error('DISPOSABLE_DATABASE_NAME_MISMATCH');
  const {rows:activePairs}=await query.query(`SELECT bc.key AS category,bs.key AS subcategory
    FROM boutique_categories bc JOIN boutique_subcategories bs ON bs.category_key=bc.key
    WHERE bc.is_active=TRUE AND bs.is_active=TRUE`);
  const {rows:candidates}=await query.query(`SELECT candidate_ref,supplier_product_id,
    product_name,supplier_category,normalized_source_contract,raw_payload,
    commercial_taxonomy_review,state,scan_result,product_id
    FROM sourcing_candidates
    WHERE supplier_name='CJdropshipping' AND raw_payload->'discovery'->>'campaign'=$1
    ORDER BY candidate_ref`,[CAMPAIGN]);
  const items=[];
  for(const candidate of candidates){
    const operationalVerdict=await resolveCommercialTaxonomyVerdict(query,candidate);
    const verdict=await resolveCommercialTaxonomyVerdict(query,stripUnconfirmedDiscoveryTarget(candidate));
    items.push({candidate,verdict,operationalVerdict});
  }
  const report=buildReport(items,{activePairs});
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log('[CJ_500_CLASSIFICATION] '+JSON.stringify({
    inspected:report.inspected,target:report.target,automatic:report.automatic,
    needs_review:report.needs_review,by_evidence:report.by_evidence,
    by_category:report.by_category,active_pairs:report.active_pair_count,
    metadata_mismatches:report.metadata_mismatches,
    proposal_masking_independent:report.proposal_masking_independent,
    independent_without_discovery:report.independent_without_discovery,
    semantic_conflicts:report.explicit_semantic_conflicts,
    publication_linked:report.publication_linked}));
  return report;
}
if(require.main===module){
  run().catch(e=>{console.error('[CJ_500_CLASSIFICATION] '+e.stack);process.exitCode=1;})
    .finally(()=>db.pool.end());
}
module.exports={assertIsolated,stripUnconfirmedDiscoveryTarget,buildReport,run};
