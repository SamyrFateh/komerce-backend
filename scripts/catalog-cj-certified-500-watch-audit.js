#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          catalog-cj-certified-500-watch-audit
 * @domain        catalog
 * @layer         tooling
 * @criticality   medium
 * @inputs        certified CJ 500 snapshot + isolated E2E database
 * @outputs       read-only grouped diagnosis for historical CJ rows now classified WATCH
 * @depends       db.js, scripts/catalog-cj-certified-500-materialize.js, services/suppliers/e2e-isolated-runtime.js
 * @used-by       ali-e2e-200-worker catalog-712-watch-audit mode
 * @db-read       sourcing_candidates
 * @db-write      none
 * @db-txn        none
 * @doctrine      read_only_diagnosis, no_provider_calls, current_refinery_truth
 * @impact-areas  catalog, sourcing, staging-e2e
 * @version       2026-09-v1
 */
'use strict';

const db = require('../db');
const { decodeCertifiedIds } = require('./catalog-cj-certified-500-materialize');
const e2eRuntime = require('../services/suppliers/e2e-isolated-runtime');

const SUPPLIER='CJdropshipping';

function bump(map,key){
  const k=String(key==null||key===''?'<missing>':key);
  map[k]=(map[k]||0)+1;
}
async function run(env=process.env){
  const runtime=e2eRuntime.assertIsolatedE2eRuntime(env);
  const ids=decodeCertifiedIds(env);
  const {rows}=await db.query(
    `SELECT supplier_product_id,
            UPPER(COALESCE(scan_result->>'sourcing_decision','UNKNOWN')) AS decision,
            scan_result->>'reason' AS reason,
            scan_result->>'recommended_action' AS recommended_action,
            komerce_category,
            raw_payload #>> '{discovery,target_category}' AS target_category,
            raw_payload #>> '{discovery,target_subcategory}' AS target_subcategory
       FROM sourcing_candidates
      WHERE supplier_name=$1
        AND supplier_product_id = ANY($2::text[])
      ORDER BY supplier_product_id`,
    [SUPPLIER,ids]
  );
  const historical=new Set(ids);
  const scoped=rows.filter(r=>historical.has(String(r.supplier_product_id)));
  const watch=scoped.filter(r=>r.decision==='WATCH');
  const reasonCounts={}, actionCounts={}, categories={}, targets={}, missingTargets={};
  for(const row of watch){
    bump(reasonCounts,row.reason);
    bump(actionCounts,row.recommended_action);
    bump(categories,row.komerce_category);
    bump(targets,`${row.target_category||'<missing>'} / ${row.target_subcategory||'<missing>'}`);
    if(!row.target_category||!row.target_subcategory) bump(missingTargets,'missing_boutique_target');
  }
  const summary={
    runtime,
    expected:ids.length,
    present:scoped.length,
    watch:watch.length,
    decisions:scoped.reduce((m,r)=>(bump(m,r.decision),m),{}),
    reasons:reasonCounts,
    recommended_actions:actionCounts,
    komerce_categories:categories,
    boutique_targets:targets,
    missing_targets:missingTargets,
    samples:watch.slice(0,50),
    provider_api_calls:0,
  };
  console.log(`[catalog-712-watch-audit] ${JSON.stringify(summary)}`);
  return summary;
}
if(require.main===module){
  run().then(()=>process.exit(0)).catch(e=>{console.error(`[catalog-712-watch-audit] FAILED: ${e.stack||e.message||e}`);process.exit(1);}).finally(()=>db.pool.end());
}
module.exports={run};
