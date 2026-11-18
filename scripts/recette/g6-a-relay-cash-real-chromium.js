#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role          g6-a-relay-ui-assignment-and-cash-staging
 * @domain        logistics
 * @layer         test
 * @owner         backend-core
 * @purpose       Isolated staging G6-A relay identities, real Chromium market-network assignment and cash collection.
 * @db-read       users, markets, orders, relais, cash_collections, cash_confirmation_controls, assignment_capability_ceiling
 * @db-write      only E2E users/marker/membership by canonical fixture writers; payment via live Chromium UI
 * @impact-areas  logistics, checkout, payment, market-delegation
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const bcrypt=require('bcryptjs'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {createAdminUser}=require('../../services/user-mutation-service');
const {markE2eTestAccount,ensureRelayAgentMembership}=require('./staging-e2e-provision');
const delegation=require('../../services/market-delegation-service');
const {projectAssignment}=require('../../services/market-scope-projector');
const BASE='https://komerce-backend-production.up.railway.app';
const REFS=Object.freeze(require('./g6-canonical-journey-binding').resolveRelayCashRefs(process.env));
const OUT=path.resolve('test-results/g6-a-relay-cash');
const {observe,fullError}=require("./canonical/observability");let OBS=null;
const {startTraceAfterAuth}=require('./canonical/observability');
const {humanClick,humanFill,humanSelect,humanCheck,humanPress}=require('./canonical/actors/human-gestures');
const report={run_id:process.env.GITHUB_RUN_ID||null,verdict:'NOT_PROVEN',
  staging_only:true,real_external_payment:false,orders:[],steps:[],business_transition_via:'Chromium_UI_only'};
let browser=null;
fs.mkdirSync(OUT,{recursive:true});
const save=()=>fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n');
const check=(yes,code)=>{if(!yes)throw Error(code);};
const step=(name,data)=>{report.steps.push({name,...data});save();};
async function sha(){
  const r=await fetch(BASE+'/health/version');
  check(r.status===200,'STAGING_VERSION_HTTP_'+r.status);
  const v=await r.json();
  check(/^[a-f0-9]{40}$/.test(v.commit||''),'STAGING_SHA_INVALID');
  check(v.commit===process.env.E2E_EXPECTED_DEPLOY_SHA,'SHA_DEPLOY_DRIFT');
  return v.commit;
}
async function orderRows(){
  return (await db.query(
    "SELECT o.id,o.reference,o.user_id,o.relais_id,o.status::text AS status,o.payment_status::text AS payment_status, "+
    "o.payment_mode::text AS payment_mode,o.simulation_scope,m.code AS market,r.name AS relay_name,r.is_active AS relay_active, "+
    "(SELECT COUNT(*)::int FROM cash_collections cc WHERE cc.order_id=o.id) AS cash_count, "+
    "(SELECT COUNT(*)::int FROM cash_confirmation_controls ccc WHERE ccc.order_id=o.id AND ccc.state='CONFIRMED') AS control_count "+
    "FROM orders o JOIN markets m ON m.id=o.market_id LEFT JOIN relais r ON r.id=o.relais_id "+
    "WHERE o.reference=ANY($1::text[]) ORDER BY m.code",
    [Object.values(REFS)])).rows;
}
async function prepare(){
  const rows=await orderRows();
  check(rows.length===Object.keys(REFS).length,'G6_A_EXACT_TARGET_ORDERS_REQUIRED');
  const byMarket=Object.fromEntries(rows.map(r=>[r.market,r]));
  for(const code of Object.keys(REFS)){
    const o=byMarket[code];
    check(o && o.reference===REFS[code],'G6_A_MARKET_ORDER_MISMATCH_'+code);
    check(o.simulation_scope==='G6-BUYER' && o.payment_mode==='cash_relais','G6_A_NOT_OWNED_CASH_FIXTURE_'+code);
    check(o.status==='pending' && o.payment_status==='pending','G6_A_ORDER_NO_LONGER_PENDING_'+code);
    check(o.relais_id && o.relay_active===true,'G6_A_RELAY_NOT_ACTIVE_'+code);
    check(o.cash_count===0 && o.control_count===0,'G6_A_CASH_ALREADY_RECORDED_'+code);
  }
  const a=(await db.query(
    "SELECT id FROM users WHERE lower(email)=lower($1) AND role::text='admin'",
    [process.env.E2E_ADMIN_EMAIL])).rows;
  check(a.length===1,'E2E_ADMIN_NOT_PROVEN');
  step('PRECHECK_TARGET_CASH_ORDERS',{markets:Object.keys(REFS),references:REFS,pending:true,marked:true});
  // Isolated E2E identities/memberships only, using the same official
  // provisioning writers as staging-e2e-provision. No business-state writes.
  const run8=crypto.randomBytes(4).toString('hex');
  const users={};
  const client=await db.getClient();let tx=false;
  try {
    await client.query('BEGIN');tx=true;
    // Give one fresh, marked G6-A operator only network.read/update on these markets.
    // Unlike central admin, the market network GET route requires a real membership.
    // Projection is maintained by its canonical owner; no operator_market_scopes SQL.
    const opPassword=crypto.randomBytes(24).toString('base64url')+'Aa1!';
    const opEmail='g6-a-network-'+run8+'@komerce.test';
    const opCreated=await createAdminUser(client,{
      fullName:'G6-A Network '+run8,email:opEmail,role:'market_operator',currencyPref:'KMF',
      passwordHash:await bcrypt.hash(opPassword,10)
    });
    const op=opCreated.rows[0];
    check(!!op?.id,'G6_A_NETWORK_OPERATOR_PROVISION_FAILED');
    await markE2eTestAccount(client,{userId:op.id,actorId:a[0].id});
    for(const code of Object.keys(REFS)){
      const assignment=await delegation.resolveActiveAssignmentByMarketCode(client,code);
      await delegation.addMembership(client,{
        assignmentId:assignment.assignment_id,userId:op.id,actorUserId:a[0].id,
        capabilities:['network.read','network.update','pricing.read'],actorIsCentral:true
      });
      await projectAssignment(client,assignment.assignment_id);
    }
    users.networkOperator={id:op.id,email:opEmail,password:opPassword};
    for(const code of Object.keys(REFS)){
      const password=crypto.randomBytes(24).toString('base64url')+'Aa1!';
      const email='g6-a-relay-'+code.toLowerCase()+'-'+run8+'@komerce.test';
      const created=await createAdminUser(client,{
        fullName:'G6-A Relais '+code+' '+run8,
        email,role:'agent_relais',currencyPref:code==='KM'?'KMF':'XAF',
        passwordHash:await bcrypt.hash(password,10)
      });
      const user=created.rows[0];
      check(!!user?.id,'G6_A_USER_PROVISION_FAILED_'+code);
      await markE2eTestAccount(client,{userId:user.id,actorId:a[0].id});
      await ensureRelayAgentMembership(client,{delegation},{
        userId:user.id,marketCode:code,actorId:a[0].id
      });
      users[code]={id:user.id,email,password};
    }
    await client.query('COMMIT');tx=false;
  } catch(e){if(tx)await client.query('ROLLBACK').catch(()=>{});throw e;}
  finally{client.release();}
  step('E2E_ACTORS_CREATED_BY_CANONICAL_WRITERS',{markets:Object.keys(REFS),role:'agent_relais',credentials_exposed:false,scope:'G6-A'});
  return {byMarket,users,operator:users.networkOperator};
}
async function openUI(email,password,allowMutation){
  const ctx=await browser.newContext({viewport:{width:1440,height:900},locale:'fr-FR'});
  const page=await ctx.newPage();
  page.on('dialog',d=>d.accept());
  let n=0;
  await page.route('**/*',route=>{
    const req=route.request(),method=req.method(),url=new URL(req.url());
    if(['GET','HEAD','OPTIONS'].includes(method))return route.continue();
    if(method==='POST'&&url.origin===BASE&&url.pathname==='/api/auth/login'&&++n===1)
      return route.continue();
    if(method==='POST'&&url.origin===BASE&&allowMutation(url.pathname))
      return route.continue();
    // No supplier, PSP, payment gateway, reassign-by-API or unrelated business mutation.
    return route.abort();
  });
  await page.goto(BASE+'/login.html',{waitUntil:'domcontentloaded'});
  await humanFill(null,page.locator('#email'),email);
  await humanFill(null,page.locator('#password'),password);
  const wait=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/login'&&r.request().method()==='POST');
  await humanClick(null,page.locator('#btn-submit'));
  const lr=await wait;
  check(lr.status()===200,'G6_A_UI_LOGIN_'+lr.status());
  await page.waitForURL(u=>u.pathname!=='/login.html',{timeout:15000});
  await startTraceAfterAuth(ctx);
  return {ctx,page};
}
async function attachByUI(code,o,actor,operator){
  const pathPrefix='/api/market-delegation/markets/'+code+'/network/relais/'+o.relais_id+'/agents';
  const s=await openUI(operator.email,operator.password,p=>p===pathPrefix);
  try {
    const p=s.page;
    await p.goto(BASE+'/dashboards/canonical/market-autonomy.html?market='+code,{waitUntil:'domcontentloaded'});
    // The canonical autonomy shell loads pricing workspace before mounting network.
    // An operator needs pricing.read even when this test only mutates the network.
    const root=p.locator('#market-autonomy-root');
    await root.waitFor({state:'attached',timeout:15000});
    try {
      await p.locator('[data-market-network]').waitFor({state:'visible',timeout:25000});
    } catch (e) {
      const observed=await root.evaluate(el=>({
        class_name:el.className,
        error_title:el.querySelector('h1')?.textContent?.slice(0,70)||null,
        first_text:el.textContent?.trim().slice(0,140)||null
      })).catch(()=>({class_name:'unavailable'}));
      step('NETWORK_SHELL_BLOCKED',{market:code,url_path:new URL(p.url()).pathname,
        shell_class:observed.class_name,shell_title:observed.error_title,
        shell_error:observed.first_text});
      throw e;
    }
    const target=p.locator('.kmc-team-member').filter({has:p.locator('strong', {hasText:o.relay_name})});
    check(await target.count()===1,'G6_A_UI_RELAY_CARD_NOT_UNIQUE_'+code);
    const select=target.locator('select[data-agent-select]');
    await select.waitFor({state:'visible',timeout:18000});
    const eligible=await select.locator('option').evaluateAll((opts,id)=>opts.some(o=>o.value===id),actor.id);
    check(eligible,'G6_A_UI_ACTOR_NOT_ELIGIBLE_'+code);
    await humanSelect(null,select,actor.id);
    const action=target.getByRole('button',{name:'Rattacher',exact:true});
    const wait=p.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===pathPrefix,{timeout:20000});
    await humanClick(null,action);
    const rr=await wait;
    check(rr.status()===200,'G6_A_UI_ASSIGN_HTTP_'+rr.status()+'_'+code);
    const binding=(await db.query('SELECT relais_id FROM users WHERE id=$1',[actor.id])).rows[0];
    check(binding?.relais_id===o.relais_id,'G6_A_UI_ASSIGN_PG_MISMATCH_'+code);
    step('RELAY_UI_ATTACHED',{market:code,http:rr.status(),pg_binding_match:true});
  } finally {await s.ctx.close();}
}
async function cashByUI(code,o,actor){
  const cashPath='/api/admin/workspaces/operations/market/'+code+'/orders/'+o.reference+'/confirm-cash';
  const s=await openUI(actor.email,actor.password,p=>p===cashPath);
  try{
    const p=s.page;
    await p.goto(BASE+'/admin/relais-live?view=execute&market='+code+'&focus=cash',{waitUntil:'domcontentloaded'});
    const workspace=p.locator('[data-workspace-mode="relay-execution"]');
    await workspace.waitFor({state:'visible',timeout:25000});
    const jump=workspace.locator('[data-relay-execution-jump="cash"]');
    await jump.waitFor({state:'visible',timeout:15000});await humanClick(null,jump);
    const row=workspace.locator('tr',{hasText:o.reference});
    await row.waitFor({state:'visible',timeout:25000});
    const action=row.locator('[data-workspace-action="confirm-cash"]');
    await action.waitFor({state:'visible',timeout:15000});
    const wait=p.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===cashPath,{timeout:25000});
    await humanClick(null,action);
    const response=await wait;
    check(response.status()===200,'G6_A_CASH_CONFIRM_HTTP_'+response.status()+'_'+code);
    const actual=(await orderRows()).find(x=>x.market===code);
    check(actual && actual.payment_status==='paid'&&actual.cash_count===1&&actual.control_count===1,
      'G6_A_CASH_CONFIRM_PG_MISMATCH_'+code);
    await action.screenshot({path:path.join(OUT,code+'-cash-button.png')}).catch(()=>{});
    step('CASH_UI_PAID',{market:code,reference:o.reference,http:200,
      payment_status:actual.payment_status,cash_collection_count:actual.cash_count,
      cash_control_confirmed_count:actual.control_count});
  } finally {await s.ctx.close();}
}
(async()=>{
 try{
  check(process.env.GITHUB_EVENT_NAME==='issues' &&
    process.env.GITHUB_ACTOR===process.env.GITHUB_REPOSITORY_OWNER &&
    process.env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend' &&
    process.env.NODE_ENV==='test'&&process.env.KOMERCE_ENV==='staging' &&
    process.env.KOMERCE_TARGET_ENV==='staging'&&
    process.env.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&
    process.env.STAGING_BASE_URL===BASE&&
    !!process.env.E2E_ADMIN_EMAIL&&!!process.env.E2E_ADMIN_PASSWORD&&
    !!process.env.E2E_EXPECTED_DEPLOY_SHA,'G6_A_OWNER_STAGING_GUARD');
  const target=await confirmTarget({db,env:process.env});
  check(target.confirmed,'G6_A_DB_TARGET_NOT_CONFIRMED');
  report.db_fingerprint=target.fingerprint;
  report.sha=await sha();
  const {byMarket,users,operator}=await prepare();
  await sha();
  browser=await chromium.launch({headless:true});OBS=observe(browser,OUT);
  for(const code of Object.keys(REFS)){
    await sha();
    await attachByUI(code,byMarket[code],users[code],operator);
    await sha();
    await cashByUI(code,byMarket[code],users[code]);
    await sha();
  }
  report.verdict='G6_A_RELAY_UI_ASSIGNMENT_AND_CASH_CHROMIUM_PG_PASS_NOT_PICKUP_GO';
 }catch(e){
  report.verdict='BLOCKED';report.error=fullError(e);
  process.exitCode=2;
 }finally{
  save();if(OBS)await OBS.finish(!!process.exitCode).catch(()=>{});if(browser)await browser.close().catch(()=>{});
  await db.pool.end();console.log(JSON.stringify(report));
 }
})();
