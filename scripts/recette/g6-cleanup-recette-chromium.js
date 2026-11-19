#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role g6-cleanup-recette-chromium
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose Inventory (plan, read-only PG) then clean leftover G6-BUYER orders through real admin screens (apply).
 * @impact-areas orders, purchasing, staging-only
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {observe,fullError,startTraceAfterAuth}=require('./canonical/observability');
const {humanClick,humanFill,humanGoto}=require('./canonical/actors/human-gestures');
const {CadenceGate}=require('./canonical/cadence');
const {SCOPE,buildPlan,classify,assertGestureAllowed}=require('./canonical/g6-cleanup-core');
const env=process.env;
const ORIGIN='https://komerce-backend-production.up.railway.app';
const OUT=path.resolve('test-results/g6-cleanup-recette');
const SHA=/^[a-f0-9]{40}$/i;
const check=(ok,code)=>{if(!ok)throw Error(code);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// Lecture seule : aucune écriture SQL dans ce fichier (chromium-policy).
async function inventory(){
 const c=await db.getClient();
 try{
  await c.query('BEGIN READ ONLY');
  const {rows:orders}=await c.query(
   `SELECT o.id,o.reference,o.status::text AS status,o.payment_mode::text AS payment_mode,
           o.simulation_scope,m.code AS market
      FROM orders o LEFT JOIN markets m ON m.id=o.market_id
     WHERE o.simulation_scope=$1 AND o.status::text NOT IN ('collected','cancelled')
     ORDER BY m.code,o.reference`,[SCOPE]);
  const ids=orders.map(o=>o.id);
  const {rows:lines}=ids.length?await c.query(
   `SELECT oi.order_id,pl.id AS line_id,pl.purchase_order_id AS po_id,po.status::text AS po_status
      FROM purchase_lines pl JOIN order_items oi ON oi.id=pl.order_item_id
      LEFT JOIN purchase_orders po ON po.id=pl.purchase_order_id
     WHERE oi.order_id=ANY($1::uuid[]) AND pl.cancelled_at IS NULL ORDER BY pl.id`,[ids]):{rows:[]};
  const poIds=[...new Set(lines.map(l=>l.po_id).filter(Boolean))];
  const {rows:peers}=poIds.length?await c.query(
   `SELECT DISTINCT pl.purchase_order_id AS po_id,o.reference,o.simulation_scope
      FROM purchase_lines pl JOIN order_items oi ON oi.id=pl.order_item_id JOIN orders o ON o.id=oi.order_id
     WHERE pl.purchase_order_id=ANY($1::uuid[]) AND pl.cancelled_at IS NULL`,[poIds]):{rows:[]};
  const {rows:[rule]}=await c.query("SELECT value FROM business_rules WHERE key='CANCEL_CUTOFF_STATUS' AND is_active=TRUE");
  await c.query('COMMIT');
  const po_peers={};
  for(const p of peers)(po_peers[p.po_id]=po_peers[p.po_id]||[]).push({reference:p.reference,simulation_scope:p.simulation_scope});
  let cutoff='shipped';
  if(rule&&rule.value!=null){try{cutoff=String(JSON.parse(rule.value));}catch(_){cutoff=String(rule.value);}}
  const entries=orders.map(o=>({order:o,po_peers,
   lines:lines.filter(l=>l.order_id===o.id).map(l=>({line_id:l.line_id,po_id:l.po_id,po_status:l.po_status}))}));
  return {entries,cutoff};
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}
 finally{c.release();}
}
async function readState(step){
 const q=(s,p)=>db.query(s,p).then(r=>r.rows[0]||null);
 if(step.action==='discard_po')return (await q('SELECT status::text AS s FROM purchase_orders WHERE id=$1',[step.po_id]))?.s;
 if(step.action==='cancel_line')return (await q('SELECT cancelled_at IS NOT NULL AS s FROM purchase_lines WHERE id=$1',[step.line_id]))?.s;
 return (await q('SELECT status::text AS s FROM orders WHERE id=$1 AND simulation_scope=$2',[step.order_id,SCOPE]))?.s;
}
const EXPECTED={discard_po:'cancelled',cancel_line:true,cancel_order:'cancelled'};
const summarize=plan=>plan.items.map(i=>({reference:i.reference,market:i.market,class:i.class,order_status:i.order_status,
 verdict:i.verdict,reason:i.reason,po_ids:i.po_ids,commandes_du_po:i.po_peers,
 gestes:i.gestures.map(g=>g.action),residual:i.residual||null}));

async function login(browser,steps){
 const email=env.E2E_ADMIN_EMAIL,password=env.E2E_ADMIN_PASSWORD;
 check(email&&password,'G6_CLEANUP_ADMIN_IDENTITY_MISSING');
 const allowed=new Set(['/api/auth/login']);
 for(const s of steps){
  if(s.action==='discard_po')allowed.add('/api/purchasing/po/'+s.po_id+'/discard');
  if(s.action==='cancel_line')allowed.add('/api/purchasing/lines/'+s.line_id+'/cancel');
  if(s.action==='cancel_order')allowed.add('/api/orders/'+s.order_id+'/cancel');
 }
 const ctx=await browser.newContext({viewport:{width:1440,height:900},baseURL:ORIGIN});
 const page=await ctx.newPage(),blocked=[],state={limited:false,dialogReason:null,confirmed:0};
 page.on('dialog',d=>{
  if(d.type()==='prompt')return d.accept(state.dialogReason||'');
  state.confirmed++;return d.accept();
 });
 page.on('response',r=>{if(r.status()===429)state.limited=true;});
 await page.route('**/*',route=>{
  const req=route.request(),url=new URL(req.url());
  if(['GET','HEAD','OPTIONS'].includes(req.method()))return route.continue();
  if(url.origin===ORIGIN&&req.method()==='POST'&&allowed.has(url.pathname))return route.continue();
  blocked.push({method:req.method(),path:url.pathname});
  return route.abort('blockedbyclient');
 });
 await humanGoto(page,'/login.html?next='+encodeURIComponent('/admin/orders'));
 await humanFill(null,page.locator('#email'),email);
 await humanFill(null,page.locator('#password'),password);
 const promise=page.waitForResponse(x=>new URL(x.url()).pathname==='/api/auth/login'&&x.request().method()==='POST');
 await humanClick(null,page.locator('#btn-submit'));
 const auth=await promise;
 check(auth.status()===200,'G6_CLEANUP_LOGIN_'+auth.status());
 await page.waitForURL(x=>x.pathname!=='/login.html',{timeout:15000});
 const me=await page.request.get('/api/auth/me');
 check(me.status()===200&&(await me.json()).role==='admin','G6_CLEANUP_ROLE_ADMIN');
 await startTraceAfterAuth(ctx);
 return {ctx,page,blocked,state};
}
async function perform(actor,step){
 const {page,state}=actor,reason='Nettoyage recette G6 · '+step.reference;
 if(step.action==='discard_po'){
  await humanGoto(page,'/admin/workspaces/purchasing',{waitUntil:'domcontentloaded'});
  await humanFill(null,page.locator('input.kmc-purchasing-list-search').first(),step.po_id);
  await humanClick(null,page.locator('button.kmc-purchasing-po-link').first());
  const btn=page.locator('[data-purchasing-po="'+step.po_id+'"] [data-workspace-action="discard-po"]');
  await btn.waitFor({state:'visible',timeout:20000});
  return humanClick(null,btn,{mutation:{path:'/api/purchasing/po/'+step.po_id+'/discard'}});
 }
 if(step.action==='cancel_line'){
  await humanGoto(page,'/admin/workspaces/purchasing',{waitUntil:'domcontentloaded'});
  const btn=page.locator('[data-purchasing-line="'+step.line_id+'"] [data-workspace-action="cancel-line"]');
  await btn.waitFor({state:'visible',timeout:20000});
  state.dialogReason=reason;
  return humanClick(null,btn,{mutation:{path:'/api/purchasing/lines/'+step.line_id+'/cancel'}});
 }
 await humanGoto(page,'/admin/orders/'+encodeURIComponent(step.reference),{waitUntil:'domcontentloaded'});
 const btn=page.getByRole('button',{name:'Annuler la commande de recette'});
 await btn.waitFor({state:'visible',timeout:20000});
 const r=await humanClick(null,btn,{mutation:{path:'/api/orders/'+step.order_id+'/cancel',statuses:[200,202]}});
 await page.getByText('Commande de recette '+step.reference+' annulée.').waitFor({timeout:20000});
 return r;
}
async function main(){
 fs.mkdirSync(OUT,{recursive:true});
 const mode=env.G6_CLEANUP_MODE==='apply'?'apply':'plan';
 const report={schema:'komerce-g6-cleanup-recette/1',mode,verdict:'NOT_PROVEN',db_writes:0,external_calls:0,steps:[]};
 const save=()=>fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n');
 save();let browser,OBS=null;
 try{
  check(env.GITHUB_EVENT_NAME==='issues'&&env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&
   env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&env.NODE_ENV==='test'&&env.KOMERCE_ENV==='staging'&&
   env.KOMERCE_TARGET_ENV==='staging'&&SHA.test(env.E2E_EXPECTED_DEPLOY_SHA||'')&&
   env.STAGING_BASE_URL===ORIGIN&&!!env.DATABASE_URL,'G6_CLEANUP_OWNER_STAGING_GUARD');
  const target=await confirmTarget({db,env});
  check(target.confirmed,'G6_CLEANUP_DATABASE_IDENTITY_DRIFT');
  report.db_fingerprint=target.fingerprint;
  const {entries,cutoff}=await inventory();
  const plan=buildPlan(entries,{cutoff});
  report.cutoff=cutoff;report.before=summarize(plan);report.planned_steps=plan.steps.length;save();
  if(mode==='plan'){report.verdict='PLAN_READY_NO_WRITE';save();return;}
  browser=await require('playwright').chromium.launch({headless:true});OBS=observe(browser,OUT);
  const actor=await login(browser,plan.steps);
  const gate=new CadenceGate(),failed=new Set();let stopped=false;
  try{
   for(const step of plan.steps){
    if(failed.has(step.reference)){report.steps.push({...step,result:'SKIPPED_PREVIOUS_FAILURE'});continue;}
    assertGestureAllowed(step,plan);
    for(;;){try{gate.reserve('order');break;}catch(_){await sleep(1000);}}
    const rec={action:step.action,reference:step.reference,class:step.class,po_id:step.po_id||null,line_id:step.line_id||null};
    try{
     const r=await perform(actor,step);
     gate.assertResponse(actor.state.limited?429:200);
     rec.proof=r.response;rec.readback=await readState(step);
     rec.result=rec.readback===EXPECTED[step.action]?'DONE':'READBACK_MISMATCH';
     if(rec.result!=='DONE')failed.add(step.reference);
    }catch(e){
     rec.result=actor.state.limited||/429/.test(String(e.message))?'NOT_PROVEN_429':(e.verdict==='BLOCKED'?'BLOCKED':'FAILED');
     rec.error=fullError(e);failed.add(step.reference);
     if(rec.result==='NOT_PROVEN_429')stopped=true;
    }
    report.steps.push(rec);save();
    if(stopped)break;
   }
  }finally{report.blocked_requests=actor.blocked.length;await actor.ctx.close().catch(()=>{});}
  const after=buildPlan((await inventory()).entries,{cutoff});
  report.remaining=after.items.filter(i=>i.verdict!=='SKIPPED').map(i=>({reference:i.reference,market:i.market,class:i.class,
   order_status:i.order_status,verdict:i.verdict,reason:i.reason||i.residual||'ENCORE_OUVERTE_APRES_GESTES'}));
  report.remaining_count=report.remaining.length;
  report.verdict=stopped?'NOT_PROVEN_429':(report.steps.every(x=>x.result==='DONE')?'G6_CLEANUP_APPLIED':'G6_CLEANUP_PARTIAL');
  save();
 }catch(e){report.error=fullError(e);report.verdict=/429/.test(String(e.message))?'NOT_PROVEN_429':'BLOCKED';save();process.exitCode=2;}
 finally{if(OBS)await OBS.finish(!!process.exitCode).catch(()=>{});if(browser)await browser.close().catch(()=>{});await db.pool.end().catch(()=>{});console.log(JSON.stringify({mode:report.mode,verdict:report.verdict,planned:report.planned_steps,remaining:report.remaining_count}));}
}
if(require.main===module)main();
module.exports={inventory,classify};
