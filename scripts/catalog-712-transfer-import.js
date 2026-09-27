#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          catalog-712-transfer-destination-importer
 * @domain        catalog
 * @layer         tooling
 * @criticality   high
 * @inputs        portable certified 712 gzip bundle, real catalog DATABASE_URL
 * @outputs       missing supplier identities imported as inactive canonical products
 * @depends       db.js, services/suppliers/catalog-import-orchestrator.js, services/sourcing-candidate-actions.js, services/catalog-overrides.js
 * @used-by       scripts/catalog-712-transfer.js
 * @db-read       sourcing_candidates, products, product_skus, catalog_media, product_market_exposure
 * @db-write-via:catalog-import-orchestrator supplier_catalog_imports, sourcing_candidates, sourcing_candidate_events
 * @db-write-via:sourcing-candidate-actions products, sourcing_candidates, sourcing_candidate_events
 * @db-write-via:catalog-promotion catalog_media, product_variants, product_skus, product_sku_media
 * @db-write-via:catalog-overrides catalog_field_overrides, products
 * @db-txn        canonical owners
 * @doctrine      idempotent_supplier_identity_import, no_provider_calls, no_auto_publish, preserve_existing_catalog
 * @impact-areas  catalog, sourcing, production-catalog
 * @version       2026-09-v1
 */
'use strict';

const fs=require('fs');
const zlib=require('zlib');
const db=require('../db');
const orchestrator=require('../services/suppliers/catalog-import-orchestrator');
const actions=require('../services/sourcing-candidate-actions');
const overrides=require('../services/catalog-overrides');

const FLAG='KOMERCE_ALLOW_CATALOG_712_PRODUCTION_IMPORT';
const ROLE='destination';
const ACCEPTED=new Set(['TEST','PRIORITY']);

