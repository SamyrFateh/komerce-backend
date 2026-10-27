#!/usr/bin/env node
/** @komerce-arch-lite
 * @role isolated-real-cj-200-semantic-stress
 * @domain sourcing
 * @layer tooling
 * @owner backend-core
 * @purpose Fetch bounded real CJ pages, canonically import up to 200 distinct items into disposable PG, independently classify; never publish.
 * @db-read sourcing_candidates, products, import_runtime_runs
 * @db-write-via:catalog-import-orchestrator supplier_catalog_imports, sourcing_candidates, import_runtime_runs, import_runtime_item_events
 * @impact-areas sourcing, catalog, isolated-ci-only, certification
 */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const db=require('../db');
const cj=require('../services/suppliers/connectors/cj-connector');
const {importCatalog}=require('../services/suppliers/catalog-import-orchestrator');
const {resolveCommercialTaxonomyVerdict}=require('../services/catalog-candidate-product-service');
const EXPECT=200, PAGE_SIZE=20, MAX_PAGES=20, MIN_INTERVAL_MS=1100;
const DB='postgresql://komerce:komerce@127.0.0.1:5432/komerce_semantic_bulk_200';
const OUT=path.resolve('artifacts/cj-semantic-bulk-200/report.json');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function guard(){
 const e=process.env;
 if(e.DATABASE_URL!==DB||e.NODE_ENV!=='test'||e.KOMERCE_ENV!=='staging'
   ||e.GITHUB_ACTIONS!=='true'||e.KOMERCE_DISABLE_CRONS!=='true'
   ||e.KOMERCE_ALLOW_CJ_SEMANTIC_BULK_200!=='1')
   throw Error('DISPOSABLE_PG_ONLY');
 if(!e.CJ_ACCESS_TOKEN&&!e.CJ_API_KEY)throw Error('CJ_CREDENTIALS_REQUIRED');
 const {rows:[identity]}=await db.query('SELECT current_database() AS name');
 if(identity?.name!=='komerce_semantic_bulk_200')throw Error('DISPOSABLE_DB_IDENTITY_MISMATCH');
}
function trimmedName(v){return String(v||'').trim().slice(0,110);}
async function main(){
 fs.mkdirSync(path.dirname(OUT),{recursive:true});
 const started=Date.now();
 let report={mode:'ISOLATED_REAL_SUPPLIER_BOUNDED',target:EXPECT,provider:'CJdropshipping',
   provider_pages:0,received:0,unique:0,invalid:0,imported:0,rejected:0,fx_pending:0,
   automatically_classified:0,review_required:0,review_groups:[],examples:[],
   published_products:0, verdict:'RUNNING'};
 try{
  await guard();
  const seen=new Set(), chosen=[];
  for(let page=1;page<=MAX_PAGES && chosen.length<EXPECT;page++){
   if(page>1)await sleep(MIN_INTERVAL_MS);
   const result=await cj.fetchProducts({
      page,size:PAGE_SIZE,includeCommandableUnits:false,startWarehouseInventory:1
   });
   report.provider_pages++;
   report.received+=(result.products||[]).length+(result.invalid||[]).length;
   report.invalid+=(result.invalid||[]).length;
   for(const obj of result.products||[]){
     const id=String(obj.supplier_product_id||'').trim();
     if(!id||seen.has(id))continue;
     seen.add(id);chosen.push(obj);
     if(chosen.length===EXPECT)break;
   }
   if(!result.products?.length && !result.invalid?.length)break;
  }
  report.unique=chosen.length;
  if(chosen.length<EXPECT)throw Error('SUPPLIER_SHORTFALL:'+chosen.length+'/'+EXPECT);
  const {rows:[before]}=await db.query('SELECT COUNT(*)::int AS n FROM products');
  for(let i=0;i<chosen.length;i+=20){
    const subset=chosen.slice(i,i+20);
    const body={supplier_name:cj.SUPPLIER_NAME,supplier_id:cj.PROVIDER_ID,
      source_type:'api',source_filename:'cj-semantic-bulk-200/batch-'+(i/20+1),
      notes:'Real CJ identity, isolated CI stress; sourcing only, no publication',
      is_full_snapshot:false};
    const result=await importCatalog(body,null,async()=>({
      products:subset,invalid:[],total:subset.length
    }));
    if(result.status!==200)throw Error('IMPORT_HTTP_'+result.status);
    report.imported+=Number(result.body?.accepted||0);
    report.rejected+=Number(result.body?.rejected||0);
    report.fx_pending+=Number(result.body?.fx_pending||0);
    if(Array.isArray(result.body?.errors)&&result.body.errors.length) {
      const reasons=result.body.errors.map(x=>String(x.error||x.errors||'UNKNOWN').slice(0,150));
      throw Error('IMPORT_ERRORS:'+JSON.stringify(reasons.slice(0,5)));
    }
  }
  const {rows:records}=await db.query(`SELECT id,candidate_ref,product_name,
     supplier_name,supplier_category,normalized_source_contract,raw_payload,commercial_taxonomy_review
     FROM sourcing_candidates WHERE supplier_name='CJdropshipping' ORDER BY candidate_ref`);
  if(records.length!==EXPECT)throw Error('PERSISTENCE_COUNT:'+records.length+'/'+EXPECT);
  const grouped=new Map(), autoByPair=new Map(), byEvidence=new Map();
  for(const candidate of records){
    const decision=await resolveCommercialTaxonomyVerdict(db,candidate);
    const k=decision.source||'UNSPECIFIED';
    byEvidence.set(k,(byEvidence.get(k)||0)+1);
    if(decision.status==='AUTO_CLASSIFIED'){
      report.automatically_classified++;
      const p=decision.category+'/'+decision.subcategory;
      autoByPair.set(p,(autoByPair.get(p)||0)+1);
    } else {
      report.review_required++;
      const key=candidate.supplier_category||'(missing source category)';
      if(!grouped.has(key))grouped.set(key,{path:key,items:0,reasons:[],sample:[]});
      const g=grouped.get(key);g.items++;
      if(!g.reasons.includes(k))g.reasons.push(k);
      if(g.sample.length<3)g.sample.push({ref:candidate.candidate_ref,name:trimmedName(candidate.product_name)});
    }
  }
  const {rows:[after]}=await db.query('SELECT COUNT(*)::int AS n FROM products');
  report.published_products=Number(after.n)-Number(before.n);
  report.by_evidence=Object.fromEntries(byEvidence);
  report.by_pair=Object.fromEntries(autoByPair);
  report.review_groups=[...grouped.values()].sort((a,b)=>b.items-a.items).slice(0,30);
  report.elapsed_ms=Date.now()-started;
  report.verdict=report.imported===EXPECT&&report.rejected===0&&report.published_products===0
    ?'IMPORT_200_CERTIFIED_CLASSIFICATION_REPORT_ONLY':'IMPORT_200_FAILED_INVARIANTS';
  console.log('[CJ_SEMANTIC_BULK_200] '+JSON.stringify({
    verdict:report.verdict,received:report.received,unique:report.unique,
    imported:report.imported,rejected:report.rejected,fx_pending:report.fx_pending,
    auto:report.automatically_classified,review:report.review_required,
    evidence:report.by_evidence,pages:report.provider_pages,elapsed_ms:report.elapsed_ms
  }));
  if(report.verdict==='IMPORT_200_FAILED_INVARIANTS')process.exitCode=2;
 }catch(e){
  report.verdict='BULK_200_FAILED';
  report.failure_reason=String(e.code||e.message).slice(0,220);
  report.elapsed_ms=Date.now()-started;
  console.error('[CJ_SEMANTIC_BULK_200] '+report.failure_reason);
  process.exitCode=1;
 }finally{
  fs.writeFileSync(OUT,JSON.stringify(report,null,2)+'\n');
  await db.pool.end();
 }
}
if(require.main===module)main();
module.exports={guard,main};