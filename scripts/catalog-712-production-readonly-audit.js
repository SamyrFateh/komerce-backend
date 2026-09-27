#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          catalog-712-production-readonly-audit
 * @domain        catalog
 * @layer         tooling
 * @criticality   high
 * @inputs        production DATABASE_URL, exact catalog-e2e-712 identity authority
 * @outputs       read-only production presence/readiness audit for the exact 712 identities
 * @depends       db.js, scripts/catalog-e2e-712-identities.js
 * @used-by       ali-e2e-200-worker catalog-712-production-readonly-audit mode
 * @db-read       sourcing_candidates, products, catalog_media, product_skus, product_market_exposure
 * @db-write      none
 * @db-txn        none
 * @doctrine      exact_identity_authority, read_only, no_provider_calls
 * @impact-areas  catalog, production-catalog
 * @version       2026-09-v1
 */
'use strict';

const db=require('../db');
const {buildExpectedCjIds,ALI_TARGET,TOTAL_TARGET}=require('./catalog-e2e-712-identities');

const ALI_WAVE='incremental-e2e-200-v1';

async function expectedAliIds(){
  const {rows}=await db.query(
    `SELECT supplier_product_id
       FROM sourcing_candidates
      WHERE supplier_name='AliExpress'
        AND raw_payload #>> '{discovery,wave}'=$1
      ORDER BY supplier_product_id`,
    [ALI_WAVE]
  );
  const ids=[...new Set(rows.map(r=>String(r.supplier_product_id)))];
  if(ids.length!==ALI_TARGET) throw new Error(`PROD_712_ALI_IDENTITY_COUNT:${ids.length}/${ALI_TARGET}`);
  return ids;
}
async function auditSupplier(supplier,ids){
  const {rows}=await db.query(
    `WITH media AS (
       SELECT product_id,COUNT(*) FILTER (WHERE is_active=TRUE)::int media_count
         FROM catalog_media GROUP BY product_id
     ), sku AS (
       SELECT product_id,
              COUNT(*) FILTER (WHERE source='SUPPLIER' AND is_active=TRUE)::int active_skus,
              COUNT(*) FILTER (
                WHERE source='SUPPLIER' AND is_active=TRUE
                  AND supplier_unit_ref IS NOT NULL
                  AND supplier_order_identity IS NOT NULL
              )::int complete_skus
         FROM product_skus GROUP BY product_id
     ), exposure AS (
       SELECT product_id,COUNT(*) FILTER (WHERE commercial_exposure='ENABLED')::int enabled_markets
         FROM product_market_exposure GROUP BY product_id
     )
     SELECT sc.supplier_name,sc.supplier_product_id,sc.state,sc.product_id,
            UPPER(COALESCE(sc.scan_result->>'sourcing_decision','UNKNOWN')) decision,
            p.lifecycle_status,p.is_active,p.content_source,p.needs_review,
            p.boutique_category_key,p.boutique_subcategory_key,
            COALESCE(media.media_count,0)::int media_count,
            COALESCE(sku.active_skus,0)::int active_skus,
            COALESCE(sku.complete_skus,0)::int complete_skus,
            COALESCE(exposure.enabled_markets,0)::int enabled_markets
       FROM sourcing_candidates sc
       LEFT JOIN products p ON p.id=sc.product_id
       LEFT JOIN media ON media.product_id=p.id
       LEFT JOIN sku ON sku.product_id=p.id
       LEFT JOIN exposure ON exposure.product_id=p.id
      WHERE sc.supplier_name=$1
        AND sc.supplier_product_id=ANY($2::text[])
      ORDER BY sc.supplier_product_id`,
    [supplier,ids]
  );
  return rows;
}
function summarize(rows,expected){
  const identities=new Set(rows.map(r=>`${r.supplier_name}\u0000${r.supplier_product_id}`));
  const productIds=rows.filter(r=>r.product_id!=null).map(r=>String(r.product_id));
  const ready=rows.filter(r=>
    r.state==='imported_to_catalog'
    && r.product_id!=null
    && ['TEST','PRIORITY'].includes(r.decision)
    && r.lifecycle_status==='candidate'
    && r.is_active===false
    && r.content_source==='manual'
    && r.needs_review===false
    && r.boutique_category_key
    && r.boutique_subcategory_key
    && Number(r.media_count)>0
    && Number(r.active_skus)>0
    && Number(r.complete_skus)===Number(r.active_skus)
    && Number(r.enabled_markets)===0
  );
  return {
    expected,
    rows:rows.length,
    distinct_supplier_identities:identities.size,
    distinct_product_ids:new Set(productIds).size,
    imported_to_catalog:rows.filter(r=>r.state==='imported_to_catalog'&&r.product_id!=null).length,
    ready:ready.length,
    enabled_market_exposure:rows.filter(r=>Number(r.enabled_markets)>0).length,
    rejected_or_excluded:rows.filter(r=>r.state==='rejected'||r.decision==='EXCLUDED').length,
  };
}
async function run(){
  const cj=buildExpectedCjIds(process.env).all;
  const ali=await expectedAliIds();
  const [aliRows,cjRows]=await Promise.all([
    auditSupplier('AliExpress',ali),
    auditSupplier('CJdropshipping',cj),
  ]);
  const all=[...aliRows,...cjRows];
  const summary={
    ali:summarize(aliRows,ali.length),
    cj:summarize(cjRows,cj.length),
    total:summarize(all,TOTAL_TARGET),
    provider_api_calls:0,
    writes:false,
  };
  console.log(`[catalog-712-production-readonly-audit] ${JSON.stringify(summary)}`);
  return summary;
}
if(require.main===module){
  run().then(()=>process.exit(0)).catch(e=>{
    console.error(`[catalog-712-production-readonly-audit] FAILED: ${e.stack||e.message||e}`);
    process.exit(1);
  }).finally(()=>db.pool.end());
}
module.exports={ALI_WAVE,expectedAliIds,auditSupplier,summarize,run};
