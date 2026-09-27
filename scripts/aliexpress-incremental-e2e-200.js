#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../db');
const pricingEngine = require('../services/pricing-engine');
const scanner = require('../services/supplier-catalog-scanner');
const eligibility = require('../services/catalog-eligibility');
const { promoteCandidate } = require('../services/sourcing-candidate-actions');
const freeFr = require('./catalog-fr-free-e2e-preparation');
const { validatePublicationUpdate } = require('../services/product-publication-guard');

const SUPPLIER = 'AliExpress';
const WAVE_ID = 'incremental-e2e-200-v1';
const TARGET = 200;
const FLAG = 'KOMERCE_ALLOW_ALIEXPRESS_INCREMENTAL_E2E_200';
const ALLOWED_DECISIONS = new Set(['TEST', 'PRIORITY']);
const EXPECTED_PRICE_AUTHORITY = 'ECONOMIC_REFERENCE_NOT_MARKET_DECISION';

function isTruthy(v){ return ['1','true','yes'].includes(String(v||'').trim().toLowerCase()); }
function assertRuntime(env=process.env){
  if(String(env.KOMERCE_ENV||'').trim().toLowerCase()!=='staging'||env.NODE_ENV!=='test'){
    throw new Error('REFUS: campagne AliExpress incremental E2E 200 réservée à staging/test');
  }
  if(!isTruthy(env[FLAG])) throw new Error(`${FLAG}=1 requis`);
  if(!env.DATABASE_URL) throw new Error('DATABASE_URL requis');
}
function parseArgs(argv=process.argv.slice(2)){
  let operation='audit', output=null;
  for(let i=0;i<argv.length;i+=1){
    const arg=argv[i];
    if(arg==='--operation') operation=String(argv[++i]||'').trim();
    else if(arg.startsWith('--operation=')) operation=String(arg.split('=',2)[1]||'').trim();
    else if(arg==='--output') output=String(argv[++i]||'').trim();
    else if(arg.startsWith('--output=')) output=String(arg.split('=',2)[1]||'').trim();
    else throw new Error(`Argument inconnu: ${arg}`);
  }
  if(!['audit','refinery-audit','promote','prepare-fr','accept'].includes(operation)){
    throw new Error('operation invalide');
  }
  return {operation,output:output?path.resolve(output):null};
}
async function loadWaveRows(){
  const {rows}=await db.query(`
    SELECT sc.id candidate_id,sc.state,sc.product_id,sc.supplier_product_id,
           sc.raw_payload,sc.normalized_source_contract,sc.scan_result,
           p.product_ref,p.name,p.description,p.category,p.subcategory,p.price_kmf,p.stock,
           p.content_source,p.needs_review,p.source_locale,p.lifecycle_status,p.is_active,p.is_available
      FROM sourcing_candidates sc
      LEFT JOIN products p ON p.id=sc.product_id
     WHERE sc.supplier_name=$1
       AND sc.raw_payload #>> '{discovery,wave}'=$2
     ORDER BY sc.created_at,sc.id`,[SUPPLIER,WAVE_ID]);
  return rows;
}
function decisionOf(row){ return String(row?.scan_result?.sourcing_decision||'').trim().toUpperCase()||'UNKNOWN'; }
function testPriceOf(row){ const n=Number(row?.scan_result?.test_price_kmf); return Number.isFinite(n)&&n>0?Math.round(n):null; }
function priceAuthorityOf(row){
  const s=row?.scan_result||{};
  return String(s.recommended_price_authority||s.price_authority||'').trim()||null;
}
async function audit(){
  const rows=await loadWaveRows();
  const out={supplier:SUPPLIER,wave:WAVE_ID,target:TARGET,total:rows.length,scanned:0,promoted:0,decisions:{}};
  for(const row of rows){
    if(row.state==='scanned') out.scanned+=1;
    if(row.state==='imported_to_catalog'&&row.product_id) out.promoted+=1;
    const d=decisionOf(row); out.decisions[d]=(out.decisions[d]||0)+1;
  }
  return out;
}
async function refineryAudit(){
  const rows=await loadWaveRows();
  const config=await pricingEngine.loadGlobalConfig();
  const exclusions=await eligibility.loadActiveExclusions();
  const decisions={},errors=[]; let drift=0;
  for(const row of rows){
    try{
      const contract=row.normalized_source_contract;
      if(!contract||String(contract.schema_version||'')!=='2') throw new Error('normalized_v2_missing');
      const product={...JSON.parse(JSON.stringify(contract)),raw_payload:JSON.parse(JSON.stringify(row.raw_payload||{}))};
      const normalized=await scanner.normalizeCandidate(product,{config});
      const verdict=eligibility.checkEligibility(normalized,exclusions);
      const scan=verdict?.layer==='absolute'?{sourcing_decision:'EXCLUDED'}:await scanner.scanCandidate(normalized,{config});
      const computed=String(scan.sourcing_decision||'UNKNOWN').toUpperCase();
      decisions[computed]=(decisions[computed]||0)+1;
      if(computed!==decisionOf(row)) drift+=1;
    }catch(e){ errors.push({supplier_product_id:row.supplier_product_id,error:String(e.message||e).slice(0,240)}); }
  }
  return {processed:rows.length,decisions,persisted_decision_drift:drift,errors_count:errors.length,errors:errors.slice(0,20)};
}
async function promote(){
  const rows=await loadWaveRows();
  const selected=rows.filter(row=>row.state==='scanned'&&!row.product_id
    &&ALLOWED_DECISIONS.has(decisionOf(row))
    &&String(row?.normalized_source_contract?.schema_version||'')==='2'
    &&testPriceOf(row)>0&&priceAuthorityOf(row)===EXPECTED_PRICE_AUTHORITY).slice(0,TARGET);
  const failures=[]; let promoted=0;
  for(const row of selected){
    try{ await promoteCandidate(row.candidate_id,{price_kmf:testPriceOf(row),enrichment_mode:'source_only'},null); promoted+=1; }
    catch(e){ failures.push({supplier_product_id:row.supplier_product_id,error:String(e.message||e).slice(0,240)}); }
  }
  const result={selected:selected.length,promoted,failures_count:failures.length,failures:failures.slice(0,20)};
  if(failures.length){ const e=new Error(`ALI_INCREMENTAL_PROMOTION_INCOMPLETE:${failures.length}/${selected.length}`); e.result=result; throw e; }
  return result;
}
async function prepareFr(){
  const result=await freeFr.run({limit:TARGET,output:null,suppliers:[SUPPLIER],discoveryWave:WAVE_ID});
  return result.summary;
}
async function collectAcceptance(){
  const {rows}=await db.query(`
    WITH media AS (
      SELECT product_id,COUNT(*) FILTER (WHERE is_active=TRUE)::int active_media
        FROM catalog_media GROUP BY product_id
    ), sku AS (
      SELECT product_id,
             COUNT(*) FILTER (WHERE source='SUPPLIER' AND is_active=TRUE)::int active_supplier_skus,
             COUNT(*) FILTER (WHERE source='SUPPLIER' AND is_active=TRUE
               AND supplier_unit_ref IS NOT NULL AND supplier_order_identity IS NOT NULL)::int active_complete_soi_skus
        FROM product_skus GROUP BY product_id
    ), exposure AS (
      SELECT product_id,COUNT(*) FILTER (WHERE commercial_exposure='ENABLED')::int enabled_markets
        FROM product_market_exposure GROUP BY product_id
    )
    SELECT sc.supplier_product_id,p.product_ref,p.name,p.description,p.category,p.subcategory,
           p.price_kmf,p.stock,p.content_source,p.needs_review,p.source_locale,
           p.lifecycle_status,p.is_active,p.is_available,
           COALESCE(media.active_media,0)::int active_media,
           COALESCE(sku.active_supplier_skus,0)::int active_supplier_skus,
           COALESCE(sku.active_complete_soi_skus,0)::int active_complete_soi_skus,
           COALESCE(exposure.enabled_markets,0)::int enabled_markets
      FROM sourcing_candidates sc
      JOIN products p ON p.id=sc.product_id
      LEFT JOIN media ON media.product_id=p.id
      LEFT JOIN sku ON sku.product_id=p.id
      LEFT JOIN exposure ON exposure.product_id=p.id
     WHERE sc.supplier_name=$1 AND sc.raw_payload #>> '{discovery,wave}'=$2
       AND sc.state='imported_to_catalog'
     ORDER BY p.product_ref`,[SUPPLIER,WAVE_ID]);
  const products=rows.map(row=>{
    const reasons=[];
    const locale=String(row.source_locale||'').trim().toLowerCase().replace('_','-');
    const editorial=row.needs_review===false&&(row.content_source==='manual'||row.content_source==='ai_enriched'
      ||(row.content_source==='connector_raw'&&(locale==='fr'||locale.startsWith('fr-'))));
    if(!editorial) reasons.push('editorial_not_ready');
    if(Number(row.active_media)<1) reasons.push('media_missing');
    if(Number(row.active_supplier_skus)<1) reasons.push('active_supplier_sku_missing');
    if(Number(row.active_complete_soi_skus)<Number(row.active_supplier_skus)) reasons.push('supplier_order_identity_partial');
    if(!String(row.category||'').trim()) reasons.push('category_missing');
    if(row.lifecycle_status!=='candidate'||row.is_active===true) reasons.push('not_inactive_candidate');
    if(Number(row.enabled_markets)>0) reasons.push('market_exposure_enabled');
    const pub=validatePublicationUpdate({before:{...row,is_active:false,is_available:false},patch:{is_active:true},context:{catalogMediaCount:Number(row.active_media||0)}});
    if(!pub.ok) reasons.push(`publication_guard:${pub.code}`);
    return {supplier_product_id:row.supplier_product_id,product_ref:row.product_ref,ready:reasons.length===0,reasons,
      active_supplier_skus:Number(row.active_supplier_skus||0),active_complete_soi_skus:Number(row.active_complete_soi_skus||0)};
  });
  const reasons={}; for(const p of products) for(const r of p.reasons) reasons[r]=(reasons[r]||0)+1;
  return {total:products.length,ready:products.filter(p=>p.ready).length,
    with_active_supplier_sku:products.filter(p=>p.active_supplier_skus>0).length,
    with_complete_soi:products.filter(p=>p.active_complete_soi_skus>0&&p.active_complete_soi_skus===p.active_supplier_skus).length,
    reasons,products};
}
async function accept(options){
  const readiness=await collectAcceptance();
  const accepted=readiness.total===TARGET&&readiness.ready===TARGET
    &&readiness.with_active_supplier_sku===TARGET&&readiness.with_complete_soi===TARGET;
  const report={schema_version:1,supplier:SUPPLIER,wave:WAVE_ID,target:TARGET,accepted,readiness};
  if(options.output){ fs.mkdirSync(path.dirname(options.output),{recursive:true}); fs.writeFileSync(options.output,JSON.stringify(report,null,2)+'\n'); }
  if(!accepted) throw new Error(`ALI_INCREMENTAL_ACCEPTANCE_FAILED ready=${readiness.ready}/${TARGET} total=${readiness.total}/${TARGET} reasons=${JSON.stringify(readiness.reasons)}`);
  return report;
}
async function main(options=parseArgs()){
  assertRuntime();
  const result=options.operation==='audit'?await audit()
    :options.operation==='refinery-audit'?await refineryAudit()
    :options.operation==='promote'?await promote()
    :options.operation==='prepare-fr'?await prepareFr()
    :await accept(options);
  console.log(`[aliexpress-incremental-e2e-200] ${options.operation.toUpperCase()} ${JSON.stringify(result)}`);
  return result;
}
if(require.main===module){
  main().then(()=>process.exit(0)).catch(e=>{ if(e?.result) console.error('[aliexpress-incremental-e2e-200] PARTIAL '+JSON.stringify(e.result));
    console.error(`[aliexpress-incremental-e2e-200] FAILED: ${e.stack||e.message||e}`); process.exit(1); }).finally(()=>db.pool.end());
}
module.exports={SUPPLIER,WAVE_ID,TARGET,FLAG,parseArgs,assertRuntime,decisionOf,testPriceOf,priceAuthorityOf,audit,refineryAudit,promote,prepareFr,collectAcceptance,accept,main};
