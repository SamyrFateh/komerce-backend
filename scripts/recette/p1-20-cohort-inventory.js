/**
 * @komerce-arch-lite
 * @role staging-p1-twenty-real-source-inventory
 * @domain catalog
 * @layer tooling
 * @owner backend-core
 * @purpose Ground a twenty-product P1 cohort in real sourcing, global catalogue, market authority and public storefront.
 * @db-read import_runtime_runs, sourcing_candidates, products, markets, product_market_exposure, product_market_price_drafts
 * @db-write none
 * @impact-areas sourcing, catalog, market, staging-only, e2e-certification
 */
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {evaluateSourcingCandidateOutcome}=require('../../services/sourcing-certification');

const HOST='https://komerce-backend-production.up.railway.app';
const OUT=path.resolve('test-results/staging-p1-20/cohort.json');
const EXPECTED_COUNT=20;
const FOCUS_RUN=process.env.P1_TWENTY_SOURCE_RUN||'KIR-000009';
const MARKET=process.env.P1_TWENTY_MARKET||'KM';

function checkTarget(env=process.env){
  if(env.KOMERCE_ENV!=='staging'||env.NODE_ENV==='production'
    ||env.STAGING_BASE_URL!==HOST||env.E2E_STAGING_BASE_URL!==HOST)
    throw Error('P1_20_STAGING_TARGET_REQUIRED');
  if(MARKET!=='KM')throw Error('P1_20_KM_MARKET_ONLY');
  if(!/^KIR-[0-9]{6}$/.test(FOCUS_RUN))throw Error('P1_20_SOURCE_REF_INVALID');
}

function classifyEvidence(item){
  const source=item.sourcing||{};
  const certified=source.sourcing_certified===true&&source.outcome_valid===true;
  const globalPublished=item.global?.is_active===true&&
    item.global?.is_available===true&&item.global?.lifecycle_status==='active';
  const enabled=item.market?.commercial_exposure==='ENABLED';
  const price=item.market?.price_status==='LOCAL_ACTIVE';
  const shown=item.buyer?.listed===true;
  const blockers=[];
  if(!certified)blockers.push('SOURCING_NOT_CERTIFIED');
  if(!item.global?.product_ref)blockers.push('NOT_HANDED_TO_CATALOG');
  if(item.global?.product_ref&&!globalPublished)blockers.push('CATALOG_NOT_PUBLIC_ACTIVE');
  if(!enabled)blockers.push('MARKET_EXPOSURE_NOT_ENABLED');
  if(!price)blockers.push('LOCAL_PRICE_NOT_ACTIVE');
  if(!shown)blockers.push('NOT_OBSERVED_IN_BUYER_API');
  return {...item,gate:{
    source_certified:certified,catalog_public_active:globalPublished,
    market_exposed:enabled,local_price_active:price,buyer_listed:shown,
    status:blockers.length?'NOT_READY':'PROVED',blockers}};
}

function reduceReadiness(items){
  const unique=new Set(items.map(item=>String(item.supplier_product_id)));
  const sellable=items.filter(item=>item.gate.status==='PROVED');
  const uniquePublic=new Set(sellable.map(item=>item.global?.product_ref).filter(Boolean));
  return {
    source_total:items.length,
    source_distinct:unique.size,
    sourcing_certified:items.filter(x=>x.gate.source_certified).length,
    global_linked:items.filter(x=>Boolean(x.global?.product_ref)).length,
    catalog_public_active:items.filter(x=>x.gate.catalog_public_active).length,
    market_exposed:items.filter(x=>x.gate.market_exposed).length,
    local_price_active:items.filter(x=>x.gate.local_price_active).length,
    buyer_listed:items.filter(x=>x.gate.buyer_listed).length,
    fully_proved_sellable:uniquePublic.size,
    verdict:uniquePublic.size===EXPECTED_COUNT&&
      items.length===EXPECTED_COUNT&&unique.size===EXPECTED_COUNT
      ?'GO_20_CANONICAL_PUBLIC_PRODUCTS':'NOT_YET_20_CANONICAL_PUBLIC_PRODUCTS'
  };
}

async function readBuyerProducts(fetcher=fetch){
  const url=HOST+'/api/products?market='+encodeURIComponent(MARKET)+'&limit=1000';
  const response=await fetcher(url,{
    headers:{Accept:'application/json'},redirect:'manual',
    signal:AbortSignal.timeout(16000)
  });
  if(response.status!==200){
    return {status:'BUYER_API_HTTP_'+response.status,ids:new Set(),refs:new Set(),total:null};
  }
  const payload=await response.json();
  if(!Array.isArray(payload?.products))
    return {status:'BUYER_API_INVALID_SHAPE',ids:new Set(),refs:new Set(),total:null};
  return {
    status:'BUYER_API_200',
    ids:new Set(payload.products.map(p=>String(p.id||'')).filter(Boolean)),
    refs:new Set(payload.products.map(p=>String(p.product_ref||'')).filter(Boolean)),
    total:Number.isFinite(Number(payload.total))?Number(payload.total):null,
    returned:payload.products.length
  };
}

