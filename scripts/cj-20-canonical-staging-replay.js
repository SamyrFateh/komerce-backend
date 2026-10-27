/** @komerce-arch-lite
 * @role cj-real-twenty-canonical-staging-replay
 * @domain sourcing
 * @layer tooling
 * @owner backend-core
 * @purpose One bounded real CJ intake on fingerprint-confirmed staging to prove FX deferral and classification.
 * @db-read import_runtime_runs, sourcing_candidates, products, boutique_categories, boutique_subcategories
 * @db-write-via:catalog-import-orchestrator supplier_catalog_imports, sourcing_candidates, import_runtime_runs, import_runtime_item_events
 * @impact-areas sourcing, catalog, staging-only, provider-contract
 */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const db=require('../db');
const cj=require('../services/suppliers/connectors/cj-connector');
const {dispatchToConnector}=require('../services/sourcing-import-dispatch');
const {importCatalog}=require('../services/suppliers/catalog-import-orchestrator');
const {confirmTarget}=require('./recette/target-guard');
const {audit}=require('./audit-kir-unified-commercial-coverage');
const HOST='https://komerce-backend-production.up.railway.app';
const OUT=path.resolve('test-results/cj-canonical-20-staging/report.json');

function guard(env=process.env){
  if(env.GITHUB_ACTIONS!=='true'||env.NODE_ENV!=='test'||env.KOMERCE_ENV!=='staging'
    ||env.STAGING_BASE_URL!==HOST||env.KOMERCE_ALLOW_CJ_CANONICAL_20_STAGING!=='1')
    throw Error('CJ_CANONICAL_STAGING_OWNER_GATE_REQUIRED');
  if(!env.DATABASE_URL||!env.CJ_ACCESS_TOKEN)throw Error('CJ_STAGING_SECRETS_MISSING');
}
const safeReasons=rows=>Object.entries((rows||[]).reduce((m,r)=>{
  const k=String(r?.error||r?.errors?.join('; ')||'UNKNOWN').slice(0,160);
  m[k]=(m[k]||0)+1;return m;
},{})).map(([reason,n])=>({reason,count:n}));

async function replay({database=db,confirm=confirmTarget,dispatch=dispatchToConnector,importer=importCatalog,classify=audit}={}){
  guard();
  const target=await confirm({db:database});
  if(target?.confirmed!==true)throw Error('CJ_STAGING_DB_FINGERPRINT_MISMATCH');
  const {rows:[before]}=await database.query(
    "SELECT COUNT(*)::int AS n FROM sourcing_candidates WHERE LOWER(supplier_name) LIKE 'cj%'"
  );
  // Do not mutate or re-associate any pre-existing CJ candidates.
  if(Number(before.n)!==0)throw Error('CJ_CANDIDATES_ALREADY_EXIST_REVIEW_FIRST');
  const {rows:[productsBefore]}=await database.query('SELECT COUNT(*)::int AS n FROM products');
  const body={supplier_name:cj.SUPPLIER_NAME,supplier_id:cj.PROVIDER_ID,
    source_type:'api',page:1,size:20,include_commandable_units:true,
    is_full_snapshot:false,notes:'Bounded CJ 20 staging FX deferral and commercial classification proof; never publish'};
  // One provider acquisition only; refuse partial/duplicate cohorts BEFORE the write.
  const batch=await dispatch(body);
  const data=Array.isArray(batch?.products)?batch.products:[];
  const identities=new Set(data.map(p=>String(p?.supplier_product_id||'')).filter(Boolean));
  if(data.length!==20||identities.size!==20||(batch.invalid||[]).length)
    throw Error('CJ_PROVIDER_COHORT_NOT_EXACT_20_UNIQUE_VALID');
  const result=await importer(body,null,async()=>batch);
  const runRef=result.body?.run_ref||null;
  if(!/^KIR-\\d{6}$/.test(runRef||''))throw Error('CJ_CANONICAL_RUN_REF_MISSING');
  const {rows:[productsAfter]}=await database.query('SELECT COUNT(*)::int AS n FROM products');
  if(productsAfter.n!==productsBefore.n)throw Error('CJ_SCRIPT_PUBLISHED_PRODUCTS_UNEXPECTEDLY');
  const {rows:[persisted]}=await database.query(
    'SELECT COUNT(*)::int AS n FROM sourcing_candidates sc JOIN import_runtime_runs ir ON ir.import_id=sc.import_id WHERE ir.run_ref=$1',[runRef]);
  let classification=null;
  if(persisted.n>0){
    const c=await classify(runRef);
    classification={inspected:c.inspected,automatic:c.auto_classifiable_products,
      unresolved:c.unresolved_products,explicit_review:c.explicit_review_products,
      products:c.products.map(p=>({ref:p.candidate_ref,name:p.product_name,
        status:p.status,category:p.category,subcategory:p.subcategory,source:p.source}))};
  }
  return {mode:'GUARDED_STAGING_CANONICAL_INTAKE',target:HOST,run_ref:runRef,
    supplier:'CJdropshipping',requested:20,fetched:20,distinct:identities.size,
    created:Number(result.body?.created||0),updated:Number(result.body?.updated||0),
    accepted:Number(result.body?.accepted||0),rejected:Number(result.body?.rejected||0),
    fx_pending:Number(result.body?.fx_pending||0),
    pipeline_status:result.body?.pipeline_status||null,
    candidate_count:persisted.n,source_reasons:safeReasons(result.body?.errors),
    products_created:productsAfter.n-productsBefore.n,
    classification,
    verdict:persisted.n===20&&classification?.automatic===20&&classification?.unresolved===0
      ?'CJ_20_CLASSIFICATION_CERTIFIED_NOT_SELLABILITY'
      :persisted.n===20?'CJ_20_PERSISTED_CLASSIFICATION_GAPS'
      :'CJ_IMPORT_REJECTED_OR_INCOMPLETE'};
}
async function main(){
  fs.mkdirSync(path.dirname(OUT),{recursive:true});
  try{
    const r=await replay();
    fs.writeFileSync(OUT,JSON.stringify(r,null,2)+'\n');
    console.log('[CJ_CANONICAL_20] '+JSON.stringify({
      run:r.run_ref,verdict:r.verdict,accepted:r.accepted,rejected:r.rejected,
      fx_pending:r.fx_pending,persisted:r.candidate_count,
      classification:r.classification&&{automatic:r.classification.automatic,
        unresolved:r.classification.unresolved},
      errors:r.source_reasons
    }));
    if(r.verdict!=='CJ_20_CLASSIFICATION_CERTIFIED_NOT_SELLABILITY')process.exitCode=2;
  }catch(err){
    const report={verdict:'CJ_CANONICAL_REPLAY_ERROR',
      reason:String(err.code||err.message).slice(0,160)};
    fs.writeFileSync(OUT,JSON.stringify(report,null,2)+'\n');
    console.error('[CJ_CANONICAL_20] '+report.reason);
    process.exitCode=1;
  }finally{await db.pool.end();}
}
if(require.main===module)main();
module.exports={guard,replay};
