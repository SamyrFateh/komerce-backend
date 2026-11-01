/**
 * @komerce-arch-lite
 * @role staging-exact-demo-catalog-soft-disable
 * @deprecated 2026-11 (LOT 1) : remplace par scripts/recette/staging-reset.js (classification exhaustive, fixtures, verification). Conserve sans suppression ; ne plus utiliser pour un reset Staging.
 * @domain catalog
 * @layer script
 * @owner backend-core
 * @purpose Deactivate eight approved staging demo products through canonical catalog owner without deleting lineage.
 * @db-read products, sourcing_candidates, order_items, catalog_media, product_skus, product_variants, product_market_exposure
 * @db-write-via:product-admin-service products
 * @impact-areas catalog, staging-only
 */
'use strict';
const fs=require('fs'),path=require('path');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {verifyRuntimeRevision}=require('./p1-staging-evidence');
const {deleteProduct}=require('../../services/product-admin-service');
const HOST='https://komerce-backend-production.up.railway.app';
const PAIRS=[
 ['KPR-000084','af24ef03-bdee-4644-99a6-a1c8e7e227ef'],
 ['KPR-000085','1450e7fe-c444-43f0-868a-6eb02adc4833'],
 ['KPR-000086','a0d8b1e7-ea2f-48fa-a98d-97b52f049e03'],
 ['KPR-000087','f73ac637-6a06-4071-9070-321deea037f6'],
 ['KPR-000088','2aeb2776-5cd4-4059-8c50-9db8423b4501'],
 ['KPR-000089','e42eecf5-ce33-444a-b4fa-9c4c1ab0ef2f'],
 ['KPR-000090','53ed211d-993e-4215-914c-9d207e245600'],
 ['KPR-000091','ab34310e-350a-4614-8273-d7bfbbd7459d']
];
const TABLES=['order_items','order_item_cost_imputations','sourcing_candidates',
 'product_skus','product_variants','catalog_media','product_market_exposure',
 'product_attributes','catalog_field_overrides','product_content_profile'];
