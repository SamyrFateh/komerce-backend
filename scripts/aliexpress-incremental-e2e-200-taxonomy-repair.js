#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          aliexpress-incremental-e2e-200-taxonomy-repair
 * @domain        catalog
 * @layer         tooling
 * @criticality   high
 * @inputs        isolated staging DB, incremental-e2e-200-v1 candidates
 * @outputs       projected/applied taxonomy repair for the exact 200-product wave
 * @depends       db.js, services/pricing-engine.js, services/supplier-catalog-scanner.js
 * @used-by       operator-run isolated incremental supplier campaign
 * @db-read       sourcing_candidates, products
 * @db-write      sourcing_candidates, products
 * @db-txn        one bounded transaction for apply
 * @doctrine      repair_same_wave_without_resourcing, no_production, no_auto_publish
 * @impact-areas  catalog, sourcing, supplier-import, refinery, staging
 * @version       2026-09-v1
 */
'use strict';

const db = require('../db');
const pricingEngine = require('../services/pricing-engine');
const scanner = require('../services/supplier-catalog-scanner');

const SUPPLIER = 'AliExpress';
const WAVE_ID = 'incremental-e2e-200-v1';
const TARGET = 200;
const FLAG = 'KOMERCE_ALLOW_ALIEXPRESS_INCREMENTAL_E2E_200';

function isTruthy(v){ return ['1','true','yes'].includes(String(v||'').trim().toLowerCase()); }

function assertRuntime(env=process.env){
  if(String(env.KOMERCE_ENV||'').trim().toLowerCase()!=='staging'||env.NODE_ENV!=='test'){
    throw new Error('REFUS: réparation taxonomie +200 réservée à staging/test');
  }
  if(!isTruthy(env[FLAG])) throw new Error(`${FLAG}=1 requis`);
  if(!env.DATABASE_URL) throw new Error('DATABASE_URL requis');
}

function parseArgs(argv=process.argv.slice(2)){
  let operation='audit';
  for(let i=0;i<argv.length;i+=1){
    const arg=argv[i];
    if(arg==='--operation') operation=String(argv[++i]||'').trim();
    else if(arg.startsWith('--operation=')) operation=String(arg.split('=',2)[1]||'').trim();
    else throw new Error(`Argument inconnu: ${arg}`);
  }
  if(!['audit','apply'].includes(operation)) throw new Error('operation invalide');
  return {operation};
}

async function loadRows(q=db){
  const {rows}=await q.query(`
    SELECT sc.id candidate_id, sc.product_id, sc.state, sc.supplier_product_id,
           sc.komerce_category old_candidate_category, sc.raw_payload,
           sc.normalized_source_contract, sc.scan_result old_scan_result,
           p.product_ref, p.category old_product_category
      FROM sourcing_candidates sc
      LEFT JOIN products p ON p.id=sc.product_id
     WHERE sc.supplier_name=$1
       AND sc.raw_payload #>> '{discovery,wave}'=$2
     ORDER BY sc.created_at,sc.id`,[SUPPLIER,WAVE_ID]);
  return rows;
}

function bump(map,key){ const k=key||'UNRESOLVED'; map[k]=(map[k]||0)+1; }
function bumpTransition(map,from,to){ const k=`${from||'UNRESOLVED'} -> ${to||'UNRESOLVED'}`; map[k]=(map[k]||0)+1; }

async function project(rows,config){
  const transitions={},before={},after={},expected={},provenance={},details=[];
  const activeCategories=Object.values(config?.categories||{});
  let changed=0, scanDecisionDrift=0, categoryMismatch=0, unresolvedProvenance=0;
  for(const row of rows){
    const contract=row.normalized_source_contract;
    if(!contract||String(contract.schema_version||'')!=='2') throw new Error(`normalized_v2_missing:${row.supplier_product_id}`);
    const sourceProduct={...JSON.parse(JSON.stringify(contract)),raw_payload:JSON.parse(JSON.stringify(row.raw_payload||{}))};
    const expectedMap=scanner.mapProductCategory(sourceProduct,activeCategories);
    const expectedCategory=expectedMap?.key||null;
    const discovery=sourceProduct.raw_payload?.discovery||{};
    const provenanceKey=[
      discovery.segment_id||null,
      discovery.target_category||null,
      discovery.target_subcategory||null,
    ].filter(Boolean).join(' | ')||'UNRESOLVED';
    const normalized=await scanner.normalizeCandidate(sourceProduct,{config});
    const scan=await scanner.scanCandidate(normalized,{config});
    const oldCategory=row.old_candidate_category||null;
    const newCategory=normalized.komerce_category||null;
    const oldDecision=String(row.old_scan_result?.sourcing_decision||'UNKNOWN').toUpperCase();
    const newDecision=String(scan.sourcing_decision||'UNKNOWN').toUpperCase();
    bump(before,oldCategory);
    bump(after,newCategory);
    bump(expected,expectedCategory);
    bump(provenance,`${provenanceKey} -> ${expectedCategory||'UNRESOLVED'}`);
    bumpTransition(transitions,oldCategory,newCategory);
    if(oldCategory!==newCategory) changed+=1;
    if(oldDecision!==newDecision) scanDecisionDrift+=1;
    if(!expectedCategory||expectedMap?.source==='default') unresolvedProvenance+=1;
    if(newCategory!==expectedCategory) categoryMismatch+=1;
    details.push({
      candidate_id:row.candidate_id,
      product_id:row.product_id,
      product_ref:row.product_ref,
      supplier_product_id:row.supplier_product_id,
      old_category:oldCategory,
      old_product_category:row.old_product_category||null,
      new_category:newCategory,
      expected_category:expectedCategory,
      category_mapping_source:expectedMap?.source||'default',
      discovery_provenance:provenanceKey,
      old_decision:oldDecision,
      new_decision:newDecision,
      normalized,
      scan,
    });
  }
  return {
    summary:{
      total:rows.length,
      changed,
      unchanged:rows.length-changed,
      scan_decision_drift:scanDecisionDrift,
      category_mismatch:categoryMismatch,
      unresolved_provenance:unresolvedProvenance,
      before,
      expected,
      after,
      provenance,
      transitions,
    },
    details,
  };
}

