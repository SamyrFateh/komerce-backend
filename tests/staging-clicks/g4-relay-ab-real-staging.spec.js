'use strict';
/**
 * @komerce-arch-lite
 * @role staging-g4-relay-ab-chromium-proof
 * @domain dashboard
 * @layer e2e
 * @owner backend-core
 * @purpose Two independent KM agents, separate Chromium sessions, own real business clicks, cross-relais 403 and independent HTTP+PG readbacks.
 * @impact-areas staging, relay, market-delegation
 */
const fs=require('node:fs');
const path=require('node:path');
const {test,expect}=require('@playwright/test');
const db=require('../../db');
const {snapshot,assess}=require('../../scripts/recette/staging-local-stock-real-relay-cert');
const BASE='https://komerce-backend-production.up.railway.app';
const MARKET=process.env.G4_MARKET;
const OUT='test-results/g4-staging';
const report={schema:'g4-two-relays-real-staging-chromium/1',
  verdict:'G4_NOT_PROVEN',market:MARKET,session_count:2,checks:[],errors:[],http:[],
  chromium:true,postgresql:true,runtime_sha:process.env.E2E_EXPECTED_DEPLOY_SHA};
function check(ok,key,detail) {
  report.checks.push({key,pass:!!ok,...(detail==null?{}:{detail})});
  if(!ok)throw Error('G4_AB_FAIL:'+key+':'+String(detail??'').slice(0,130));
}
function save() {
  fs.mkdirSync(OUT,{recursive:true});
  fs.writeFileSync(path.join(OUT,'g4-ab-chromium.json'),JSON.stringify(report,null,2)+'\n');
}
async function login(page,actor){
  await page.goto('/login.html?next='+encodeURIComponent('/admin/relais-live?view=execute&market='+MARKET'));
  await page.locator('#email').fill(actor.email);
  await page.locator('#password').fill(actor.password);
  const res=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/login'&&r.request().method()==='POST');
  await page.locator('#btn-submit').click();
  check((await res).status()===200,'login-'+actor.label);
  await page.waitForURL(u=>u.pathname==='/admin/relais-live'&&
    u.searchParams.get('market')===MARKET,{timeout:25000});
  await expect(page.locator('[data-workspace-mode="relay-execution"]')).toBeVisible({timeout:25000});
}
async function workspaceReadback(page,ownRef,otherRef,label,phase) {
  const r=await page.request.get('/api/admin/workspaces/operations/market/'+MARKET);
  check(r.status()===200,'workspace-api-'+label+'-'+phase,r.status());
  const body=await r.json();
  const serial=JSON.stringify(body);
  check(!serial.includes(otherRef),'other-reference-hidden-api-'+label+'-'+phase);
  check(serial.includes(ownRef)||phase==='collected','own-reference-present-api-'+label+'-'+phase);
}
async function receipt(page,actor,other) {
  const w=page.locator('[data-workspace-mode="relay-execution"]');
  const queue=w.locator('[data-relay-execution-jump="receive"]');
  await expect(queue).toBeVisible({timeout:25000});
  await queue.click();
  const lane=w.locator('#relay-execution-receive');
  const own=lane.locator('[data-relay-local-order="'+actor.reference+'"]');
  await expect(own).toBeVisible({timeout:25000});
  check((await lane.locator('[data-relay-local-order="'+other.reference+'"]').count())===0,
    'cross-relay-hidden-ui-'+actor.label);
  await page.screenshot({path:path.join(OUT,actor.label+'-01-before.png'),fullPage:true});
  const denied=await page.request.post('/api/orders/'+other.orderId+'/local-relay-receipt',
    {data:{physical_received:true,note:'G4 CROSS REFUS '+actor.label}});
  report.http.push({actor:actor.label,operation:'cross-receipt',status:denied.status()});
  check(denied.status()===403,'cross-receipt-403-'+actor.label,denied.status());
  const ownerBefore=await snapshot(db,actor.orderId), otherBefore=await snapshot(db,other.orderId);
  check(assess(ownerBefore,'before').length===0,'owner-before-'+actor.label);
  const otherExpected=other.label==='A'?'available':'before';
  check(assess(otherBefore,otherExpected).length===0,'other-untouched-'+actor.label);
  await workspaceReadback(page,actor.reference,other.reference,actor.label,'before');
  const physical=own.locator('[data-local-physical-proof]');
  const note=own.locator('[data-local-receipt-note]');
  await physical.check();
  await note.fill('G4 OWN REAL RECEIPT '+actor.label);
  page.on('dialog',d=>d.accept());
  const endpoint='/api/orders/'+actor.orderId+'/local-relay-receipt';
  const response=page.waitForResponse(r=>new URL(r.url()).pathname===endpoint&&r.request().method()==='POST');
  await own.locator('[data-workspace-action="local-relay-receipt"]').click();
  const received=await response;
  report.http.push({actor:actor.label,operation:'own-receipt',status:received.status()});
  check(received.status()===200,'own-receipt-200-'+actor.label,received.status());
  const ownAfter=await snapshot(db,actor.orderId);
  check(assess(ownAfter,'available').length===0,'own-receipt-pg-'+actor.label,
    assess(ownAfter,'available'));
  check(JSON.stringify(await snapshot(db,other.orderId))===JSON.stringify(otherBefore),
    'cross-refusal-no-other-write-'+actor.label);
  await workspaceReadback(page,actor.reference,other.reference,actor.label,'available');
  await page.screenshot({path:path.join(OUT,actor.label+'-02-received.png'),fullPage:true});
  return ownAfter.parcels[0].reference;
}
async function collect(page,actor,other,ownParcel,foreignParcel) {
  const url='/api/admin/workspaces/operations/market/'+MARKET+'/parcels/'+
    encodeURIComponent(foreignParcel)+'/collect';
  const before=await snapshot(db,other.orderId);
  const denied=await page.request.post(url,{data:{}});
  report.http.push({actor:actor.label,operation:'cross-collect',status:denied.status()});
  check(denied.status()===403,'cross-pickup-403-'+actor.label,denied.status());
  check(JSON.stringify(await snapshot(db,other.orderId))===JSON.stringify(before),
    'cross-pickup-no-other-write-'+actor.label);
  await page.goto('/admin/relais-live?view=remises&market='+MARKET');
  await expect(page.locator('#relay-execution-collect')).toBeVisible({timeout:25000});
  const row=page.locator('#relay-execution-collect tr').filter({hasText:ownParcel});
  const action=row.locator('[data-workspace-action="collect"]');
  await expect(action).toBeVisible({timeout:25000});
  check((await page.locator('#relay-execution-collect tr').filter({hasText:foreignParcel}).count())===0,
    'foreign-collect-hidden-ui-'+actor.label);
  const ownRoute='/api/admin/workspaces/operations/market/'+MARKET+'/parcels/'+encodeURIComponent(ownParcel)+'/collect';
  const response=page.waitForResponse(r=>new URL(r.url()).pathname===ownRoute&&r.request().method()==='POST');
  await action.click();
  const res=await response;
  report.http.push({actor:actor.label,operation:'own-collect',status:res.status()});
  check(res.status()===200,'own-collect-200-'+actor.label,res.status());
  const state=await snapshot(db,actor.orderId);
  check(assess(state,'collected').length===0,'own-pickup-pg-'+actor.label,assess(state,'collected'));
  await workspaceReadback(page,actor.reference,other.reference,actor.label,'collected');
  await page.screenshot({path:path.join(OUT,actor.label+'-03-collected.png'),fullPage:true});
}
test('G4 staging KM : A et B, deux navigateurs isolés, refus croisés et réception/remise vraies',async({browser})=>{
  const labels=['A','B'];const actors={};
  check(['KM','CM','CG'].includes(MARKET),'permitted-staging-market');
  const contexts=[];
  try{
    check(process.env.HUB_V1_STAGING_DISPOSABLE_MODE==='1','disposable-owner-mode');
    for(const label of labels){
      const run8=process.env['G4_'+label+'_RUN8'];
      const reference=process.env['G4_'+label+'_REFERENCE'];
      check(new RegExp('^[A-F0-9]{8}$').test(String(run8||'')),'run8-'+label);
      check(reference==='E2E-HUB-V1-'+run8+'-LOCAL','canonical-ref-'+label);
      const {rows}=await db.query('SELECT id::text AS id,relais_id::text AS relais_id FROM orders WHERE reference=$1',[reference]);
      check(rows.length===1,'single-order-'+label);
      check(rows[0].id===process.env['G4_'+label+'_ORDER_ID'],'id-consistency-'+label);
      actors[label]={label,reference,orderId:rows[0].id,relaisId:rows[0].relais_id,
        email:process.env['G4_'+label+'_EMAIL'],password:process.env['G4_'+label+'_PASSWORD']};
    }
    check(actors.A.relaisId!==actors.B.relaisId,'two-distinct-relais');
    const [mA,mB]=await Promise.all([db.query('SELECT market_id FROM relais WHERE id=$1',[actors.A.relaisId]),
      db.query('SELECT market_id FROM relais WHERE id=$1',[actors.B.relaisId])]);
    check(String(mA.rows[0].market_id)===String(mB.rows[0].market_id),'same-market');
    const pages={};
    for(const label of labels){
      const ctx=await browser.newContext({baseURL:BASE,viewport:{width:1440,height:900}});
      contexts.push(ctx);pages[label]=await ctx.newPage();
      pages[label].on('pageerror',e=>report.errors.push({label,error:String(e.message).slice(0,100)}));
      await login(pages[label],actors[label]);
    }
    const pA=await receipt(pages.A,actors.A,actors.B);
    const pB=await receipt(pages.B,actors.B,actors.A);
    await collect(pages.A,actors.A,actors.B,pA,pB);
    await collect(pages.B,actors.B,actors.A,pB,pA);
    check(report.errors.length===0,'no-js-errors',report.errors);
    report.verdict='G4_STAGING_TWO_RELAIS_CHROMIUM_HTTP_PG_PASS';
    report.run8s=[process.env.G4_A_RUN8,process.env.G4_B_RUN8];
    report.agents=2;report.relais=2;
    report.refusals=report.http.filter(x=>x.operation.startsWith('cross')).length;
    report.own_actions=report.http.filter(x=>x.operation.startsWith('own')).length;
    check(report.refusals===4,'four-cross-refusals');
    check(report.own_actions===4,'four-own-business-writes');
  }catch(e){report.verdict='G4_STAGING_KM_FAIL';report.failure=String(e.message).slice(0,300);throw e;}
  finally{save();await Promise.all(contexts.map(c=>c.close().catch(()=>{})));await db.pool?.end?.();}
});
