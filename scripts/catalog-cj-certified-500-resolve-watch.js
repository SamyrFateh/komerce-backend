#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          catalog-cj-certified-500-watch-resolver
 * @domain        catalog
 * @layer         tooling
 * @criticality   high
 * @inputs        historical CJ 500 exact ids, stored normalized V2 contracts, active boutique->customs affinities
 * @outputs       locally rescanned/promoted historical CJ WATCH rows, no provider calls
 * @depends       db.js, services/pricing-engine.js, services/supplier-catalog-scanner.js, services/sourcing-candidate-actions.js, services/catalog-overrides.js, scripts/catalog-fr-free-e2e-preparation.js, scripts/catalog-cj-certified-500-materialize.js, services/suppliers/e2e-isolated-runtime.js
 * @used-by       ali-e2e-200-worker catalog-712-resolve-watch mode
 * @db-read       sourcing_candidates, boutique_categories, boutique_subcategories, customs_categories, products
 * @db-write      sourcing_candidates, sourcing_candidate_events
 * @db-write-via:sourcing-candidate-actions products
 * @db-write-via:catalog-promotion catalog_media, product_variants, product_skus, product_sku_media
 * @db-write-via:catalog-overrides catalog_field_overrides, products
 * @db-txn        bounded candidate update + canonical promotion transactions
 * @doctrine      no_provider_calls, product_identity_first, subcategory_affinity_fallback, no_auto_publish
 * @impact-areas  catalog, sourcing, customs, staging-e2e
 * @version       2026-09-v1
 */
'use strict';

const db = require('../db');
const pricingEngine = require('../services/pricing-engine');
const scanner = require('../services/supplier-catalog-scanner');
const { promoteCandidate } = require('../services/sourcing-candidate-actions');
const catalogOverrides = require('../services/catalog-overrides');
const freeFr = require('./catalog-fr-free-e2e-preparation');
const { decodeCertifiedIds, finalAudit } = require('./catalog-cj-certified-500-materialize');
const e2eRuntime = require('../services/suppliers/e2e-isolated-runtime');

const SUPPLIER='CJdropshipping';
const ACCEPTED=new Set(['TEST','PRIORITY']);
const FLAG='KOMERCE_ALLOW_CJ_CERTIFIED_500_MATERIALIZE';