async function inspect({database=db,fetcher=fetch,targetConfirm=confirmTarget}={}){
  checkTarget();
  const confirmed=await targetConfirm({db:database});
  if(confirmed?.confirmed!==true)throw Error('P1_20_DB_FINGERPRINT_NOT_CONFIRMED');

  const ver=await fetcher(HOST+'/health/version',{
    signal:AbortSignal.timeout(10000),redirect:'manual'
  });
  if(ver.status!==200)throw Error('P1_20_STAGING_VERSION_NOT_READABLE');
  const version=await ver.json();
  const deployedSha=String(version.commit||version.sha||'');
  if(!/^[0-9a-f]{40}$/.test(deployedSha))throw Error('P1_20_DEPLOY_SHA_INVALID');

  let tx;
  let rows,run;
  try{
    tx=await database.pool.connect();
    await tx.query('BEGIN READ ONLY');
    await tx.query("SET LOCAL statement_timeout='15000ms'");
    const runQuery=await tx.query(
      `SELECT id,run_ref,provider,source_type,intake
         FROM import_runtime_runs WHERE run_ref=$1`,[FOCUS_RUN]);
    if(runQuery.rows.length!==1)throw Error('P1_20_KIR_NOT_FOUND');
    run=runQuery.rows[0];
    const query=await tx.query(
      `SELECT sc.*,sc.id AS candidate_id,sc.state AS candidate_state,
              p.product_ref,p.is_active,p.is_available,p.lifecycle_status,
              COALESCE(pme.commercial_exposure,'DISABLED') AS commercial_exposure,
              pm.status AS price_status
         FROM sourcing_candidates sc
         LEFT JOIN products p ON p.id=sc.product_id
         LEFT JOIN markets m ON m.code=$2
         LEFT JOIN product_market_exposure pme
           ON pme.product_id=p.id AND pme.market_id=m.id
         LEFT JOIN LATERAL (
            SELECT status FROM product_market_price_drafts
             WHERE product_id=p.id AND market_id=m.id
             ORDER BY updated_at DESC LIMIT 1
         ) pm ON TRUE
        WHERE sc.import_id=$1
        ORDER BY sc.id ASC`,
      [run.id,MARKET]
    );
    rows=query.rows;
    await tx.query('ROLLBACK');tx.release();tx=null;
  }catch(err){
    if(tx){await tx.query('ROLLBACK').catch(()=>{});tx.release();}
    throw err;
  }
  if(rows.length!==EXPECTED_COUNT)throw Error('P1_20_SOURCE_BATCH_NOT_EXACTLY_20');

  const buyer=await readBuyerProducts(fetcher);
  const items=rows.map(row=>{
    const status=evaluateSourcingCandidateOutcome(row);
    const item={
      candidate_id:row.candidate_id,candidate_ref:row.candidate_ref,
      supplier_product_id:row.supplier_product_id,
      candidate_state:row.candidate_state,
      sourcing:{decision:status.decision,outcome:status.outcome,
        sourcing_certified:status.sourcing_certified,outcome_valid:status.outcome_valid,
        reasons:status.reasons||[]},
      source_contract_v2:String(row.normalized_source_contract?.schema_version)==='2',
      global:{product_id:row.product_id||null,product_ref:row.product_ref||null,
        is_active:row.is_active,is_available:row.is_available,
        lifecycle_status:row.lifecycle_status||null},
      market:{code:MARKET,commercial_exposure:row.commercial_exposure,
        price_status:row.price_status||null},
      buyer:{listed:buyer.ids.has(String(row.product_id))||
        buyer.refs.has(String(row.product_ref))}
    };
    return classifyEvidence(item);
  });
  const summary=reduceReadiness(items);
  // Use both the immutable initial KIR count and current certified decision,
  // never silently rewrite old evidence to manufacture a green batch.
  const recorded=Number(run.intake?.ready_for_refinery);
  const current=summary.sourcing_certified;
  return {
    schema_version:1,generated_at:new Date().toISOString(),
    target:HOST,market:MARKET,deployed_sha:deployedSha,
    source_run:{ref:FOCUS_RUN,provider:run.provider,source_type:run.source_type,
      initial_ready:Number.isFinite(recorded)?recorded:null,current_ready:current,
      historical_delta:Number.isFinite(recorded)?current-recorded:null},
    expected_count:EXPECTED_COUNT,write_count:0,
    buyer_api:{status:buyer.status,total:buyer.total,returned:buyer.returned??null},
    summary,products:items
  };
}

async function main(){
  fs.mkdirSync(path.dirname(OUT),{recursive:true});
  let report;
  try{
    report=await inspect();
    console.log('[P1-20] '+JSON.stringify({
      market:report.market,source_run:report.source_run.ref,
      run_initial_ready:report.source_run.initial_ready,
      run_current_ready:report.source_run.current_ready,
      observed_api:report.buyer_api,summary:report.summary,
      evidence_file:OUT
    }));
  }catch(error){
    report={schema_version:1,generated_at:new Date().toISOString(),
      status:'INVENTORY_BLOCKED',reason:String(error.code||error.message).slice(0,160),
      target:HOST,write_count:0,expected_count:EXPECTED_COUNT};
    console.error('[P1-20] '+report.reason);
    process.exitCode=2;
  }finally{
    fs.writeFileSync(OUT,JSON.stringify(report,null,2)+'\n');
    await db.pool.end();
  }
}
if(require.main===module)main();
module.exports={checkTarget,classifyEvidence,reduceReadiness,readBuyerProducts,inspect,EXPECTED_COUNT};
