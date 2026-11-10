#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role g3-local-chromium-readback
 * @domain logistics
 * @layer script
 * @owner backend-core
 * @purpose Cross-check genuine relay Chromium clicks with authenticated API and PG16 readbacks on disposable DB.
 * @db-read orders, order_items, parcels, scans, order_status_history, purchase_lines, cash_collections
 * @db-write none
 * @db-txn read-only
 * @impact-areas logistics, dashboard, test-only
 */
'use strict';
const fs=require('fs');
const path=require('path');
const db=require('../../db');
const {assertEphemeralTarget}=require('./hub-v1-certification-runner');
const {snapshot,assess}=require('./staging-local-stock-real-relay-cert');
const OUT=path.resolve('test-results/g3-local-chromium');
const PLAN=path.join(OUT,'prepare.json');
const EVID=path.resolve('test-results/local-stock-native-clicks/evidence.json');
const OUTPUT=path.join(OUT,'readback.json');
const MUST_PASS=[
  'staging-sha','fixture-unique','fixture-no-hub-before',
  'agent-login-200','ui-direct-local-row-in-kanban',
  'receipt-no-request-without-physical-proof',
  'receipt-no-request-without-observation',
  'receipt-double-click-single-post','receipt-single-post-after-pickup',
  'receipt-click-http-200','receipt-db-zero-hub',
  'pickup-click-http-200','pickup-db-zero-hub',
  'no-unexpected-write','no-browser-js-error'
];

async function main(){
  assertEphemeralTarget(process.env.DATABASE_URL,[]);
  if(process.env.KOMERCE_ENV!=='test'||process.env.NODE_ENV!=='test'||
     process.env.KOMERCE_TARGET_ENV==='staging'||process.env.STAGING_BASE_URL||
     process.env.E2E_CLICKS_BASE_URL!=='http://localhost:3917')
    throw Error('G3_LOCAL_SHARED_ENV_FORBIDDEN');
  const plan=JSON.parse(fs.readFileSync(PLAN,'utf8'));
  if(plan.mode!=='EPHEMERAL_PG16_LOCALHOST_ONLY'||plan.market!=='KM'||
     plan.run!==process.env.HTTP_RUNNER_RUN8||!plan.order_id||
     plan.reference!=='E2E-HUB-V1-'+plan.run+'-LOCAL')
    throw Error('G3_LOCAL_MANIFEST_MISMATCH');
  const proof=fs.existsSync(EVID)?JSON.parse(fs.readFileSync(EVID,'utf8')):null;
  const report={schema:'g3-isolated-chromium-readback/1',
    mode:'DISPOSABLE_LOCAL_PG16',staging_go:false,
    run:plan.run,order_reference:plan.reference,order_id:plan.order_id,
    chromium_verdict:proof?.verdict||'NOT_RUN',
    ui_proof:false,api_proof:false,postgres_proof:false,external_effects_proof:false,
    verdict:'BLOCKED_NOT_PROVEN'};
  try{
    report.ui_proof=Boolean(proof&&
      proof.target_mode==='DISPOSABLE_LOCAL_PG16'&&
      proof.staging==='http://localhost:3917'&&
      proof.staging_go===false&&
      proof.market==='KM'&&proof.run8===plan.run&&
      proof.order_reference===plan.reference&&
      proof.verdict==='LOCAL_STOCK_RELAIS_LIVE_CLICK_PASS'&&
      Array.isArray(proof.checks)&&
      proof.checks.every(c=>c.verdict==='PASS')&&
      MUST_PASS.every(key=>proof.checks.some(c=>c.key===key&&c.verdict==='PASS'))&&
      !proof.blockedWrites?.length&&!proof.jsErrors?.length&&
      proof.http?.some(x=>x.status===200&&x.route==='/api/orders/:order_id/local-relay-receipt')&&
      proof.http?.some(x=>x.status===200&&x.route.includes('/collect')));
    const origin='http://localhost:3917';
    const login=await fetch(origin+'/api/auth/login',{
      method:'POST',headers:{origin,'content-type':'application/json'},
      body:JSON.stringify({email:process.env.E2E_AGENT_RELAIS_EMAIL,
        password:process.env.E2E_AGENT_RELAIS_PASSWORD})});
    const cookie=(login.headers.get('set-cookie')||'').split(';')[0];
    if(login.status!==200||!cookie)throw Error('G3_LOCAL_API_AUTH_FAIL:'+login.status);
    const api=await fetch(origin+'/api/admin/workspaces/operations/market/KM',{
      headers:{cookie,origin}});
    report.api_proof=api.status===200;
    report.api_http=api.status;
    const dbState=await snapshot(db,plan.order_id);
    const errors=assess(dbState,'collected');
    report.postgres_proof=errors.length===0&&
      String(dbState.order.relais_id)===String(plan.relay_id);
    report.sql_errors=errors;
    report.sql_status=dbState.order.status;
    const {rows:[owner]}=await db.query(
      'SELECT o.reference,o.simulation_scope,m.code AS market_code FROM orders o JOIN markets m ON m.id=o.market_id WHERE o.id=$1',
      [plan.order_id]);
    report.external_effects_proof=Boolean(owner&&
      owner.reference===plan.reference&&owner.simulation_scope==='E2E-HUB-V1'&&
      owner.market_code==='KM'&&
      Number(dbState.counts.cash_collections)===0&&
      !dbState.order.stripe_payment_id&&!dbState.order.cash_paid_at&&
      Number(dbState.counts.shipping_history)===0&&
      Number(dbState.counts.shipped_scan_events)===0);
    report.verdict=report.ui_proof&&report.api_proof&&report.postgres_proof&&
      report.external_effects_proof?'PASS_G3_ISOLATED_CHROMIUM_HTTP_PG16':'BLOCKED_NOT_PROVEN';
  }catch(e){report.error_code=String(e.message).slice(0,200);}
  finally{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(OUTPUT,JSON.stringify(report,null,2)+'\n');}
  console.log(JSON.stringify({verdict:report.verdict,chromium:report.ui_proof,
    api:report.api_proof,postgres:report.postgres_proof,external:report.external_effects_proof}));
  if(report.verdict!=='PASS_G3_ISOLATED_CHROMIUM_HTTP_PG16')process.exitCode=2;
}
main().catch(e=>{console.error('G3_LOCAL_READBACK_REFUSED:'+String(e.message).slice(0,180));process.exitCode=2;})
  .finally(()=>db.pool?.end?.());