function isTruthy(value){
  return ['1','true','yes'].includes(String(value||'').trim().toLowerCase());
}
function testPriceOf(scan={}){
  const n=Number(scan?.scan_result?.test_price_kmf);
  return Number.isFinite(n)&&n>0?Math.round(n):null;
}
async function loadWatch(ids){
  const {rows}=await db.query(
    `SELECT id,supplier_product_id,state,product_id,raw_payload,normalized_source_contract,
            scan_result,product_name,supplier_category
       FROM sourcing_candidates
      WHERE supplier_name=$1
        AND supplier_product_id = ANY($2::text[])
        AND UPPER(COALESCE(scan_result->>'sourcing_decision','UNKNOWN'))='WATCH'
      ORDER BY supplier_product_id`,
    [SUPPLIER,ids]
  );
  return rows;
}
function sourceProduct(row){
  const contract=row.normalized_source_contract;
  if(!contract||String(contract.schema_version||'')!=='2'){
    throw new Error(`NORMALIZED_V2_REQUIRED:${row.supplier_product_id}`);
  }
  return {
    ...JSON.parse(JSON.stringify(contract)),
    raw_payload:JSON.parse(JSON.stringify(row.raw_payload||{})),
  };
}
async function project(rows,config){
  const details=[];
  const decisions={};
  const sources={};
  const categories={};
  for(const row of rows){
    const normalized=await scanner.normalizeCandidate(sourceProduct(row),{config});
    const scan=await scanner.scanCandidate(normalized,{config});
    const decision=String(scan.sourcing_decision||'UNKNOWN').toUpperCase();
    const categorySource=String(normalized.data_sources?.category||'default');
    decisions[decision]=(decisions[decision]||0)+1;
    sources[categorySource]=(sources[categorySource]||0)+1;
    categories[normalized.komerce_category||'<missing>']=(categories[normalized.komerce_category||'<missing>']||0)+1;
    details.push({row,normalized,scan,decision,categorySource});
  }
  return {details,summary:{total:rows.length,decisions,category_sources:sources,categories}};
}
function assertProjection(projection){
  const unresolved=projection.details.filter(x=>!x.normalized.komerce_category||x.categorySource==='default');
  if(unresolved.length){
    throw new Error(`CATALOG_712_WATCH_UNRESOLVED:${unresolved.length}`);
  }
  const nonAccepted=projection.details.filter(x=>!ACCEPTED.has(x.decision));
  if(nonAccepted.length){
    const counts={};
    for(const item of nonAccepted){
      const key=`${item.decision}:${item.scan.reason||'unknown'}`;
      counts[key]=(counts[key]||0)+1;
    }
    throw new Error(`CATALOG_712_WATCH_NON_ACCEPTED:${JSON.stringify(counts)}`);
  }
  return true;
}
async function applyProjection(projection){
  const client=await db.getClient();
  try{
    await client.query('BEGIN');
    for(const item of projection.details){
      const merged={
        ...item.scan.scan_result,
        sourcing_decision:item.scan.sourcing_decision,
        reason:item.scan.reason,
        recommended_action:item.scan.recommended_action,
      };
      await client.query(
        `UPDATE sourcing_candidates
            SET komerce_category=$1,
                estimated_weight_kg=$2,
                estimated_volume_m3=$3,
                target_margin_pct=$4,
                data_sources=$5::jsonb,
                confidence=$6,
                scan_result=$7::jsonb,
                scan_at=NOW(),
                state='scanned'
          WHERE id=$8`,
        [
          item.normalized.komerce_category,
          item.normalized.estimated_weight_kg,
          item.normalized.estimated_volume_m3,
          item.normalized.target_margin_pct,
          JSON.stringify(item.normalized.data_sources||{}),
          item.normalized.confidence,
          JSON.stringify(merged),
          item.row.id,
        ]
      );
      await client.query(
        `INSERT INTO sourcing_candidate_events(candidate_id,event_type,result,notes)
         VALUES ($1,'scan',$2::jsonb,$3)`,
        [
          item.row.id,
          JSON.stringify(merged),
          'Reclassification locale via affinité sous-catégorie boutique -> catégorie douanière ; aucun appel fournisseur',
        ]
      );
    }
    await client.query('COMMIT');
  }catch(error){
    await client.query('ROLLBACK');
    throw error;
  }finally{
    client.release();
  }
}
async function promoteProjected(projection){
  const promoted=[];
  for(const item of projection.details){
    const price=testPriceOf(item.scan);
    if(!(price>0)) throw new Error(`TEST_PRICE_MISSING:${item.row.supplier_product_id}`);
    // eslint-disable-next-line no-await-in-loop
    const result=await promoteCandidate(item.row.id,{price_kmf:price,enrichment_mode:'source_only'},null);
    promoted.push({
      supplier_product_id:item.row.supplier_product_id,
      product_id:result.product_id,
      category:item.normalized.komerce_category,
      category_source:item.categorySource,
    });
  }
  return promoted;
}
async function prepareFrench(ids){
  const {rows}=await db.query(
    `SELECT p.id,p.product_ref,p.name,p.name_source,p.description_source,p.source_locale,
            p.category,p.subcategory,p.content_source,p.needs_review,
            sc.supplier_name,sc.supplier_product_id,
            cc.label AS category_label
       FROM sourcing_candidates sc
       JOIN products p ON p.id=sc.product_id
       LEFT JOIN customs_categories cc ON cc.key=p.category AND cc.is_active=TRUE
      WHERE sc.supplier_name=$1
        AND sc.supplier_product_id = ANY($2::text[])
        AND sc.state='imported_to_catalog'
        AND p.lifecycle_status='candidate'
        AND p.is_active=FALSE
        AND p.content_source='connector_raw'
      ORDER BY p.product_ref`,
    [SUPPLIER,ids]
  );
  let prepared=0;
  for(const row of rows){
    const fields=freeFr.prepareFrenchFields(row);
    // eslint-disable-next-line no-await-in-loop
    const result=await catalogOverrides.upsertOverrides(
      db,row.id,
      {name:fields.name,description:fields.description},
      {reason:'Préparation FR gratuite après résolution locale taxonomie 712',setBy:null}
    );
    if(result.product?.content_source!=='manual'||result.product?.needs_review!==false){
      throw new Error(`FR_NOT_READY:${row.supplier_product_id}`);
    }
    prepared+=1;
  }
  return {selected:rows.length,prepared,provider_api_calls:0,paid_ai_api_calls:0};
}
async function run(env=process.env){
  const runtime=e2eRuntime.assertIsolatedE2eRuntime(env);
  if(!isTruthy(env[FLAG])) throw new Error(`REFUS: ${FLAG}=1 requis`);
  const ids=decodeCertifiedIds(env);
  const rows=await loadWatch(ids);
  if(!rows.length){
    const audit=await finalAudit(ids);
    const summary={runtime,watch_before:0,projection:null,promoted:0,fr:{selected:0,prepared:0},audit,provider_api_calls:0};
    console.log(`[catalog-712-resolve-watch] ${JSON.stringify(summary)}`);
    return summary;
  }

  const config=await pricingEngine.loadGlobalConfig();
  const projection=await project(rows,config);
  console.log(`[catalog-712-resolve-watch] PROJECT ${JSON.stringify(projection.summary)}`);
  assertProjection(projection);
  await applyProjection(projection);
  const promoted=await promoteProjected(projection);
  const fr=await prepareFrench(ids);
  const audit=await finalAudit(ids);
  const complete=audit.expected===500&&audit.present===500&&audit.distinct_products===500&&audit.ready===500;
  const summary={
    runtime,
    watch_before:rows.length,
    projection:projection.summary,
    promoted:promoted.length,
    fr,
    audit,
    provider_api_calls:0,
    complete,
  };
  console.log(`[catalog-712-resolve-watch] FINAL ${JSON.stringify(summary)}`);
  if(!complete) throw new Error(`CATALOG_712_WATCH_RESOLUTION_INCOMPLETE:${JSON.stringify(audit)}`);
  return summary;
}
if(require.main===module){
  run().then(()=>process.exit(0)).catch(error=>{
    console.error(`[catalog-712-resolve-watch] FAILED: ${error.stack||error.message||error}`);
    process.exit(1);
  }).finally(()=>db.pool.end());
}
module.exports={SUPPLIER,ACCEPTED,FLAG,loadWatch,sourceProduct,project,assertProjection,run};
