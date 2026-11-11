/**
 * @komerce-arch-lite
 * @role          g6-p3-kuyiyuk-chromium
 * @domain        purchasing
 * @layer         e2e
 * @owner         backend-core
 * @purpose       Continue the existing G6 order through canonical manual sourcing and PO draft UI clicks.
 * @impact-areas  purchasing, admin-dashboard, staging-only
 */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {test,expect}=require('@playwright/test');
const OUT=path.resolve('test-results/g6-p3-kuyiyuk');
const evidence={schema:'komerce-g6-p3-kuyiyuk/1',reference:'KUYIYUK',verdict:'NOT_PROVEN',external_supplier_calls:0,external_payment_executed:false,staging_cash_confirmation_recorded:false,gestures:[]};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');};
let db;
const q=async(sql,params=[]) => (await db.query(sql,params)).rows;
const base='https://komerce-backend-production.up.railway.app';
const buyer='aedfc0cb-db52-4f58-be1b-f709374151ad';
const orderId='af34f91c-bfa2-45a2-87c2-ec611cc8c850';
const orderState=async()=> {
  const [o]=await q(`SELECT o.id,o.reference,o.user_id,o.relais_id,o.simulation_scope,o.status::text AS status,o.payment_mode::text AS payment_mode,o.payment_status::text AS payment_status,
     (SELECT COUNT(*)::int FROM order_items oi WHERE oi.order_id=o.id) AS item_count,
     (SELECT COUNT(*)::int FROM purchase_lines pl JOIN order_items oi ON oi.id=pl.order_item_id WHERE oi.order_id=o.id AND pl.cancelled_at IS NULL) AS line_count,
     (SELECT COUNT(DISTINCT pl.purchase_order_id)::int FROM purchase_lines pl JOIN order_items oi ON oi.id=pl.order_item_id WHERE oi.order_id=o.id AND pl.cancelled_at IS NULL AND pl.purchase_order_id IS NOT NULL) AS po_count,
     (SELECT COUNT(*)::int FROM cash_collections cc WHERE cc.order_id=o.id) AS cash_collection_count,
     (SELECT COUNT(*)::int FROM cash_confirmation_controls ccc WHERE ccc.order_id=o.id AND ccc.state='CONFIRMED') AS cash_control_confirmed_count
    FROM orders o WHERE o.id=$1 AND o.reference='KUYIYUK'`,[orderId]);
  return o||null;
};
async function login(browser,baseURL,actor='hub'){
  const prefix=actor==='relay'?'E2E_AGENT_RELAIS':actor==='admin'?'E2E_ADMIN':'E2E_AGENT_HUB';
  const email=process.env[prefix+'_EMAIL'],password=process.env[prefix+'_PASSWORD'];
  expect(email&&password,'E2E '+actor+' credentials').toBeTruthy();
  const ctx=await browser.newContext({baseURL,viewport:{width:1440,height:900}});
  const page=await ctx.newPage();
  page.on('dialog',d=>d.accept());
  await page.goto('/login.html');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/login'&&r.request().method()==='POST');
  await page.locator('#btn-submit').click();
  expect((await response).status()).toBe(200);
  await page.waitForURL(u=>u.pathname!=='/login.html',{timeout:20000});
  await page.waitForLoadState('load').catch(()=>{});
  return {ctx,page};
}
async function capture(page,name){
  fs.mkdirSync(path.join(OUT,'captures'),{recursive:true});
  await page.screenshot({path:path.join(OUT,'captures',name+'.png')});
}
test.describe.serial('G6 P3 KUYIYUK — Chromium Relais cash + Hub UI',()=>{
  test.beforeAll(async()=>{
    db=require('../../db');
    const env=process.env;
    expect(env.NODE_ENV).toBe('test');
    expect(env.KOMERCE_ENV).toBe('staging');
    expect(env.GITHUB_EVENT_NAME).toBe('issues');
    expect(env.GITHUB_ACTOR).toBe(env.GITHUB_REPOSITORY_OWNER);
    expect(env.STAGING_BASE_URL).toBe(base);
    const target=await require('../../scripts/recette/target-guard').confirmTarget({db,env});
    expect(target.confirmed).toBe(true);
    evidence.db_fingerprint=target.fingerprint;
    const o=await orderState();
    expect(o,'same canonical G6 order exists').toBeTruthy();
    expect(o.user_id).toBe(buyer);
    expect(o.simulation_scope).toBe('G6-BUYER');
    expect(['pending','confirmed']).toContain(o.status);
    expect(o.payment_mode).toBe('cash_relais');
    expect(o.payment_status).toBe(o.status==='pending'?'pending':'paid');
    expect(Number(o.item_count)).toBe(1);
    expect(Number(o.line_count)).toBeLessThanOrEqual(1);
    expect(Number(o.po_count)).toBeLessThanOrEqual(1);
    const [relayIdentity]=await q(
      `SELECT u.id,u.role::text AS role,u.relais_id,
              EXISTS(SELECT 1 FROM e2e_test_accounts e WHERE e.user_id=u.id) AS is_e2e_test_account
         FROM users u WHERE lower(u.email)=lower($1) LIMIT 1`,
      [process.env.E2E_AGENT_RELAIS_EMAIL]
    );
    evidence.initial={order_id:o.id,status:o.status,payment_status:o.payment_status,line_count:Number(o.line_count),po_count:Number(o.po_count),cash_collection_count:Number(o.cash_collection_count),cash_control_confirmed_count:Number(o.cash_control_confirmed_count),order_relais_id:o.relais_id||null};
    evidence.relay_identity=relayIdentity?{user_id:relayIdentity.id,role:relayIdentity.role,relais_id:relayIdentity.relais_id||null,is_e2e_test_account:relayIdentity.is_e2e_test_account}:null;
    console.log('[G6_P3_RELAY_VISIBILITY]',JSON.stringify({order_relais_id:o.relais_id||null,relay_identity:evidence.relay_identity}));
    save();
  });
  test.afterAll(async()=>{
    try {
      const o=await orderState();
      if(o)evidence.final={order_id:o.id,status:o.status,payment_status:o.payment_status,line_count:Number(o.line_count),po_count:Number(o.po_count)};
    }catch(e){evidence.readback_error=String(e.message||e).slice(0,250);}
    if(evidence.final&&evidence.final.status==='confirmed'&&evidence.final.payment_status==='paid'&&evidence.final.cash_collection_count===1&&evidence.final.cash_control_confirmed_count===1&&evidence.final.line_count===1&&evidence.final.po_count===1){
      evidence.verdict='G6_P3_MANUAL_LINE_AND_DRAFT_PO_CHROMIUM_PASS';
    }else if(evidence.error){
      evidence.verdict='G6_P3_BLOCKED_NOT_PROVEN';
    }
    save();
    if(db&&db.pool)await db.pool.end();
  });
  test('Créer la ligne manuelle puis préparer le PO depuis le cockpit canonique',async({browser,baseURL})=>{
    let before=await orderState();
    if(Number(before.line_count)===1&&Number(before.po_count)===1){
      evidence.gestures.push({key:'resume-existing-draft',verdict:'ALREADY_PRESENT_NO_REPLAY'});
      await test.skip();
    }
    if(before.status==='pending'){
      const {ctx:relayCtx,page:relayPage}=await login(browser,baseURL,'relay');
      try{
        await relayPage.goto('/admin/relais-live?view=execute',{waitUntil:'domcontentloaded'});
        await relayPage.locator('select').first().waitFor({timeout:20000});
        await relayPage.locator('select').first().selectOption({label:'KM · Comores'});
        await relayPage.waitForLoadState('networkidle').catch(()=>{});
        await relayPage.locator('[data-relay-execution-jump="cash"]').click();
        const cashRow=relayPage.locator('tr',{hasText:'KUYIYUK'});
        await cashRow.waitFor({timeout:20000});
        await capture(relayPage,'00-cash-pending');
        const cashResponse=relayPage.waitForResponse(r=>new URL(r.url()).pathname==='/api/admin/workspaces/operations/market/KM/orders/KUYIYUK/confirm-cash'&&r.request().method()==='POST',{timeout:30000});
        await cashRow.locator('[data-workspace-action="confirm-cash"]').click();
        const cr=await cashResponse;
        const cbody=await cr.json().catch(()=>({}));
        evidence.gestures.push({key:'relay-confirm-cash',http:cr.status(),code:cbody.code||null,verdict:cr.status()===200?'PASS':'FAIL'});
        save();
        if(cr.status()!==200){
          evidence.error=String(cbody.code||cbody.error||'CASH_CONFIRMATION_REJECTED').slice(0,250);
          throw new Error(evidence.error);
        }
        evidence.staging_cash_confirmation_recorded=true;
        await expect.poll(async()=>{const o=await orderState();return String(o.status)+':'+String(o.payment_status)+':'+Number(o.cash_collection_count);},{timeout:20000}).toBe('confirmed:paid:1');
        await capture(relayPage,'00-cash-confirmed');
      }catch(error){
        evidence.error=String(error.message||error).split('\n')[0].slice(0,300);
        await capture(relayPage,'99-cash-blocked').catch(()=>{});
        save();
        throw error;
      }finally{
        await relayCtx.close();
      }
      evidence.gestures.push({key:'cash-payment-recorded-in-staging',verdict:'PASS',external_payment:false});
      before=await orderState();
    }
    expect(before.status).toBe('confirmed');
    expect(before.payment_status).toBe('paid');
    expect(Number(before.cash_collection_count)).toBe(1);
    expect(Number(before.cash_control_confirmed_count)).toBe(1);
    const {ctx,page}=await login(browser,baseURL);
    try{
      await page.goto('/admin/hub-live?view=execute',{waitUntil:'domcontentloaded'});
      await page.locator('select').first().waitFor({timeout:20000});
      await page.locator('select').first().selectOption({label:'KM · Comores'}).catch(()=>{});
      await page.waitForLoadState('networkidle').catch(()=>{});
      const dossiers=page.getByRole('tab',{name:'Dossiers'});
      if(await dossiers.count())await dossiers.click();
      const orderCard=page.locator('[data-hlc-order]').filter({hasText:'KUYIYUK'});
      await orderCard.first().waitFor({timeout:25000});
      await capture(page,'01-order-visible');
      const afterCash=await orderState();
      if(Number(afterCash.line_count)===0){
        const need=page.locator('[data-hlc-need]').filter({hasText:'KUYIYUK'});
        await need.first().waitFor({timeout:20000});
        await need.first().click();
        const resolve=page.locator('[data-hlc-action="resolve-sourcing"]');
        await resolve.waitFor({timeout:15000});
        await resolve.click();
        const form=page.locator('form[data-hub-sourcing-form="KUYIYUK"]');
        await form.waitFor({timeout:15000});
        const supplier=form.locator('[data-sourcing-supplier]');
        await expect.poll(async()=>supplier.locator('option').count(),{timeout:20000}).toBeGreaterThan(1);
        const opts=await supplier.locator('option').evaluateAll(es=>es.map((e,i)=>({i,value:e.value,label:e.textContent||''})));
        const match=opts.find(x=>x.value&&/déjà associé/i.test(x.label));
        expect(match,'an existing supplier-to-product mapping is visible').toBeTruthy();
        await supplier.selectOption(match.value);
        await capture(page,'02-supplier-mapping-selected');
        const lineResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/purchasing/lines'&&r.request().method()==='POST',{timeout:30000});
        await form.getByRole('button',{name:'Créer la ligne d’achat'}).click();
        const lr=await lineResponse;
        const lbody=await lr.json().catch(()=>({}));
        evidence.gestures.push({key:'create-manual-purchase-line',http:lr.status(),line_id:lbody?.line?.line_id||null,verdict:lr.status()===201?'PASS':'FAIL'});
        save();
        if(lr.status()!==201){
          evidence.error=String(lbody.code||lbody.error||'PURCHASE_LINE_REJECTED').slice(0,250);
          throw new Error(evidence.error);
        }
        await page.waitForTimeout(1200);
      }
      const current=await orderState();
      expect(Number(current.line_count)).toBe(1);
      expect(Number(current.po_count)).toBe(0);
      const need=page.locator('[data-hlc-need]').filter({hasText:'KUYIYUK'});
      if(!(await need.count())){
        await page.reload({waitUntil:'domcontentloaded'});
        await page.waitForLoadState('networkidle').catch(()=>{});
      }
      const activeNeed=page.locator('[data-hlc-need]').filter({hasText:'KUYIYUK'}).last();
      await activeNeed.waitFor({timeout:25000});
      await activeNeed.click();
      const prepare=page.locator('[data-hlc-action="prepare-po"]');
      await prepare.waitFor({timeout:15000});
      const poResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/purchasing/po/prepare'&&r.request().method()==='POST',{timeout:30000});
      await prepare.click();
      const pr=await poResponse;
      const pbody=await pr.json().catch(()=>({}));
      evidence.gestures.push({key:'prepare-draft-po',http:pr.status(),purchase_order_id:pbody?.purchase_order?.id||pbody?.id||null,verdict:pr.status()===201?'PASS':'FAIL'});
      save();
      if(pr.status()!==201){
        evidence.error=String(pbody.code||pbody.error||'PO_PREPARATION_REJECTED').slice(0,250);
        throw new Error(evidence.error);
      }
      await capture(page,'03-draft-po-created');
      const after=await orderState();
      evidence.final={order_id:after.id,status:after.status,payment_status:after.payment_status,line_count:Number(after.line_count),po_count:Number(after.po_count)};
      expect(Number(after.line_count)).toBe(1);
      expect(Number(after.po_count)).toBe(1);
      expect(after.status).toBe('confirmed');
      expect(after.payment_status).toBe('paid');
      expect(Number(after.cash_collection_count)).toBe(1);
      expect(Number(after.cash_control_confirmed_count)).toBe(1);
      evidence.db_readback='same order, one cash collection and confirmed control, one purchase line, one draft PO';
      save();
    }catch(error){
      evidence.error=String(error.message||error).split('\n')[0].slice(0,300);
      await capture(page,'99-blocked').catch(()=>{});
      save();
      throw error;
    }finally{
      await ctx.close();
    }
  });
});
