/**
 * @komerce-arch-lite
 * @role staging-source-eligibility-vs-completeness-audit
 * @domain sourcing
 * @layer script
 * @owner backend-core
 * @purpose Examine all 20 real source decisions without interpreting a missing field as unmarketability.
 * @impact-areas sourcing, catalog, staging-only
 * @db-read import_runtime_runs, sourcing_candidates
 * @db-write none
 */
'use strict';
const db=require('../../db');
const fs=require('node:fs');
const path=require('node:path');
const {confirmTarget}=require('./target-guard');
const {evaluateSourcingCandidateOutcome}=require('../../services/sourcing-certification');
const HOST='https://komerce-backend-production.up.railway.app';
const RUN='KIR-000009';
const OUT=path.resolve('test-results/staging-p1-20/source-eligibility-ledger.json');

/** Diagnostic classification only: NEVER authorizes promotion, import or sale. */
function issueCategory(row, verdict) {
  const scan=row.scan_result||{};
  const dec=verdict.decision;
  if(dec==='EXCLUDED'||row.state==='rejected')
    return {type:'EXPLICIT_EXCLUSION_REVIEW',reason:scan.reason||row.rejected_reason||null,hard_gate:true};
  if(verdict.sourcing_certified) return {type:'SOURCE_CERTIFIED',reason:null,hard_gate:false};
  if(scan.fx_gate?.status==='AWAITING_OFFICIAL_QUOTE'||row.fx_pending?.code==='fx_rate_unavailable')
    return {type:'MISSING_FX_QUOTE',reason:scan.reason||null,hard_gate:false};
  if(!row.purchase_price_kmf || Number(row.purchase_price_kmf)<=0)
    return {type:'MISSING_PURCHASE_COST',reason:scan.reason||null,hard_gate:false};
  if(scan.commercial_review?.status==='PENDING_CLASSIFICATION'||
    scan.customs_review?.status==='REQUIRED'||
    row.data_sources?.category==='default'||!row.komerce_category)
    return {type:'TAXONOMY_OR_CUSTOMS_REVIEW',reason:scan.reason||null,hard_gate:false};
  if(['WATCH','AVOID','LOSS'].includes(dec))
    return {type:'ECONOMIC_TEST_NOT_ACCEPTED',reason:scan.reason||null,hard_gate:false};
  return {type:'UNRESOLVED_SOURCE_REVIEW',reason:scan.reason||null,hard_gate:false};
}
function summarize(items){
  const counts={};
  for(const x of items)counts[x.issue.type]=(counts[x.issue.type]||0)+1;
  return {total:items.length,certified:items.filter(x=>x.sourcing_certified).length,
    noncertified:items.filter(x=>!x.sourcing_certified).length,by_issue:counts,
    excluded_pending_review:items.filter(x=>x.issue.hard_gate).length,
    catalog_linked:items.filter(x=>x.catalog_linked).length};
}
async function inspect({database=db,confirm=confirmTarget,env=process.env}={}){
  if(env.KOMERCE_ENV!=='staging'||env.STAGING_BASE_URL!==HOST||
    env.NODE_ENV==='production')throw Error('P1_SOURCE_AUDIT_STAGING_ONLY');
  const identity=await confirm({db:database,env});
  if(identity?.confirmed!==true)throw Error('P1_SOURCE_AUDIT_WRONG_DATABASE');
  const client=await database.pool.connect();
  let rows=[];
  try{
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout='12000ms'");
    const data=await client.query(
      `SELECT sc.*
         FROM sourcing_candidates sc
         JOIN import_runtime_runs rr ON rr.import_id=sc.import_id
        WHERE rr.run_ref=$1 ORDER BY sc.candidate_ref,sc.id`,[RUN]);
    rows=data.rows;
    await client.query('ROLLBACK');
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
  finally{client.release();}
  const items=rows.map(row=>{
    const verdict=evaluateSourcingCandidateOutcome(row);
    const issue=issueCategory(row,verdict);
    return {
      candidate_ref:row.candidate_ref,supplier_product_id:row.supplier_product_id,
      state:row.state,decision:verdict.decision,outcome:verdict.outcome,
      sourcing_certified:verdict.sourcing_certified,
      valid_accounting:verdict.outcome_valid,
      evidence_errors:verdict.reasons,
      supplier_offer:{has_purchase_cost:Number(row.purchase_price_kmf)>0,
        has_source_contract_v2:String(row.normalized_source_contract?.schema_version)==='2',
        stock_known:row.stock_available!=null,
        source_category_present:Boolean(row.supplier_category)},
      catalog_linked:Boolean(row.product_id),
      economic_test:{health:row.scan_result?.economic_test_health_status||null,
        margin_pct:row.scan_result?.economic_test_margin_pct??null},
      issue
    };
  });
  if(items.length!==20)throw Error('P1_SOURCE_AUDIT_EXPECTS_20_DISTINCT_RECORDS');
  if(new Set(items.map(x=>x.supplier_product_id)).size!==20)
    throw Error('P1_SOURCE_AUDIT_DUPLICATE_SOURCE_ID');
  return {run_ref:RUN,generated_at:new Date().toISOString(),mode:'DB_READ_ONLY',
    classification:'DIAGNOSTIC_ONLY_NOT_PUBLICATION_AUTHORITY',
    summary:summarize(items),items,write_count:0};
}
async function main(){
  let report;
  try{report=await inspect();
    console.log('[P1-ELIGIBILITY] '+JSON.stringify(report));
  }catch(e){
    process.exitCode=2;
    report={run_ref:RUN,status:'AUDIT_BLOCKED',reason:String(e.code||e.message).slice(0,150),write_count:0};
    console.error('[P1-ELIGIBILITY] '+JSON.stringify(report));
  }finally{
    fs.mkdirSync(path.dirname(OUT),{recursive:true});
    fs.writeFileSync(OUT,JSON.stringify(report,null,2)+'\n');
    await db.pool.end();
  }
}
if(require.main===module)main();
module.exports={issueCategory,summarize,inspect};
