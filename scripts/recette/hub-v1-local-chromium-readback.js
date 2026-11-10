#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role hub-v1-local-chromium-readback
 * @domain logistics
 * @layer script
 * @owner backend-core
 * @purpose Independent HTTP + PostgreSQL proof of real supplier-receipt Chromium clicks on disposable PG16.
 * @db-read orders, purchase_lines, v_purchase_line_progress, cash_collections, supplier_execution_payments
 * @db-write none
 * @impact-areas logistics, dashboard, test-only
 */
'use strict';
const fs=require('fs');
const path=require('path');
const db=require('../../db');
const {assertEphemeralTarget}=require('./hub-v1-certification-runner');
const ROOT=path.resolve('test-results/hub-v1-local-chromium');
const PLAN=path.join(ROOT,'prepare.json');
const EVID=path.resolve('test-results/hub-v1-clicks/evidence.json');
const OUTPUT=path.join(ROOT,'receipt-readback.json');

async function main(){
  assertEphemeralTarget(process.env.DATABASE_URL,[]);
  const origin=new URL(String(process.env.E2E_CLICKS_BASE_URL||'')).origin;
  if(!/^http:\/\/localhost:\d+$/.test(origin))throw Error('HUB_LOCAL_CHROMIUM_LOCALHOST_ONLY');
  const plan=JSON.parse(fs.readFileSync(PLAN,'utf8'));
  if(plan.admin_dashboard_global_grant!==true)throw Error('HUB_LOCAL_CHROMIUM_ADMIN_AUTHORITY_NOT_SEEDED');
  if(plan.mode!=='EPHEMERAL_PG16_LOCALHOST_ONLY'||plan.run!==process.env.E2E_PROOF_RUN8||
     plan.pos.length!==2||plan.orders.length!==4)throw Error('HUB_LOCAL_CHROMIUM_MANIFEST_MISMATCH');
  const evidence=fs.existsSync(EVID)?JSON.parse(fs.readFileSync(EVID,'utf8')):null;
  const clicks=(evidence?.gestures||[]).filter(x=>x.key?.startsWith('hub:receive:'));
  const report={schema:'hub-v1-local-chromium-receipt-readback/1',
    scope:'LOCAL_DISPOSABLE_PG16_ONLY',staging_go:false,run:plan.run,orders:plan.orders,
    po_checks:[],clicks:clicks.map(x=>({key:x.key,role:x.role,verdict:x.verdict,http:x.http})),
    chromium_verdict:evidence?.verdict||'NOT_RUN',api_readback:false,sql_readback:false,
    external_effects_verified:false,admin_dashboard_authority_verified:false,verdict:'BLOCKED_NOT_PROVEN'};
  try{
    const login=await fetch(origin+'/api/auth/login',{method:'POST',
      headers:{origin,'content-type':'application/json'},
      body:JSON.stringify({email:process.env.E2E_AGENT_HUB_EMAIL,password:process.env.E2E_AGENT_HUB_PASSWORD})});
    const cookie=(login.headers.get('set-cookie')||'').split(';')[0];
    if(login.status!==200||!cookie)throw Error('HUB_LOCAL_CHROMIUM_API_LOGIN_FAILED:'+login.status);
    for(const id of plan.pos){
      const api=await fetch(origin+'/api/purchasing/po/'+id,{headers:{cookie}});
      const sql="SELECT po.id::text AS id, po.status::text AS status, " +
        "COALESCE(SUM(COALESCE(progress.received_quantity,0)),0)::int AS received " +
        "FROM purchase_orders po JOIN purchase_lines pl ON pl.purchase_order_id=po.id " +
        "LEFT JOIN v_purchase_line_progress progress ON progress.line_id=pl.id " +
        "WHERE po.id=$1 GROUP BY po.id,po.status";
      const {rows:[pg]}=await db.query(sql,[id]);
      report.po_checks.push({po_id:id,api_http:api.status,sql_status:pg?.status||null,
        sql_received_quantity:pg?.received??null});
    }
    report.api_readback=report.po_checks.length===2&&report.po_checks.every(x=>x.api_http===200);
    report.sql_readback=report.po_checks.length===2&&report.po_checks.every(x=>x.sql_received_quantity>0);
    const {rows:[integrity]}=await db.query(
      "SELECT (SELECT COUNT(*)::int FROM orders WHERE reference=ANY($1::text[])) AS orders, " +
      "(SELECT COUNT(*)::int FROM cash_collections WHERE order_id IN (SELECT id FROM orders WHERE reference=ANY($1::text[]))) AS cash_events, " +
      "(SELECT COUNT(*)::int FROM supplier_execution_payments) AS supplier_payments",
      [plan.orders]);
    report.integrity=integrity;
    report.external_effects_verified=integrity.orders===4&&integrity.cash_events===0&&integrity.supplier_payments===0;
    // Verify the real dashboard authority through the live localhost API,
    // not from the users.role='admin' label or an invented UI permission.
    const adminLogin=await fetch(origin+'/api/auth/login',{method:'POST',
      headers:{origin,'content-type':'application/json'},
      body:JSON.stringify({email:process.env.E2E_ADMIN_EMAIL,password:process.env.E2E_ADMIN_PASSWORD})});
    const adminCookie=(adminLogin.headers.get('set-cookie')||'').split(';')[0];
    if(adminLogin.status!==200||!adminCookie)throw Error('HUB_LOCAL_CHROMIUM_ADMIN_API_LOGIN_FAILED:'+adminLogin.status);
    const dashboard=await fetch(origin+'/api/admin/dashboard/context',{headers:{cookie:adminCookie}});
    const context=await dashboard.json().catch(()=>({}));
    report.admin_dashboard_authority={
      http:dashboard.status,mode:context?.access?.mode||null,
      market_KM_allowed:Array.isArray(context?.access?.allowedMarkets)&&context.access.allowedMarkets.includes('KM')};
    report.admin_dashboard_authority_verified=dashboard.status===200&&
      report.admin_dashboard_authority.mode==='global'&&report.admin_dashboard_authority.market_KM_allowed===true;
    const gesturesProven=clicks.length===2&&clicks.every(x=>x.verdict==='CLICK_PASS'&&x.http>=200&&x.http<300);
    report.verdict=gesturesProven&&report.api_readback&&report.sql_readback&&report.external_effects_verified&&report.admin_dashboard_authority_verified
      ?'PASS_LOCAL_CHROMIUM_HTTP_PG_RECEIPT_ONLY':'BLOCKED_NOT_PROVEN';
  }catch(error){report.error_code=String(error.message).slice(0,180);}
  finally{fs.mkdirSync(ROOT,{recursive:true});fs.writeFileSync(OUTPUT,JSON.stringify(report,null,2)+'\n');}
  console.log(JSON.stringify({verdict:report.verdict,api_readback:report.api_readback,sql_readback:report.sql_readback,
    external_effects_verified:report.external_effects_verified,clicks:report.clicks.length}));
  if(report.verdict!=='PASS_LOCAL_CHROMIUM_HTTP_PG_RECEIPT_ONLY')process.exitCode=2;
}
main().catch(e=>{console.error('HUB_LOCAL_CHROMIUM_READBACK_REFUSED:'+String(e.message).slice(0,150));process.exitCode=2})
  .finally(()=>db.pool?.end?.());