function truthy(v){return ['1','true','yes'].includes(String(v||'').trim().toLowerCase());}
function parseArgs(argv=process.argv.slice(2)){
  let bundle=null;
  for(const arg of argv){
    if(arg.startsWith('--bundle=')) bundle=arg.slice('--bundle='.length);
    else throw new Error(`Argument inconnu: ${arg}`);
  }
  if(!bundle) throw new Error('--bundle requis');
  return {bundle};
}
function hostOf(url){try{return new URL(String(url||'')).hostname}catch{return null}}
function assertRuntime(env=process.env){
  if(!truthy(env[FLAG])) throw new Error(`REFUS: ${FLAG}=1 requis`);
  if(String(env.KOMERCE_CATALOG_TRANSFER_ROLE||'')!==ROLE) throw new Error('CATALOG_TRANSFER_DESTINATION_ROLE_REQUIRED');
  const host=hostOf(env.DATABASE_URL);
  if(!host) throw new Error('DEST_DATABASE_URL_INVALID');
  if(/ali-e2e-200-postgres/i.test(host)) throw new Error(`DEST_DB_IS_E2E_SOURCE:${host}`);
  return {dest_host:host};
}
function readBundle(file){
  const bundle=JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
  if(bundle?.dataset_id!=='catalog-e2e-712-v1'||bundle?.total!==712||!Array.isArray(bundle.products)||bundle.products.length!==712){
    throw new Error('CATALOG_712_TRANSFER_BUNDLE_INVALID');
  }
  const keys=bundle.products.map(x=>`${x.supplier_name}\u0000${x.supplier_product_id}`);
  if(new Set(keys).size!==712) throw new Error('CATALOG_712_TRANSFER_BUNDLE_DUPLICATE_IDENTITY');
  return bundle;
}
async function loadExisting(bundle){
  const bySupplier=new Map();
  for(const item of bundle.products){
    if(!bySupplier.has(item.supplier_name)) bySupplier.set(item.supplier_name,[]);
    bySupplier.get(item.supplier_name).push(String(item.supplier_product_id));
  }
  const existing=new Set();
  for(const [supplier,ids] of bySupplier){
    // eslint-disable-next-line no-await-in-loop
    const {rows}=await db.query(
      `SELECT supplier_product_id
         FROM sourcing_candidates
        WHERE supplier_name=$1
          AND supplier_product_id = ANY($2::text[])
          AND state='imported_to_catalog'
          AND product_id IS NOT NULL`,
      [supplier,ids]
    );
    for(const row of rows) existing.add(`${supplier}\u0000${row.supplier_product_id}`);
  }
  return existing;
}
function supplierId(name){
  if(name==='CJdropshipping') return 'cj';
  if(name==='AliExpress') return 'aliexpress';
  throw new Error(`UNSUPPORTED_SUPPLIER:${name}`);
}
async function importMissing(bundle,existing){
  const groups=new Map();
  for(const item of bundle.products){
    const key=`${item.supplier_name}\u0000${item.supplier_product_id}`;
    if(existing.has(key)) continue;
    if(!groups.has(item.supplier_name)) groups.set(item.supplier_name,[]);
    groups.get(item.supplier_name).push(item);
  }
  const reports=[];
  for(const [supplier,items] of groups){
    const products=items.map(item=>({
      ...item.source_product,
      supplier_name:item.supplier_name,
      supplier_product_id:item.supplier_product_id,
      raw_payload:item.source_product?.raw_payload||{},
    }));
    // eslint-disable-next-line no-await-in-loop
    const result=await orchestrator.importCatalog({
      supplier_name:supplier,
      supplier_id:supplierId(supplier),
      source_type:'api',
      source_filename:'catalog-712-certified-transfer-v1',
      notes:'Transfert certifié E2E 712 vers catalogue réel ; aucun appel fournisseur',
      is_full_snapshot:false,
    },null,async()=>({products,invalid:[],total:products.length}));
    if(result.status!==200||Number(result.body?.rejected||0)!==0){
      throw new Error(`CATALOG_712_IMPORT_FAILED:${supplier}:${JSON.stringify(result.body||{})}`);
    }
    reports.push({
      supplier,
      requested:items.length,
      created:Number(result.body?.created||0),
      updated:Number(result.body?.updated||0),
    });
  }
  return reports;
}
async function loadCandidates(items){
  const rows=[];
  const groups=new Map();
  for(const item of items){
    if(!groups.has(item.supplier_name)) groups.set(item.supplier_name,[]);
    groups.get(item.supplier_name).push(String(item.supplier_product_id));
  }
  for(const [supplier,ids] of groups){
    // eslint-disable-next-line no-await-in-loop
    const res=await db.query(
      `SELECT id,supplier_name,supplier_product_id,state,product_id,scan_result
         FROM sourcing_candidates
        WHERE supplier_name=$1
          AND supplier_product_id = ANY($2::text[])
        ORDER BY supplier_product_id`,
      [supplier,ids]
    );
    rows.push(...res.rows);
  }
  return rows;
}
function explicitPrice(row){
  const n=Number(row?.scan_result?.test_price_kmf);
  return Number.isFinite(n)&&n>0?Math.round(n):null;
}
async function promoteMissing(bundle,existing){
  const missing=bundle.products.filter(item=>!existing.has(`${item.supplier_name}\u0000${item.supplier_product_id}`));
  if(!missing.length) return {promoted:0,editorial_applied:0};
  const sourceByKey=new Map(missing.map(item=>[`${item.supplier_name}\u0000${item.supplier_product_id}`,item]));
  const rows=await loadCandidates(missing);
  if(rows.length!==missing.length){
    throw new Error(`CATALOG_712_DEST_CANDIDATE_COUNT:${rows.length}/${missing.length}`);
  }
  const blocked=[];
  for(const row of rows){
    const decision=String(row?.scan_result?.sourcing_decision||'').toUpperCase();
    const price=explicitPrice(row);
    if(row.state==='imported_to_catalog'&&row.product_id) continue;
    if(!ACCEPTED.has(decision)||!(price>0)){
      blocked.push({supplier_name:row.supplier_name,supplier_product_id:row.supplier_product_id,decision,price});
    }
  }
  if(blocked.length){
    throw new Error(`CATALOG_712_DEST_RESCAN_BLOCKED:${JSON.stringify(blocked.slice(0,30))}`);
  }

  let promoted=0;
  let editorialApplied=0;
  for(const row of rows){
    if(row.state==='imported_to_catalog'&&row.product_id) continue;
    const price=explicitPrice(row);
    // eslint-disable-next-line no-await-in-loop
    const result=await actions.promoteCandidate(row.id,{price_kmf:price,enrichment_mode:'source_only'},null);
    promoted+=1;
    const source=sourceByKey.get(`${row.supplier_name}\u0000${row.supplier_product_id}`);
    // eslint-disable-next-line no-await-in-loop
    const applied=await overrides.upsertOverrides(
      db,
      result.product_id,
      {name:source.editorial.name,description:source.editorial.description},
      {reason:'Contenu FR certifié dataset E2E 712',setBy:null}
    );
    if(applied.product?.content_source!=='manual'||applied.product?.needs_review!==false){
      throw new Error(`CATALOG_712_DEST_EDITORIAL_NOT_READY:${row.supplier_name}:${row.supplier_product_id}`);
    }
    editorialApplied+=1;
  }
  return {promoted,editorial_applied:editorialApplied};
}
async function audit(bundle,baselineExisting){
  const groups=new Map();
  for(const item of bundle.products){
    if(!groups.has(item.supplier_name)) groups.set(item.supplier_name,[]);
    groups.get(item.supplier_name).push(String(item.supplier_product_id));
  }
  const rows=[];
  for(const [supplier,ids] of groups){
    // eslint-disable-next-line no-await-in-loop
    const res=await db.query(
      `WITH media AS (
         SELECT product_id,COUNT(*) FILTER (WHERE is_active=TRUE)::int AS media_count
           FROM catalog_media GROUP BY product_id
       ), sku AS (
         SELECT product_id,
                COUNT(*) FILTER (WHERE source='SUPPLIER' AND is_active=TRUE)::int AS active_skus,
                COUNT(*) FILTER (
                  WHERE source='SUPPLIER' AND is_active=TRUE
                    AND supplier_unit_ref IS NOT NULL
                    AND supplier_order_identity IS NOT NULL
                )::int AS complete_skus
           FROM product_skus GROUP BY product_id
       ), exposure AS (
         SELECT product_id,COUNT(*) FILTER (WHERE commercial_exposure='ENABLED')::int AS enabled_markets
           FROM product_market_exposure GROUP BY product_id
       )
       SELECT sc.supplier_name,sc.supplier_product_id,sc.product_id,
              p.lifecycle_status,p.is_active,p.content_source,p.needs_review,
              p.boutique_category_key,p.boutique_subcategory_key,
              COALESCE(media.media_count,0)::int AS media_count,
              COALESCE(sku.active_skus,0)::int AS active_skus,
              COALESCE(sku.complete_skus,0)::int AS complete_skus,
              COALESCE(exposure.enabled_markets,0)::int AS enabled_markets
         FROM sourcing_candidates sc
         JOIN products p ON p.id=sc.product_id
         LEFT JOIN media ON media.product_id=p.id
         LEFT JOIN sku ON sku.product_id=p.id
         LEFT JOIN exposure ON exposure.product_id=p.id
        WHERE sc.supplier_name=$1
          AND sc.supplier_product_id = ANY($2::text[])
          AND sc.state='imported_to_catalog'`,
      [supplier,ids]
    );
    rows.push(...res.rows);
  }
  const identities=rows.map(r=>`${r.supplier_name}\u0000${r.supplier_product_id}`);
  const productIds=rows.map(r=>String(r.product_id));
  const newRows=rows.filter(r=>!baselineExisting.has(`${r.supplier_name}\u0000${r.supplier_product_id}`));
  const badNew=newRows.filter(r=>
    r.lifecycle_status!=='candidate'
    || r.is_active!==false
    || r.content_source!=='manual'
    || r.needs_review!==false
    || !r.boutique_category_key
    || !r.boutique_subcategory_key
    || Number(r.media_count||0)<1
    || Number(r.active_skus||0)<1
    || Number(r.complete_skus||0)!==Number(r.active_skus||0)
    || Number(r.enabled_markets||0)!==0
  );
  return {
    total_present:rows.length,
    distinct_supplier_identities:new Set(identities).size,
    distinct_product_ids:new Set(productIds).size,
    already_present:baselineExisting.size,
    newly_added:newRows.length,
    newly_added_ready:newRows.length-badNew.length,
    new_enabled_market_exposure:newRows.filter(r=>Number(r.enabled_markets||0)>0).length,
    bad_new_samples:badNew.slice(0,30).map(r=>({
      supplier_name:r.supplier_name,supplier_product_id:r.supplier_product_id,
      lifecycle_status:r.lifecycle_status,is_active:r.is_active,content_source:r.content_source,
      needs_review:r.needs_review,boutique_category_key:r.boutique_category_key,
      boutique_subcategory_key:r.boutique_subcategory_key,media_count:r.media_count,
      active_skus:r.active_skus,complete_skus:r.complete_skus,enabled_markets:r.enabled_markets,
    })),
  };
}
async function run(args=parseArgs(),env=process.env){
  const runtime=assertRuntime(env);
  const bundle=readBundle(args.bundle);
  const existing=await loadExisting(bundle);
  console.log(`[catalog-712-dest] PREFLIGHT ${JSON.stringify({runtime,total:bundle.total,already_present:existing.size,to_add:bundle.total-existing.size,provider_api_calls:0})}`);
  const imports=await importMissing(bundle,existing);
  const promotion=await promoteMissing(bundle,existing);
  const final=await audit(bundle,existing);
  const accepted=final.total_present===712
    && final.distinct_supplier_identities===712
    && final.distinct_product_ids===712
    && final.newly_added===712-existing.size
    && final.newly_added_ready===final.newly_added
    && final.new_enabled_market_exposure===0;
  const summary={accepted,runtime,imports,promotion,final,provider_api_calls:0,auto_publish:false};
  console.log(`[catalog-712-dest] FINAL ${JSON.stringify(summary)}`);
  if(!accepted) throw new Error(`CATALOG_712_DEST_FINAL_GATE_FAILED:${JSON.stringify(final)}`);
  return summary;
}
if(require.main===module){
  run().then(()=>process.exit(0)).catch(e=>{
    console.error(`[catalog-712-dest] FAILED: ${e.stack||e.message||e}`);
    process.exit(1);
  }).finally(()=>db.pool.end());
}
module.exports={FLAG,ROLE,parseArgs,assertRuntime,readBundle,loadExisting,importMissing,promoteMissing,audit,run};
