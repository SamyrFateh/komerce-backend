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
const {marketProfile,marketOption}=require('../../scripts/recette/canonical/market-profile');
const MK=marketProfile(process.env);
const {humanGoto,humanClick,humanFill,humanSelect}=require('../../scripts/recette/canonical/actors/human-gestures');
const fs=require('node:fs');
const path=require('node:path');
const {test,expect}=require('@playwright/test');
const OUT=path.resolve('test-results/g6-p3-kuyiyuk');
const {observe,startTraceAfterAuth}=require("../../scripts/recette/canonical/observability");let OBS=null,FAILED=false;
// Statuts HTTP laissés au spec (evidence + assertions métier inchangées) ; la garde reste : réponse attendue, jamais de re-clic après mutation.
const ANY_STATUS=Array.from({length:400},(_,i)=>i+200);
// page.reload reste un geste humain (F5) : il n'émet aucune mutation, d'où l'absence de helper.
const CANONICAL=process.env.G6_CANONICAL_HUB_STAGE==='1';
// M03 (multi-PO) : une itération = un PO (le suivant à constituer) ; M01 : MULTI=false, comportement strictement historique.
const MULTI=CANONICAL&&process.env.G6_CANONICAL_PO_ITERATION!==undefined&&process.env.G6_CANONICAL_PO_ITERATION!=='';
const ITER=MULTI?Number(process.env.G6_CANONICAL_PO_ITERATION):0;
const N_IMPORT=MULTI?Number(process.env.G6_CANONICAL_IMPORT_ITEMS):1;
const EXPECT_PO=MULTI?ITER+1:1,EXPECT_LINES=MULTI?N_IMPORT:1;
// M03 : la partie locale est déjà remise, le statut de la commande n'est plus « confirmed/ordered » (jamais « collected »).
const STATUS_OK=(st,extra=[])=>MULTI?!['collected','cancelled'].includes(st):[...extra,'confirmed','ordered'].includes(st);
const REF=CANONICAL?String(process.env.G6_CANONICAL_ORDER_REFERENCE||''):'KUYIYUK';
const evidence={schema:'komerce-g6-p3-kuyiyuk/1',reference:REF,verdict:'NOT_PROVEN',external_supplier_calls:0,external_payment_executed:false,staging_cash_confirmation_recorded:false,gestures:[]};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');};
let db;
const q=async(sql,params=[]) => (await db.query(sql,params)).rows;
const base='https://komerce-backend-production.up.railway.app';
const buyer=CANONICAL?String(process.env.G6_CANONICAL_BUYER_ID||''):'aedfc0cb-db52-4f58-be1b-f709374151ad';
const orderId=CANONICAL?String(process.env.G6_CANONICAL_ORDER_ID||''):'af34f91c-bfa2-45a2-87c2-ec611cc8c850';
const IMPORT_ONLY=MULTI?" AND oi.fulfillment_source='IMPORT'":'';
const orderState=async()=> {
  const [o]=await q(`SELECT o.id,o.reference,o.user_id,o.relais_id,o.simulation_scope,o.status::text AS status,o.payment_mode::text AS payment_mode,o.payment_status::text AS payment_status,
     (SELECT COUNT(*)::int FROM order_items oi WHERE oi.order_id=o.id${IMPORT_ONLY}) AS item_count,
     (SELECT COUNT(*)::int FROM purchase_lines pl JOIN order_items oi ON oi.id=pl.order_item_id WHERE oi.order_id=o.id AND pl.cancelled_at IS NULL${IMPORT_ONLY}) AS line_count,
     (SELECT COUNT(DISTINCT pl.purchase_order_id)::int FROM purchase_lines pl JOIN order_items oi ON oi.id=pl.order_item_id WHERE oi.order_id=o.id AND pl.cancelled_at IS NULL AND pl.purchase_order_id IS NOT NULL${IMPORT_ONLY}) AS po_count,
     (SELECT COUNT(*)::int FROM cash_collections cc WHERE cc.order_id=o.id) AS cash_collection_count,
     (SELECT COUNT(*)::int FROM cash_confirmation_controls ccc WHERE ccc.order_id=o.id AND ccc.state='CONFIRMED') AS cash_control_confirmed_count
    FROM orders o WHERE o.id=$1 AND o.reference=$2`,[orderId,REF]);
  return o||null;
};
async function login(browser,baseURL,actor='hub'){
  if(!OBS)OBS=observe(browser,OUT);
  const prefix=actor==='relay'?'E2E_AGENT_RELAIS':actor==='admin'?'E2E_ADMIN':'E2E_AGENT_HUB';
  const email=process.env[prefix+'_EMAIL'],password=process.env[prefix+'_PASSWORD'];
  expect(email&&password,'E2E '+actor+' credentials').toBeTruthy();
  const ctx=await browser.newContext({baseURL,viewport:{width:1440,height:900}});
  const page=await ctx.newPage();
  page.on('dialog',d=>d.accept());
  await humanGoto(page,'/login.html');
  await humanFill(null,page.locator('#email'),email);
  await humanFill(null,page.locator('#password'),password);
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/login'&&r.request().method()==='POST');
  await humanClick(null,page.locator('#btn-submit'));
  expect((await response).status()).toBe(200);
  await page.waitForURL(u=>u.pathname!=='/login.html',{timeout:20000});
  await page.waitForLoadState('load').catch(()=>{});
  await startTraceAfterAuth(ctx);
  return {ctx,page};
}
async function capture(page,name){
  fs.mkdirSync(path.join(OUT,'captures'),{recursive:true});
  await page.screenshot({path:path.join(OUT,'captures',name+'.png')});
}
test.describe.serial('G6 P3 '+REF+' — Chromium Relais cash + Hub UI',()=>{
  test.afterEach(async({},info)=>{if(info.status!==info.expectedStatus)FAILED=true;});
  test.afterAll(async()=>{if(OBS)await OBS.finish(FAILED).catch(()=>{});});
  test.beforeAll(async()=>{
    db=require('../../db');
    const env=process.env;
    expect(env.NODE_ENV).toBe('test');
    expect(env.KOMERCE_ENV).toBe('staging');
    expect(env.GITHUB_EVENT_NAME).toBe('issues');
    expect(env.GITHUB_ACTOR).toBe(env.GITHUB_REPOSITORY_OWNER);
    expect(env.STAGING_BASE_URL).toBe(base);
    if(CANONICAL){
      expect(env.G6_CANONICAL_SCENARIO).toBe(MULTI?'M03':'M01');
      if(MULTI){expect(Number.isInteger(ITER)&&ITER>=0&&ITER<N_IMPORT&&N_IMPORT>=3).toBe(true);}
      expect(env.G6_TARGET_MARKET).toBe(MK.code);
      expect(REF).toMatch(/^[A-Z0-9][A-Z0-9-]{5,63}$/);
      expect(buyer).toMatch(/^[a-f0-9-]{36}$/);
      expect(orderId).toMatch(/^[a-f0-9-]{36}$/);
    }
    const target=await require('../../scripts/recette/target-guard').confirmTarget({db,env});
    expect(target.confirmed).toBe(true);
    evidence.db_fingerprint=target.fingerprint;
    const o=await orderState();
    expect(o,'same canonical G6 order exists').toBeTruthy();
    expect(o.user_id).toBe(buyer);
    expect(o.simulation_scope).toBe('G6-BUYER');
    expect(STATUS_OK(o.status,['pending'])).toBe(true);
    expect(o.payment_mode).toBe('cash_relais');
    expect(o.payment_status).toBe(o.status==='pending'?'pending':'paid');
    if(o.status==='ordered'){
      expect(Number(o.cash_collection_count)).toBe(1);
      expect(Number(o.cash_control_confirmed_count)).toBe(1);
    }
    expect(Number(o.item_count)).toBe(MULTI?N_IMPORT:1);
    expect(Number(o.line_count)).toBeLessThanOrEqual(MULTI?N_IMPORT:1);
    expect(Number(o.po_count)).toBeLessThanOrEqual(MULTI?N_IMPORT:1);
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
      if(o)evidence.final={order_id:o.id,status:o.status,payment_status:o.payment_status,line_count:Number(o.line_count),po_count:Number(o.po_count),cash_collection_count:Number(o.cash_collection_count),cash_control_confirmed_count:Number(o.cash_control_confirmed_count)};
    }catch(e){evidence.readback_error=String(e.message||e).slice(0,250);}
    if(evidence.final&&STATUS_OK(evidence.final.status)&&evidence.final.payment_status==='paid'&&evidence.final.cash_collection_count===1&&evidence.final.cash_control_confirmed_count===1&&evidence.final.line_count===EXPECT_LINES&&evidence.final.po_count===EXPECT_PO){
      evidence.verdict='G6_P3_MANUAL_LINE_AND_DRAFT_PO_CHROMIUM_PASS';
    }else if(evidence.error){
      evidence.verdict='G6_P3_BLOCKED_NOT_PROVEN';
    }
    save();
    if(db&&db.pool)await db.pool.end();
  });
  test('Créer la ligne manuelle puis préparer le PO depuis le cockpit canonique',async({browser,baseURL})=>{
    let before=await orderState();
    if(MULTI?Number(before.po_count)>=EXPECT_PO:(Number(before.line_count)===1&&Number(before.po_count)===1)){
      evidence.gestures.push({key:'resume-existing-draft',verdict:'ALREADY_PRESENT_NO_REPLAY'});
      await test.skip();
    }
    if(before.status==='pending'){
      const {ctx:relayCtx,page:relayPage}=await login(browser,baseURL,'relay');
      try{
        await humanGoto(relayPage,'/admin/relais-live?view=execute',{waitUntil:'domcontentloaded'});
        await relayPage.locator('select').first().waitFor({timeout:20000});
        await humanSelect(null,relayPage.locator('select').first(),await marketOption(MK,relayPage.locator('select').first()));
        await relayPage.waitForLoadState('networkidle').catch(()=>{});
        const cashScope=await relayPage.evaluate(async(mk)=>{
          const [meResponse,workspaceResponse]=await Promise.all([
            fetch('/api/auth/me',{credentials:'same-origin'}),
            fetch('/api/admin/workspaces/operations/market/'+mk,{credentials:'same-origin'})
          ]);
          const me=await meResponse.json(),workspace=await workspaceResponse.json();
          return {actor_role:me.role,actor_id:me.id,workspace_status:workspaceResponse.status,cash_pending_count:workspace.summary?.relay_cash_pending,cash_pending_references:(workspace.queues?.relay?.cash_pending||[]).map(o=>o.reference)};
        },MK.code);
        console.log('[G6_P3_CASH_SCOPE]',JSON.stringify(cashScope));
        await humanClick(null,relayPage.locator('[data-relay-execution-jump="cash"]'));
        const cashRow=relayPage.locator('tr',{hasText:REF});
        await cashRow.waitFor({timeout:20000});
        await capture(relayPage,'00-cash-pending');
        const cashResponse=relayPage.waitForResponse(r=>new URL(r.url()).pathname==='/api/admin/workspaces/operations/market/'+MK.code+'/orders/'+REF+'/confirm-cash'&&r.request().method()==='POST',{timeout:30000});
        await humanClick(null,cashRow.locator('[data-workspace-action="confirm-cash"]'));
        const cr=await cashResponse;
        const cbody=await cr.json().catch(()=>({}));
        evidence.gestures.push({key:'relay-confirm-cash',http:cr.status(),code:cbody.code||null,verdict:cr.status()===200?'PASS':'FAIL'});
        save();
        if(cr.status()!==200){
          evidence.error=String(cbody.code||cbody.error||'CASH_CONFIRMATION_REJECTED').slice(0,250);
          throw new Error(evidence.error);
        }
        evidence.staging_cash_confirmation_recorded=true;
        await expect.poll(async()=>{const o=await orderState();return String(o.status)+':'+String(o.payment_status)+':'+Number(o.cash_collection_count)+':'+Number(o.cash_control_confirmed_count);},{timeout:20000}).toMatch(/^(?:confirmed|ordered):paid:1:1$/);
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
    expect(STATUS_OK(before.status)).toBe(true);
    expect(before.payment_status).toBe('paid');
    expect(Number(before.cash_collection_count)).toBe(1);
    expect(Number(before.cash_control_confirmed_count)).toBe(1);
    const {ctx,page}=await login(browser,baseURL);
    try{
      await humanGoto(page,'/admin/hub-live?view=execute',{waitUntil:'domcontentloaded'});
      await page.locator('select').first().waitFor({timeout:20000});
      await humanSelect(null,page.locator('select').first(),await marketOption(MK,page.locator('select').first()));
      await page.waitForLoadState('networkidle').catch(()=>{});
      const dossiers=page.getByRole('tab',{name:'Dossiers'});
      if(await dossiers.count())await humanClick(null,dossiers);
      const orderCard=page.locator('[data-hlc-order]').filter({hasText:REF});
      await orderCard.first().waitFor({timeout:25000});
      await capture(page,'01-order-visible');
      // Le déclencheur d'achat automatique (post-encaissement cash) est asynchrone côté serveur :
      // on lui laisse le temps de créer la ligne (lecture PG seule) avant tout sourcing manuel.
      let afterCash=await orderState();
      for(let i=0;i<24&&Number(afterCash.line_count)<(MULTI?N_IMPORT:1)&&(MULTI||Number(afterCash.line_count)===0);i++){
        await page.waitForTimeout(5000);
        afterCash=await orderState();
      }
      evidence.auto_line_after_cash=Number(afterCash.line_count)===EXPECT_LINES;
      // Si la ligne est arrivée pendant l'attente, l'écran affiché est périmé (« Sourcing requis ») :
      // un humain rechargerait la page avant d'agir.
      if(evidence.auto_line_after_cash){
        await page.reload({waitUntil:'domcontentloaded'});
        await page.waitForLoadState('networkidle').catch(()=>{});
        await page.locator('[data-hlc-need]').filter({hasText:REF}).first().waitFor({timeout:25000});
      }
      // Multi-PO : aucune création manuelle de ligne par l'écran de sourcing n'est jouée (il traite une commande, pas une ligne) ;
      // des lignes d'achat manquantes sont un manque produit déclaré, jamais contourné.
      if(MULTI&&Number(afterCash.line_count)!==N_IMPORT){
        evidence.error='G6_HUB_PO_PRODUCT_GAP_AUTO_PURCHASE_LINES_'+Number(afterCash.line_count)+'_OF_'+N_IMPORT;
        throw new Error(evidence.error);
      }
      if(!MULTI&&Number(afterCash.line_count)===0){
        const need=page.locator('[data-hlc-need]').filter({hasText:REF});
        await need.first().waitFor({timeout:20000});
        await humanClick(null,need.first());
        const resolve=page.locator('[data-hlc-action="resolve-sourcing"]');
        await resolve.waitFor({timeout:15000});
        await humanClick(null,resolve);
        const form=page.locator('form[data-hub-sourcing-form="'+REF+'"]');
        await form.waitFor({timeout:15000});
        const supplier=form.locator('[data-sourcing-supplier]');
        await expect.poll(async()=>supplier.locator('option').count(),{timeout:20000}).toBeGreaterThan(1);
        const opts=await supplier.locator('option').evaluateAll(es=>es.map((e,i)=>({i,value:e.value,label:e.textContent||''})));
        const match=opts.find(x=>x.value&&/déjà associé/i.test(x.label));
        expect(match,'an existing supplier-to-product mapping is visible').toBeTruthy();
        await humanSelect(null,supplier,match.value);
        await capture(page,'02-supplier-mapping-selected');
        const lineResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/purchasing/lines'&&r.request().method()==='POST',{timeout:30000});
        await humanClick(null,form.getByRole('button',{name:'Créer la ligne d’achat'}),{mutation:{path:'/api/purchasing/lines',statuses:ANY_STATUS}});
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
      expect(Number(current.line_count)).toBe(EXPECT_LINES);
      expect(Number(current.po_count)).toBe(MULTI?ITER:0);
      const need=page.locator('[data-hlc-need]').filter({hasText:REF});
      if(!(await need.count())){
        await page.reload({waitUntil:'domcontentloaded'});
        await page.waitForLoadState('networkidle').catch(()=>{});
      }
      const needs=page.locator('[data-hlc-need]').filter({hasText:REF});
      const activeNeed=MULTI?needs.first():needs.last();
      await activeNeed.waitFor({timeout:25000});
      await humanClick(null,activeNeed);
      const prepare=page.locator('[data-hlc-action="prepare-po"]');
      await prepare.waitFor({timeout:15000});
      const poResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/purchasing/po/prepare'&&r.request().method()==='POST',{timeout:30000});
      await humanClick(null,prepare,{mutation:{path:'/api/purchasing/po/prepare',statuses:ANY_STATUS}});
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
      expect(Number(after.line_count)).toBe(EXPECT_LINES);
      expect(Number(after.po_count)).toBe(EXPECT_PO);
      expect(STATUS_OK(after.status)).toBe(true);
      expect(after.payment_status).toBe('paid');
      expect(Number(after.cash_collection_count)).toBe(1);
      expect(Number(after.cash_control_confirmed_count)).toBe(1);
      // Oracle HUB_PO (lecture PG seule) : la ligne de NOTRE commande, pas seulement des comptages.
      const [hub]=await q(`SELECT pl.quantity AS line_qty, oi.quantity AS item_qty, pl.supplier_id AS line_supplier, po.supplier_id AS po_supplier,
          ps.supplier_id AS mapped_supplier, po.status::text AS po_status, po.trigger_mode, m.code AS market_code,
          NULLIF(to_jsonb(o)->>'simulation_scope','') AS simulation_scope
        FROM purchase_lines pl JOIN order_items oi ON oi.id=pl.order_item_id JOIN orders o ON o.id=oi.order_id
        JOIN purchase_orders po ON po.id=pl.purchase_order_id LEFT JOIN markets m ON m.id=o.market_id
        LEFT JOIN product_suppliers ps ON ps.id=pl.product_supplier_id
        WHERE o.id=$1 AND pl.cancelled_at IS NULL${MULTI?' AND po.id=$2':''}`,
        MULTI?[orderId,evidence.gestures.find(g=>g.key==='prepare-draft-po'&&g.verdict==='PASS').purchase_order_id]:[orderId]);
      expect(hub,'HUB_PO oracle: line of our order on a PO').toBeTruthy();
      expect(Number(hub.line_qty)).toBe(Number(hub.item_qty));
      expect(hub.line_supplier).toBeTruthy();
      expect(hub.line_supplier).toBe(hub.po_supplier);
      if(hub.mapped_supplier)expect(hub.mapped_supplier).toBe(hub.line_supplier);
      expect(hub.po_status).toBe('draft');
      expect(hub.market_code).toBe(MK.code);
      expect(hub.simulation_scope).toBe('G6-BUYER');
      evidence.hub_po_oracle={quantity:Number(hub.line_qty),supplier_consistent:true,po_status:hub.po_status,market:hub.market_code,simulation_scope:hub.simulation_scope,manual_sourcing_path_played:!evidence.auto_line_after_cash};
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