function sameDistribution(actual={},expected={}){
  const keys=[...new Set([...Object.keys(actual||{}),...Object.keys(expected||{})])].sort();
  return keys.every(key=>Number(actual?.[key]||0)===Number(expected?.[key]||0));
}

function assertSafeProjection(projection){
  const summary=projection?.summary||{};
  if(summary.total!==TARGET) throw new Error(`TAXONOMY_REPAIR_UNSAFE_TOTAL:${summary.total}/${TARGET}`);
  if(summary.scan_decision_drift!==0) {
    throw new Error(`TAXONOMY_REPAIR_DECISION_DRIFT:${summary.scan_decision_drift}`);
  }
  if(summary.unresolved_provenance!==0) {
    throw new Error(`TAXONOMY_REPAIR_UNRESOLVED_PROVENANCE:${summary.unresolved_provenance}`);
  }
  if(summary.category_mismatch!==0) {
    throw new Error(`TAXONOMY_REPAIR_CATEGORY_MISMATCH:${summary.category_mismatch}`);
  }
  const expectedTotal=Object.values(summary.expected||{}).reduce((sum,value)=>sum+Number(value||0),0);
  if(expectedTotal!==summary.total) {
    throw new Error(`TAXONOMY_REPAIR_EXPECTED_TOTAL_MISMATCH:${expectedTotal}/${summary.total}`);
  }
  if(!sameDistribution(summary.after||{},summary.expected||{})) {
    throw new Error(`TAXONOMY_REPAIR_UNEXPECTED_DISTRIBUTION:${JSON.stringify({expected:summary.expected,after:summary.after})}`);
  }
}

async function applyProjection(projection){
  assertSafeProjection(projection);
  const client=await db.getClient();
  try{
    await client.query('BEGIN');
    for(const item of projection.details){
      const merged={
        ...item.scan.scan_result,
        sourcing_decision:item.scan.sourcing_decision,
        reason:item.scan.reason,
        recommended_action:item.scan.recommended_action,
      };
      await client.query(`
        UPDATE sourcing_candidates
           SET komerce_category=$1,
               estimated_weight_kg=$2,
               estimated_volume_m3=$3,
               target_margin_pct=$4,
               data_sources=$5::jsonb,
               confidence=$6,
               scan_result=$7::jsonb,
               scan_at=NOW()
         WHERE id=$8`,[
           item.normalized.komerce_category,
           item.normalized.estimated_weight_kg,
           item.normalized.estimated_volume_m3,
           item.normalized.target_margin_pct,
           JSON.stringify(item.normalized.data_sources||{}),
           item.normalized.confidence,
           JSON.stringify(merged),
           item.candidate_id,
         ]);
      if(item.product_id){
        await client.query(
          'UPDATE products SET category=$1, updated_at=NOW() WHERE id=$2 AND lifecycle_status=\'candidate\' AND is_active=FALSE',
          [item.normalized.komerce_category,item.product_id]
        );
      }
    }
    await client.query('COMMIT');
  }catch(error){
    await client.query('ROLLBACK');
    throw error;
  }finally{
    client.release();
  }
}

async function main(options=parseArgs()){
  assertRuntime();
  const rows=await loadRows();
  if(rows.length!==TARGET) throw new Error(`REFUS: vague attendue ${TARGET}, trouvée ${rows.length}`);
  const config=await pricingEngine.loadGlobalConfig();
  const projection=await project(rows,config);
  console.log(`[aliexpress-taxonomy-200] AUDIT ${JSON.stringify(projection.summary)}`);
  if(options.operation==='apply'){
    await applyProjection(projection);
    const verifyRows=await loadRows();
    const verify=await project(verifyRows,config);
    const productMismatch=verify.details.filter(x=>x.product_id&&x.old_product_category!==x.new_category).length;
    const accepted=verify.summary.changed===0&&verify.summary.scan_decision_drift===0&&productMismatch===0;
    const result={accepted,product_category_mismatch:productMismatch,...verify.summary};
    console.log(`[aliexpress-taxonomy-200] APPLY ${JSON.stringify(result)}`);
    if(!accepted) throw new Error(`TAXONOMY_REPAIR_INCOMPLETE:${JSON.stringify(result)}`);
    return result;
  }
  return projection.summary;
}

if(require.main===module){
  main().then(()=>process.exit(0)).catch(error=>{
    console.error(`[aliexpress-taxonomy-200] FAILED: ${error.stack||error.message||error}`);
    process.exit(1);
  }).finally(()=>db.pool.end());
}

module.exports={SUPPLIER,WAVE_ID,TARGET,FLAG,assertRuntime,parseArgs,loadRows,project,sameDistribution,assertSafeProjection,applyProjection,main};
