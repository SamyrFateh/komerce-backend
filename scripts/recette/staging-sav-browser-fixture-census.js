#!/usr/bin/env node
'use strict';
/**
 * @komerce-arch
 * @role staging-sav-browser-fixture-census
 * @domain logistics
 * @layer tooling
 * @criticality medium
 * @inputs staging target + dedicated E2E agent email
 * @outputs sanitized counts for an existing E2E physical-return browser candidate
 * @db-read users,relais,orders,order_items,disputes,relay_product_return_receipts
 * @db-write none
 * @db-txn BEGIN READ ONLY; ROLLBACK
 * @doctrine no_customer_data_no_side_effects, real_staging_only
 */
const fs=require('fs');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const BASE='https://komerce-backend-production.up.railway.app';
const OUT='test-results/staging-sav-browser/readonly-census.json';
function check(env){
 if(env.KOMERCE_ENV!=='staging'||env.KOMERCE_TARGET_ENV!=='staging'||env.NODE_ENV!=='test'||
    env.KOMERCE_DISABLE_CRONS!=='true'||env.EXPECTED_RAILWAY_ENVIRONMENT!=='staging'||
    env.STAGING_BASE_URL!==BASE)throw Error('STAGING_ONLY');
 if(!env.E2E_AGENT_RELAIS_EMAIL)throw Error('E2E_RELAY_EMAIL_REQUIRED');
 if(env.SAV_CENSUS_CONFIRMATION!=='SAV-READ-ONLY')throw Error('READ_ONLY_CONFIRMATION_REQUIRED');
}
async function census({env=process.env,executor=db,fetchImpl=fetch}={}){
 check(env);
 const target=await confirmTarget({db:executor,fetchImpl,env});
 if(!target.confirmed)throw Error('TARGET_FINGERPRINT_MISMATCH');
 const version=await (await fetchImpl(BASE+'/health/version')).json();
 if(!/^[a-f0-9]{40}$/i.test(String(version.commit||'')))throw Error('RUNTIME_SHA_MISSING');
 const c=await executor.getClient();
 try{
  await c.query('BEGIN READ ONLY');
  const agent=(await c.query("SELECT id,relais_id FROM users WHERE lower(email)=lower($1) AND role::text='agent_relais'",[env.E2E_AGENT_RELAIS_EMAIL])).rows[0];
  if(!agent?.relais_id)throw Error('E2E_RELAY_NOT_ASSIGNED');
  const counts=(await c.query(`
    WITH e2e_lines AS (
      SELECT o.id AS order_id,oi.id AS order_item_id,oi.qty_collected,o.reference
        FROM orders o JOIN order_items oi ON oi.order_id=o.id
       WHERE o.relais_id=$1 AND o.simulation_scope IS NULL
         AND o.reference LIKE 'E2E-HUB-V1-%'
         AND oi.qty_collected>0
    ), pending AS (
      SELECT d.id FROM disputes d
      JOIN e2e_lines l ON l.order_item_id=d.return_order_item_id
      LEFT JOIN relay_product_return_receipts r ON r.request_id=d.id
      WHERE d.type='product_return' AND d.status IN ('open','processing')
        AND r.id IS NULL AND d.return_quantity BETWEEN 1 AND l.qty_collected
    ), eligible_lines AS (
      SELECT l.order_item_id FROM e2e_lines l
       WHERE NOT EXISTS(
         SELECT 1 FROM disputes d WHERE d.return_order_item_id=l.order_item_id
           AND d.type='product_return' AND d.status<>'closed'
       )
    )
    SELECT (SELECT COUNT(*)::int FROM e2e_lines) AS e2e_collected_lines,
           (SELECT COUNT(*)::int FROM pending) AS existing_pending_return_requests,
           (SELECT COUNT(*)::int FROM eligible_lines) AS potential_new_return_requests
  `,[agent.relais_id])).rows[0];
  return {schema:'sav-browser-fixture-census/1',environment:'staging',
    runtime_sha:version.commit,agent_role:'agent_relais',
    fixture_scope:'E2E-HUB-V1-%', counts,
    verdict:counts.existing_pending_return_requests>0?'EXISTING_RETURN_READY':
      counts.potential_new_return_requests>0?'EXISTING_COLLECTED_ORDER_ONLY':'NO_SAFE_E2E_FIXTURE',
    persistent_writes:0};
 }finally{await c.query('ROLLBACK').catch(()=>{});c.release();}
}
async function main(){
 let report;
 try{report=await census();}
 catch(e){report={schema:'sav-browser-fixture-census/1',verdict:'FAIL_CLOSED',reason:String(e.code||e.message).slice(0,130),persistent_writes:0};process.exitCode=1;}
 finally{
  fs.mkdirSync('test-results/staging-sav-browser',{recursive:true});
  fs.writeFileSync(OUT,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
  if(db.pool?.end)await db.pool.end();
 }
}
if(require.main===module)main();
module.exports={check,census};
