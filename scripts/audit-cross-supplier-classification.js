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
    const reports=[];
    for(const runRef of RUNS){
      const report=await auditRun(runRef,{query:client,sourceAudit:ref=>sourceAudit(ref,client)});
      const products=report.products.map(p=>({
        candidate_ref:p.candidate_ref,source_path:p.source_path,
        category:p.category||null,subcategory:p.subcategory||null,
        status:p.status,reason:p.source,
        historical_category:p.historical_category||null,
        historical_subcategory:p.historical_subcategory||null
      }));
      reports.push({run_ref:runRef,provider:report.provider,
        inspected:report.inspected,classified:products.filter(x=>x.category&&x.subcategory).length,
        unresolved:products.filter(x=>!x.category||!x.subcategory).length,
        products});
    }
    await client.query('ROLLBACK');
    return {generated_at:new Date().toISOString(),target:HOST,mode:'READ_ONLY',
      decision:'CLASSIFICATION_ONLY_NOT_SELLABILITY',writes:0,reports,
      all_classified:reports.every(x=>x.inspected===20&&x.unresolved===0)};
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
  finally{client.release();}
}
if(require.main===module){
  run().then(result=>{
    const out=path.resolve('test-results/cross-supplier-classification/classification.json');
    fs.mkdirSync(path.dirname(out),{recursive:true});
    fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify({all_classified:result.all_classified,
      providers:result.reports.map(r=>({provider:r.provider,run:r.run_ref,classified:r.classified,unresolved:r.unresolved}))}));
    if(!result.all_classified) process.exitCode=2;
  }).catch(e=>{console.error(e.message);process.exitCode=1;})
    .finally(()=>db.pool.end());
}
module.exports={run,RUNS};