function authorize(env,mode){
 if(env.KOMERCE_ENV!=='staging'||env.NODE_ENV==='production'||env.STAGING_BASE_URL!==HOST)
   throw Error('STAGING_ONLY');
 if(!['--dry-run','--apply'].includes(mode))throw Error('INVALID_MODE');
 if(mode==='--apply'&&(
   env.KOMERCE_DEMO_DEACTIVATION_CONFIRM!=='DISABLE_EXACT_KPR_000084_TO_000091'||
   env.GITHUB_EVENT_NAME!=='issues'||!env.GITHUB_ACTOR||
   env.GITHUB_ACTOR!==env.GITHUB_REPOSITORY_OWNER||
   env.GITHUB_ISSUE_TITLE!=='[staging-op] sql-demo-soft-deactivate-eight'
 ))throw Error('OWNER_APPROVAL_REQUIRED');
 return mode==='--apply';
}
function verifyIdentities(rows){
 if(rows.length!==8)throw Error('EXACT_EIGHT_REQUIRED');
 for(const [ref,id] of PAIRS)
   if(!rows.some(r=>r.product_ref===ref&&String(r.id)===id))
     throw Error('REF_UUID_MISMATCH:'+ref);
}
async function rootState(c,locked=false){
 const q='SELECT id,product_ref,is_active,lifecycle_status, '+
   "md5((to_jsonb(p)-'is_active'-'updated_at')::text) AS preserved_hash "+
   'FROM products p WHERE product_ref=ANY($1::text[]) ORDER BY product_ref'+
   (locked?' FOR UPDATE':'');
 return (await c.query(q,[PAIRS.map(p=>p[0])])).rows;
}
async function dependencies(c){
 const ret={};
 for(const table of TABLES){
   const q='SELECT count(*)::int AS n,'+
     "md5(COALESCE(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS digest "+
     'FROM "'+table+'" t WHERE product_id=ANY($1::uuid[])';
   ret[table]=(await c.query(q,[PAIRS.map(p=>p[1])])).rows[0];
 }
 return ret;
}
function validate(before,after,depA,depB,countA,countB,applied){
 verifyIdentities(after);
 for(const old of before){
   const current=after.find(r=>r.product_ref===old.product_ref);
   if(current.preserved_hash!==old.preserved_hash||
      current.lifecycle_status!==old.lifecycle_status)
     throw Error('UNEXPECTED_PRODUCT_MUTATION:'+old.product_ref);
   if(applied&&current.is_active!==false)throw Error('STILL_ACTIVE:'+old.product_ref);
   if(!applied&&current.is_active!==old.is_active)throw Error('DRY_RUN_CHANGED');
 }
 if(JSON.stringify(depA)!==JSON.stringify(depB))throw Error('RELATED_HISTORY_CHANGED');
 const changed=applied?before.filter(r=>r.is_active).length:0;
 if(countB!==countA-changed)throw Error('OTHER_PRODUCT_STATUS_CHANGED');
 return changed;
}
async function run(mode=process.argv[2]){
 const filename=mode==='--apply'?'apply.json':'dry-run.json';
 const file=path.resolve('test-results/staging-demo-cleanup',filename);
 const report={target:HOST,mode,status:'BLOCKED',at:new Date().toISOString(),
   ref_ids:PAIRS,transaction:'NOT_STARTED',before:[],after:[],dependencies_before:null,
   dependencies_after:null,changed:0,reason:null};
 let c;
 fs.mkdirSync(path.dirname(file),{recursive:true});
 try{
   const applied=authorize(process.env,mode);
   const target=await confirmTarget({db});
   if(!target?.confirmed)throw Error('TARGET_FINGERPRINT_MISMATCH');
   const res=await fetch(HOST+'/health/version',{signal:AbortSignal.timeout(10000)});
   if(!res.ok)throw Error('STAGING_SHA_UNAVAILABLE');
   const data=await res.json();
   report.version=verifyRuntimeRevision(data.commit||data.sha,process.env.GITHUB_SHA);
   c=await db.pool.connect();
   await c.query('BEGIN');report.transaction='OPEN';
   await c.query("SET LOCAL lock_timeout='3500ms'");
   await c.query("SET LOCAL statement_timeout='15000ms'");
   const before=await rootState(c,true);verifyIdentities(before);
   report.before=before;
   const d0=await dependencies(c);report.dependencies_before=d0;
   const countA=Number((await c.query('SELECT count(*)::int AS n FROM products WHERE is_active=TRUE')).rows[0].n);
   if(applied){
     for(const row of before){
       if(!row.is_active)continue;
       const r=await deleteProduct(c,row.id);
       if(r?.status!==200||r?.body?.success!==true)throw Error('OWNER_REFUSED:'+row.product_ref);
     }
   }
   const after=await rootState(c);
   const d1=await dependencies(c);
   const countB=Number((await c.query('SELECT count(*)::int AS n FROM products WHERE is_active=TRUE')).rows[0].n);
   report.changed=validate(before,after,d0,d1,countA,countB,applied);
   report.after=after;report.dependencies_after=d1;
   await c.query(applied?'COMMIT':'ROLLBACK');
   report.transaction=applied?'COMMITTED':'ROLLED_BACK';
   report.status=applied?'EIGHT_PRODUCTS_DISABLED':'DRY_RUN_VERIFIED';
   c.release();c=null;
   console.log(JSON.stringify({status:report.status,changed:report.changed,refs:PAIRS.length}));
 }catch(e){
   report.reason=String(e.message||e).slice(0,220);
   process.exitCode=2;
   if(c){
     try{await c.query('ROLLBACK');report.transaction='ROLLED_BACK';}
     catch(_){report.transaction='ROLLBACK_FAILED';}
   }
   console.error('SOFT_DEACTIVATION_BLOCKED:'+report.reason);
 }finally{
   if(c)c.release();
   fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
   await db.pool.end();
 }
}
if(require.main===module)run();
module.exports={PAIRS,TABLES,authorize,verifyIdentities,validate};
