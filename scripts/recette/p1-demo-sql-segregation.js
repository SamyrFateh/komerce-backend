/**
 * @komerce-arch-lite
 * @role staging-sql-demo-versus-canonical-audit
 * @domain catalog
 * @layer script
 * @owner backend-core
 * @purpose Read-only classification of SQL demo suspects and active KM commercial exposure against canonical upstream gates.
 * @db-read products, sourcing_candidates, product_market_exposure, product_market_price_drafts, catalog_enrichment_runs, markets
 * @db-write none
 * @impact-areas catalog, sourcing, staging-only, e2e-certification
 */
'use strict';
const fs=require('fs'),path=require('path');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {projectUpstreamEvidence}=require('../../services/golden-upstream-evidence');
const HOST='https://komerce-backend-production.up.railway.app';
const DEMOS=Array.from({length:8},(_,i)=>'KPR-'+String(i+84).padStart(6,'0'));
const ANCHORS=[...DEMOS,'KPR-000093'];
const GATES=['SOURCE_PROVED','REFINERY_PROVED','CATALOG_RELEASE_PROVED','STOREFRONT_PROVED'];
const OUT=path.resolve('test-results/staging-p1/demo-sql-vs-canonical.json');
function projectedGate(gates,key){
 const g=gates.find(g=>g.key===key);
 return g?{key,status:g.status,missing:g.checks.filter(x=>!x.ok).map(x=>x.key),
    anomalies:g.anomalies||[]}: {key,status:'NON_PROUVE',missing:['gate_missing'],anomalies:[]};
}
function classify(row,gates){
 if(DEMOS.includes(row.product_ref))return 'DEMO_SQL_DECLARED_VERIFY_PROVENANCE';
 if(GATES.every(key=>gates.find(g=>g.key===key)?.status==='PROVED'))
   return 'BACKEND_GATES_PROVED_NOT_HUMAN_ACCEPTED';
 if(row.exposure_enabled_km&&!gates.some(g=>g.key==='SOURCE_PROVED'&&g.status==='PROVED'))
   return 'EXPOSED_SOURCE_NOT_PROVED';
 if(row.exposure_enabled_km&&!gates.some(g=>g.key==='CATALOG_RELEASE_PROVED'&&g.status==='PROVED'))
   return 'EXPOSED_NOT_BUYER_READY';
 return 'CANONICAL_NOT_YET_PROVED';
}
async function main(){
 if(process.env.KOMERCE_ENV!=='staging'||process.env.NODE_ENV==='production'||
    process.env.STAGING_BASE_URL!==HOST)throw Error('STAGING_TARGET_REQUIRED');
 const result={market:'KM',created_at:new Date().toISOString(),target:HOST,
   meaning:'User-declared SQL demo subset is NOT a forensic determination of writer. Exposure/global price != approved market price.',
   demo_refs_to_reconcile:DEMOS,rows:[],missing_refs:[],groups:{},verdict:'BLOCKED'};
 fs.mkdirSync(path.dirname(OUT),{recursive:true});
 let client;
 try{
   await confirmTarget({db});
   client=await db.pool.connect();
   await client.query('BEGIN READ ONLY');
   await client.query("SET LOCAL statement_timeout = '15s'");
   const sql=[
    'SELECT p.id,p.product_ref,p.name,p.is_active,p.lifecycle_status,p.price_kmf,p.content_source,p.needs_review,',
    "EXISTS (SELECT 1 FROM product_market_exposure e JOIN markets m ON m.id=e.market_id WHERE e.product_id=p.id AND m.code='KM' AND e.commercial_exposure='ENABLED') AS exposure_enabled_km",
    'FROM products p',
    'WHERE p.product_ref=ANY($1::text[]) OR',
    "EXISTS (SELECT 1 FROM product_market_exposure e JOIN markets m ON m.id=e.market_id WHERE e.product_id=p.id AND m.code='KM' AND e.commercial_exposure='ENABLED')",
    'ORDER BY CASE WHEN p.product_ref=ANY($1::text[]) THEN 0 ELSE 1 END,p.product_ref',
    'LIMIT 150'
   ].join(' ');
   const {rows}=await client.query(sql,[ANCHORS]);
   result.missing_refs=ANCHORS.filter(ref=>!rows.some(x=>x.product_ref===ref));
   for(const row of rows){
     const upstream=await projectUpstreamEvidence(client,{
       productId:row.id,marketCode:'KM',storefrontBaseUrl:HOST,fetchImpl:fetch
     });
     const gates=GATES.map(key=>projectedGate(upstream.gates,key));
     const item={
       ref:row.product_ref,id:row.id,
       demo_sql_declared_scope:DEMOS.includes(row.product_ref),
       active:row.is_active,published:row.lifecycle_status==='active',
       global_reference_price_present:Number(row.price_kmf)>0,
       exposure_enabled_km:row.exposure_enabled_km,
       content_source:row.content_source,needs_review:row.needs_review,
       gates,classification:classify(row,gates),
       source_ref:upstream.gates.find(g=>g.key==='SOURCE_PROVED')?.evidence?.run_ref||null,
       price_km:upstream.gates.find(g=>g.key==='CATALOG_RELEASE_PROVED')?.evidence?.local_price||null,
       public_http:upstream.gates.find(g=>g.key==='STOREFRONT_PROVED')?.evidence?.http_status||null
     };
     result.rows.push(item);
     result.groups[item.classification]=(result.groups[item.classification]||0)+1;
   }
   result.verdict='READ_ONLY_INVENTORY_NOT_CERTIFICATION';
   await client.query('ROLLBACK');
   client.release();client=null;
   console.log(JSON.stringify({verdict:result.verdict,examined:result.rows.length,
     by_class:result.groups,missing_demo_refs:result.missing_refs,artifact:OUT}));
 }catch(err){
   result.verdict='BLOCKED';
   result.error=String(err.code||err.message||err).slice(0,230);
   console.error('STAGING_DEMO_AUDIT_BLOCKED: '+result.error);
   process.exitCode=2;
 }finally{
   if(client){try{await client.query('ROLLBACK');}catch(_){}client.release();}
   fs.writeFileSync(OUT,JSON.stringify(result,null,2)+'\n');
   await db.pool.end();
 }
}
if(require.main===module)main();
module.exports={classify,projectedGate,DEMOS};
