/** @komerce-arch-lite
 * @role cross-supplier-commercial-classification-proof
 * @domain sourcing
 * @layer tooling
 * @purpose Read-only independently replayed boutique taxonomy, AliExpress vs CJ
 * @db-read import_runtime_runs, import_runtime_item_events, sourcing_candidates, supplier_commercial_category_mappings, boutique_categories, boutique_subcategories
 * @db-write none
 */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const db=require('../db');
const {confirmTarget}=require('./recette/target-guard');
const {audit}=require('./audit-kir-unified-commercial-coverage');
const {audit:sourceAudit}=require('./audit-kir-supplier-category-provenance');
const RUNS=Object.freeze(['KIR-000009','KIR-000008']);
const HOST='https://komerce-backend-production.up.railway.app';
async function run({database=db,confirm=confirmTarget,auditRun=audit,env=process.env}={}) {
  if(env.KOMERCE_ENV!=='staging'||env.NODE_ENV==='production'||env.STAGING_BASE_URL!==HOST)
    throw new Error('CLASSIFICATION_STAGING_ONLY');
  const target=await confirm({db:database,env});
  if(target?.confirmed!==true)throw new Error('CLASSIFICATION_DB_FINGERPRINT_MISMATCH');
  const client=await database.pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout='25000ms'");
    const {rows:available}=await client.query(
      "SELECT run_ref,provider,source_total FROM import_runtime_runs WHERE run_ref=ANY($1::text[]) ORDER BY run_ref",
      [RUNS]);
    const availableByRef=new Map(available.map(x=>[x.run_ref,x]));
    const reports=[];
    for(const runRef of RUNS){
      if(!availableByRef.has(runRef)){
        reports.push({run_ref:runRef,status:'RUN_NOT_FOUND',provider:null,
          inspected:0,classified:0,unresolved:null,products:[],
          reason:'The requested historical cohort is absent from this staging database'});
        continue;
      }

      const report=await auditRun(runRef,{query:client,sourceAudit:ref=>sourceAudit(ref,client)});
      const products=report.products.map(p=>({
        candidate_ref:p.candidate_ref,source_path:p.source_path,
        category:p.category||null,subcategory:p.subcategory||null,
        status:p.status,reason:p.source,
        historical_category:p.historical_category||null,
        historical_subcategory:p.historical_subcategory||null
      }));
      reports.push({run_ref:runRef,status:'AUDITED',provider:report.provider,
        inspected:report.inspected,classified:products.filter(x=>x.category&&x.subcategory).length,
        unresolved:products.filter(x=>!x.category||!x.subcategory).length,
        products});
    }
    await client.query('ROLLBACK');
    return {generated_at:new Date().toISOString(),target:HOST,mode:'READ_ONLY',
      decision:'CLASSIFICATION_ONLY_NOT_SELLABILITY',writes:0,reports,
      missing_runs:reports.filter(x=>x.status==='RUN_NOT_FOUND').map(x=>x.run_ref),
      all_classified:reports.length===RUNS.length&&reports.every(x=>x.status==='AUDITED'&&x.inspected===20&&x.unresolved===0)};
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
  finally{client.release();}
}
if(require.main===module){
  const out=path.resolve('test-results/cross-supplier-classification/classification.json');
  const persist=(result)=>{
    fs.mkdirSync(path.dirname(out),{recursive:true});
    fs.writeFileSync(out,JSON.stringify(result,null,2)+'\\n');
  };
  run().then(result=>{
    persist(result);
    console.log('[CLASSIFICATION_PROOF] '+JSON.stringify({
      status:result.all_classified?'PASS':'CLASSIFICATION_GAPS',
      providers:result.reports.map(r=>({
        provider:r.provider,run:r.run_ref,
        inspected:r.inspected,classified:r.classified,unresolved:r.unresolved
      }))
    }));
    if(!result.all_classified) process.exitCode=2;
  }).catch(e=>{
    const code=String(e.code||e.message||'UNKNOWN_ERROR').slice(0,160);
    persist({status:'AUDIT_EXECUTION_ERROR',error_code:code,
      runs:RUNS,mode:'READ_ONLY',writes:0,
      message:'No classification coverage has been certified by this attempt.'});
    console.error('[CLASSIFICATION_PROOF] '+code);
    process.exitCode=1;
  }).finally(()=>db.pool.end());
}
module.exports={run,RUNS};
