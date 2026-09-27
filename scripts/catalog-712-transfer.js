#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          catalog-712-cross-db-transfer-orchestrator
 * @domain        catalog
 * @layer         tooling
 * @criticality   high
 * @inputs        isolated E2E DATABASE_URL, KOMERCE_CATALOG_DEST_DATABASE_URL
 * @outputs       portable 712 bundle + canonical destination import subprocess
 * @depends       db.js, scripts/catalog-712-transfer-import.js, scripts/cj-reconcile-current-new-12-promote.js
 * @used-by       ali-e2e-200-worker catalog-712-production-import mode
 * @db-read       sourcing_candidates, products
 * @db-write      none
 * @db-txn        none
 * @doctrine      certified_e2e_to_real_catalog, no_provider_calls, no_direct_cross_db_writes
 * @impact-areas  catalog, sourcing, staging-e2e, production-catalog
 * @version       2026-09-v1
 */
'use strict';

const fs=require('fs');
const path=require('path');
const zlib=require('zlib');
const {spawnSync}=require('child_process');
const db=require('../db');
const {NEW_UNIQUE_IDS}=require('./cj-reconcile-current-new-12-promote');

const FLAG='KOMERCE_ALLOW_CATALOG_712_PRODUCTION_IMPORT';
const DEST_ENV='KOMERCE_CATALOG_DEST_DATABASE_URL';
const BUNDLE_PATH=path.resolve('/tmp/catalog-712-transfer.json.gz');
const ALI_WAVE='incremental-e2e-200-v1';
const CJ_CAMPAIGN='cj-balanced-e2e-500-v1';

function truthy(v){return ['1','true','yes'].includes(String(v||'').trim().toLowerCase());}
function hostOf(url){try{return new URL(String(url||'')).hostname}catch{return null}}
function assertRuntime(env=process.env){
  if(!truthy(env[FLAG])) throw new Error(`REFUS: ${FLAG}=1 requis`);
  const sourceHost=hostOf(env.DATABASE_URL);
  const destHost=hostOf(env[DEST_ENV]);
  if(!sourceHost||!destHost) throw new Error('SOURCE_OR_DEST_DATABASE_URL_INVALID');
  if(!/ali-e2e-200-postgres/i.test(sourceHost)) throw new Error(`SOURCE_DB_NOT_ISOLATED:${sourceHost}`);
  if(/ali-e2e-200-postgres/i.test(destHost)) throw new Error(`DEST_DB_MUST_BE_REAL_CATALOG:${destHost}`);
  if(sourceHost===destHost) throw new Error('SOURCE_DEST_DB_IDENTICAL');
  return {source_host:sourceHost,dest_host:destHost};
}
async function loadBundle(){
  const {rows}=await db.query(
    `SELECT sc.supplier_name,sc.supplier_product_id,sc.raw_payload,sc.normalized_source_contract,
            sc.scan_result,sc.komerce_category,sc.state,sc.product_id,
            p.name,p.description,p.content_source,p.needs_review,
            p.boutique_category_key,p.boutique_subcategory_key
       FROM sourcing_candidates sc
       JOIN products p ON p.id=sc.product_id
      WHERE sc.state='imported_to_catalog'
        AND sc.product_id IS NOT NULL
        AND (
          (sc.supplier_name='AliExpress'
           AND sc.raw_payload #>> '{discovery,wave}'=$1
           AND UPPER(COALESCE(sc.scan_result->>'sourcing_decision','UNKNOWN')) IN ('TEST','PRIORITY'))
          OR
          (sc.supplier_name='CJdropshipping'
           AND (
             sc.raw_payload #>> '{discovery,campaign}'=$2
             OR sc.supplier_product_id = ANY($3::text[])
           )
           AND UPPER(COALESCE(sc.scan_result->>'sourcing_decision','UNKNOWN')) IN ('TEST','PRIORITY'))
        )
      ORDER BY sc.supplier_name,sc.supplier_product_id`,
    [ALI_WAVE,CJ_CAMPAIGN,NEW_UNIQUE_IDS]
  );
  const identities=rows.map(r=>`${r.supplier_name}\u0000${r.supplier_product_id}`);
  const ali=rows.filter(r=>r.supplier_name==='AliExpress').length;
  const cj=rows.filter(r=>r.supplier_name==='CJdropshipping').length;
  if(rows.length!==712||ali!==200||cj!==512||new Set(identities).size!==712){
    throw new Error(`SOURCE_712_BUNDLE_INVALID total=${rows.length} ali=${ali} cj=${cj} distinct=${new Set(identities).size}`);
  }
  for(const row of rows){
    if(String(row?.normalized_source_contract?.schema_version||'')!=='2'){
      throw new Error(`SOURCE_CONTRACT_V2_MISSING:${row.supplier_name}:${row.supplier_product_id}`);
    }
    if(!String(row.name||'').trim()||!String(row.description||'').trim()){
      throw new Error(`SOURCE_FR_CONTENT_MISSING:${row.supplier_name}:${row.supplier_product_id}`);
    }
    if(!row.boutique_category_key||!row.boutique_subcategory_key){
      throw new Error(`SOURCE_BOUTIQUE_TAXONOMY_MISSING:${row.supplier_name}:${row.supplier_product_id}`);
    }
  }
  return {
    schema_version:1,
    dataset_id:'catalog-e2e-712-v1',
    exported_at:new Date().toISOString(),
    total:rows.length,
    products:rows.map(row=>({
      supplier_name:row.supplier_name,
      supplier_product_id:String(row.supplier_product_id),
      source_product:{
        ...row.normalized_source_contract,
        raw_payload:row.raw_payload||{},
      },
      source_scan_result:row.scan_result||{},
      editorial:{
        name:row.name,
        description:row.description,
      },
      source_taxonomy:{
        customs_category:row.komerce_category,
        boutique_category_key:row.boutique_category_key,
        boutique_subcategory_key:row.boutique_subcategory_key,
      },
    })),
  };
}
async function run(env=process.env){
  const runtime=assertRuntime(env);
  const bundle=await loadBundle();
  fs.writeFileSync(BUNDLE_PATH,zlib.gzipSync(Buffer.from(JSON.stringify(bundle))));
  console.log(`[catalog-712-transfer] EXPORT ${JSON.stringify({runtime,total:bundle.total,bundle_path:BUNDLE_PATH,provider_api_calls:0})}`);

  const child=spawnSync(process.execPath,[
    'scripts/catalog-712-transfer-import.js',
    `--bundle=${BUNDLE_PATH}`,
  ],{
    stdio:'inherit',
    env:{
      ...env,
      DATABASE_URL:env[DEST_ENV],
      KOMERCE_CATALOG_TRANSFER_ROLE:'destination',
    },
  });
  try{fs.unlinkSync(BUNDLE_PATH);}catch{}
  if(child.error) throw child.error;
  if(child.status!==0) throw new Error(`CATALOG_712_DEST_IMPORT_FAILED status=${child.status}`);
  console.log('[catalog-712-transfer] COMPLETE');
}
if(require.main===module){
  run().then(()=>process.exit(0)).catch(e=>{
    console.error(`[catalog-712-transfer] FAILED: ${e.stack||e.message||e}`);
    process.exit(1);
  }).finally(()=>db.pool.end());
}
module.exports={FLAG,DEST_ENV,BUNDLE_PATH,ALI_WAVE,CJ_CAMPAIGN,assertRuntime,loadBundle,run};
