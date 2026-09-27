#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          catalog-712-production-exclusion-audit
 * @domain        catalog
 * @layer         tooling
 * @criticality   medium
 * @inputs        isolated source DATABASE_URL + KOMERCE_CATALOG_DEST_DATABASE_URL
 * @outputs       read-only diagnosis of destination EXCLUDED identities from certified 712 set
 * @depends       db.js, pg, scripts/catalog-e2e-712-identities.js
 * @used-by       ali-e2e-200-worker catalog-712-production-exclusion-audit mode
 * @db-read       source:sourcing_candidates; destination:sourcing_candidates
 * @db-write      none
 * @db-txn        none
 * @doctrine      read_only_cross_db_diagnosis, no_provider_calls
 * @impact-areas  catalog, sourcing, production-catalog
 * @version       2026-09-v1
 */
'use strict';

const {Pool}=require('pg');
const db=require('../db');
const {buildExpectedCjIds,TOTAL_TARGET}=require('./catalog-e2e-712-identities');

const DEST_ENV='KOMERCE_CATALOG_DEST_DATABASE_URL';
const ALI_WAVE='incremental-e2e-200-v1';

function hostOf(url){try{return new URL(String(url||'')).hostname.toLowerCase()}catch{return null}}
function assertRuntime(env=process.env){
  const source=hostOf(env.DATABASE_URL);
  const dest=hostOf(env[DEST_ENV]);
  if(!source||!/ali-e2e-200-postgres/i.test(source)) throw new Error('SOURCE_DB_NOT_ISOLATED');
  if(!dest||/ali-e2e-200-postgres/i.test(dest)) throw new Error('DEST_DB_INVALID');
  return {source_host:source,dest_host:dest};
}
async function expectedIdentities(env=process.env){
  const expectedCj=buildExpectedCjIds(env);
  const {rows}=await db.query(
    `SELECT supplier_name,supplier_product_id
       FROM sourcing_candidates
      WHERE (
        supplier_name='AliExpress'
        AND raw_payload #>> '{discovery,wave}'=$1
        AND state='imported_to_catalog'
      ) OR (
        supplier_name='CJdropshipping'
        AND state='imported_to_catalog'
        AND supplier_product_id=ANY($2::text[])
      )
      ORDER BY supplier_name,supplier_product_id`,
    [ALI_WAVE,expectedCj.all]
  );
  const keys=rows.map(r=>`${r.supplier_name}\u0000${r.supplier_product_id}`);
  if(rows.length!==TOTAL_TARGET||new Set(keys).size!==TOTAL_TARGET) throw new Error(`SOURCE_712_IDENTITIES_INVALID:${rows.length}/${new Set(keys).size}`);
  return rows;
}
async function run(env=process.env){
  const runtime=assertRuntime(env);
  const expected=await expectedIdentities(env);
  const bySupplier=new Map();
  for(const row of expected){
    if(!bySupplier.has(row.supplier_name)) bySupplier.set(row.supplier_name,[]);
    bySupplier.get(row.supplier_name).push(String(row.supplier_product_id));
  }
  const pool=new Pool({connectionString:env[DEST_ENV]});
  try{
    const excluded=[];
    for(const [supplier,ids] of bySupplier){
      // eslint-disable-next-line no-await-in-loop
      const {rows}=await pool.query(
        `SELECT supplier_name,supplier_product_id,product_name,supplier_category,
                komerce_category,state,rejected_reason,
                scan_result->>'sourcing_decision' AS decision,
                scan_result->'eligibility' AS eligibility,
                raw_payload #>> '{discovery,target_category}' AS target_category,
                raw_payload #>> '{discovery,target_subcategory}' AS target_subcategory
           FROM sourcing_candidates
          WHERE supplier_name=$1
            AND supplier_product_id=ANY($2::text[])
            AND (
              state='rejected'
              OR UPPER(COALESCE(scan_result->>'sourcing_decision',''))='EXCLUDED'
            )
          ORDER BY supplier_product_id`,
        [supplier,ids]
      );
      excluded.push(...rows);
    }
    const reasonCounts={};
    const evidenceCounts={};
    for(const row of excluded){
      const reason=String(row.rejected_reason||'<missing>');
      reasonCounts[reason]=(reasonCounts[reason]||0)+1;
      const match=row.eligibility?.match;
      const evidence=match?`${match.type}:${match.value}`:'<missing>';
      evidenceCounts[evidence]=(evidenceCounts[evidence]||0)+1;
    }
    const summary={
      runtime,
      expected:expected.length,
      excluded:excluded.length,
      reason_counts:reasonCounts,
      evidence_counts:evidenceCounts,
      rows:excluded,
      provider_api_calls:0,
      writes:false,
    };
    console.log(`[catalog-712-production-exclusion-audit] ${JSON.stringify(summary)}`);
    return summary;
  }finally{
    await pool.end();
  }
}
if(require.main===module){
  run().then(()=>process.exit(0)).catch(e=>{
    console.error(`[catalog-712-production-exclusion-audit] FAILED: ${e.stack||e.message||e}`);
    process.exit(1);
  }).finally(()=>db.pool.end());
}
module.exports={DEST_ENV,ALI_WAVE,assertRuntime,expectedIdentities,run};
