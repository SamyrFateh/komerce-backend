/**
 * @komerce-arch-lite
 * @role relay-local-native-staging-click-proof
 * @domain dashboard
 * @layer e2e
 * @owner backend-core
 * @purpose Verifier clics Chromium agent relais, route canonique et readback PostgreSQL LOCAL_STOCK sans Hub.
 * @impact-areas staging-only, relay, local-stock, logistics
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const db = require('../../db');
const { snapshot, assess } = require('../../scripts/recette/staging-local-stock-real-relay-cert');

// G3 local certification is explicitly separate from official staging.
// The shared browser scenario keeps the same selectors and HTTP/PG assertions.
const ISOLATED_LOCAL = process.env.G3_ISOLATED_LOCAL === '1';
const STAGING = ISOLATED_LOCAL ? 'http://localhost:3917' : 'https://komerce-backend-production.up.railway.app';
if (ISOLATED_LOCAL) {
  require('../../scripts/recette/hub-v1-certification-runner')
    .assertEphemeralTarget(process.env.DATABASE_URL, []);
  if (process.env.NODE_ENV !== 'test' || process.env.KOMERCE_ENV !== 'test' ||
      process.env.KOMERCE_TARGET_ENV === 'staging' ||
      process.env.E2E_CLICKS_BASE_URL !== STAGING ||
      process.env.E2E_STAGING_BASE_URL || process.env.STAGING_BASE_URL)
    throw Error('G3_LOCAL_CHROMIUM_DISPOSABLE_TARGET_ONLY');
}
const MARKET = String(process.env.HTTP_RUNNER_MARKET || '').toUpperCase();
const RUN8 = String(process.env.HTTP_RUNNER_RUN8 || '').toUpperCase();
const EXPECTED_SHA = String(process.env.E2E_EXPECTED_DEPLOY_SHA || '');
const LABELS = { KM:'KM · Comores', CM:'CM · Cameroun', CG:'CG · Congo-Brazzaville' };
const OUT = path.resolve('test-results/local-stock-native-clicks');
const record = { schema:'relay-local-native-click-proof/1', market:MARKET, run8:RUN8,
  staging:STAGING, target_mode:ISOLATED_LOCAL ? 'DISPOSABLE_LOCAL_PG16' : 'OFFICIAL_STAGING',
  staging_go:false, verdict:'NOT_CERTIFIED', checks:[], http:[], jsErrors:[], blockedWrites:[], navigation:[] };
const save = () => { fs.mkdirSync(OUT,{recursive:true}); fs.writeFileSync(path.join(OUT,'evidence.json'),JSON.stringify(record,null,2)+'\n'); };
const assert = (condition,key,detail=null) => {
  record.checks.push({key,verdict:condition?'PASS':'FAIL',...(detail==null?{}:{detail})});
  if(!condition)throw Error('LOCAL_NATIVE_FAIL:'+key+(detail==null?'':':'+String(detail).slice(0,160)));
};
const wait = ms => new Promise(resolve=>setTimeout(resolve,ms));

test('LOCAL_STOCK : un agent atteste puis remet au client par les vrais clics (HTTP + DB)',async({page})=>{
  expect(['KM','CM','CG']).toContain(MARKET);
  expect(RUN8).toMatch(/^[A-F0-9]{8}$/);
  expect(EXPECTED_SHA).toMatch(/^[a-f0-9]{40}$/i);
  const ref='E2E-HUB-V1-'+RUN8+'-LOCAL';
  let orderId;
  fs.mkdirSync(OUT,{recursive:true});
  try {
    const versionResponse=await page.request.get('/health/version');
    expect(versionResponse.status()).toBe(200);
    const version=await versionResponse.json();
    assert(String(version.commit||version.sha).toLowerCase()===EXPECTED_SHA.toLowerCase(),
      'staging-sha',String(version.commit||version.sha).slice(0,12));
    // La commande de recette doit disposer d'un code canonique complet.
    // Si le provisioning ne peut pas le fournir, aucun statut de remise simulé.
    const pickupCode=String(process.env.G3_PICKUP_CODE||'').toUpperCase()
      .replace(/[\s-]/g,'');
    assert(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(pickupCode),
      'pickup-code-canonical-fixture-required');
    const result=await db.query('SELECT id FROM orders WHERE reference=$1',[ref]);
    assert(result.rows.length===1,'fixture-unique',ref);
    orderId=result.rows[0].id;
    const initial=await snapshot(db,orderId);
    assert(assess(initial,'before').length===0,'fixture-no-hub-before',assess(initial,'before'));
    const permitted=new Set([
      '/api/auth/login',
      '/api/orders/'+orderId+'/local-relay-receipt',
    ]);
    page.on('pageerror',error=>record.jsErrors.push(String(error.message).slice(0,180)));
    page.on('framenavigated',frame=>{
      if(frame!==page.mainFrame())return;
      try{
        const url=new URL(frame.url());
        record.navigation.push({path:url.pathname,
          view:url.searchParams.get('view'),market:url.searchParams.get('market')});
      }catch(_){}
    });
    await page.route('**/*',route=>{
      const request=route.request(),u=new URL(request.url()),method=request.method();
      if(u.origin!==STAGING){
        // The disposable run must never reach Railway or third-party servers.
        if(ISOLATED_LOCAL){record.blockedWrites.push('EXTERNAL '+method+' '+u.origin);return route.abort('blockedbyclient');}
        return route.continue();
      }
      if(['GET','HEAD','OPTIONS'].includes(method))return route.continue();
      if(method==='POST'&&(permitted.has(u.pathname)||u.pathname==='/api/scans/collect'))
        return route.continue();
      record.blockedWrites.push(method+' '+u.pathname);return route.abort('blockedbyclient');
    });
    page.on('response',response=>{
      const u=new URL(response.url());
      if(u.origin===STAGING&&response.request().method()==='POST'&&!u.pathname.includes('/auth/login'))
        record.http.push({method:'POST',route:u.pathname.replace(orderId,':order_id'),status:response.status()});
    });
    const email=process.env.E2E_AGENT_RELAIS_EMAIL,password=process.env.E2E_AGENT_RELAIS_PASSWORD;
    assert(Boolean(email&&password),'test-role-credentials-present');
    // The login runtime owns the post-auth window.location.replace().
    // Supply its documented same-origin next parameter instead of issuing a
    // competing page.goto while that redirect is still in flight.
    const canonicalTarget='/admin/relais-live?view=execute&market='+MARKET;
    await page.goto('/login.html?next='+encodeURIComponent(canonicalTarget));
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    const login=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/login'&&r.request().method()==='POST');
    const canonicalResponse=page.waitForResponse(r=>{
      const u=new URL(r.url());
      return r.request().method()==='GET'&&u.pathname==='/admin/relais-live'&&
        u.searchParams.get('view')==='execute'&&u.searchParams.get('market')===MARKET;
    });
    await page.locator('#btn-submit').click();
    assert((await login).status()===200,'agent-login-200');
    const relayPage=await canonicalResponse;
    assert(relayPage.status()===200,'canonical-relay-navigation-200',relayPage.status());
    await page.waitForURL(u=>u.pathname==='/admin/relais-live'&&
      u.searchParams.get('view')==='execute'&&u.searchParams.get('market')===MARKET,
      {timeout:20000,waitUntil:'domcontentloaded'});
    // G3 / Kanban officiel : Flux Relais, then activate "Réception locale"
    // using the real UI queue; focus=receive alone is not a Chromium gesture.
    const workspace=page.locator('[data-workspace-mode="relay-execution"]');
    await expect(workspace).toBeVisible({timeout:25000});
    const localQueue=workspace.locator('[data-relay-execution-jump="receive"]');
    await expect(localQueue).toBeVisible({timeout:20000});
    await localQueue.click();
    await expect(workspace).toHaveAttribute('data-relay-active-operation','receive');
    await expect(localQueue).toHaveAttribute('aria-current','true');
    const localLane=workspace.locator('#relay-execution-receive');
    await expect(localLane).toBeVisible();
    assert(await workspace.locator('#relay-execution-shipments').isHidden(),
      'kanban-other-arrivals-hidden');
    const card=localLane.locator('[data-relay-local-order="'+ref+'"]');
    await expect(card).toBeVisible({timeout:25000});
    assert(await card.count()===1,'ui-direct-local-row-in-kanban');
    await page.screenshot({path:path.join(OUT,'01-before-reception.png'),fullPage:true});
    const button=card.locator('[data-workspace-action="local-relay-receipt"]');
    await expect(button).toBeVisible();
    const note='RECETTE NATIVE '+MARKET+' '+RUN8;
    const physicalProof=card.locator('[data-local-physical-proof]');
    const receiptNote=card.locator('[data-local-receipt-note]');
    const receiptPath='/api/orders/'+orderId+'/local-relay-receipt';
    const receiptRequests=[];
    page.on('request',request=>{
      if(request.method()==='POST'&&new URL(request.url()).pathname===receiptPath)
        receiptRequests.push(request.url());
    });
    // G3 : clics Chromium sans preuve physique ou sans observation = aucun POST.
    await expect(physicalProof).not.toBeChecked();
    await button.click();
    await expect(page.locator('[data-workspace-feedback]')).toContainText('Confirmez la réception physique');
    assert(receiptRequests.length===0,'receipt-no-request-without-physical-proof');
    await physicalProof.check();
    await button.click();
    await expect(page.locator('[data-workspace-feedback]')).toContainText('Confirmez la réception physique');
    assert(receiptRequests.length===0,'receipt-no-request-without-observation');
    await receiptNote.fill(note);
    page.on('dialog',d=>d.accept());
    const receiptResponse=page.waitForResponse(r=>new URL(r.url()).pathname===receiptPath&&r.request().method()==='POST');
    await button.dblclick();
    const receipt=await receiptResponse;
    assert(receiptRequests.length===1,'receipt-double-click-single-post',receiptRequests.length);
    assert(receipt.status()===200,'receipt-click-http-200',receipt.status());
    const receiptBody=await receipt.json();
    assert(receiptBody.success===true,'receipt-canonical-response');
    await expect(page.locator('[data-workspace-feedback]')).toContainText('réception physique attestée');
    const received=await snapshot(db,orderId);
    assert(assess(received,'available').length===0,'receipt-db-zero-hub',assess(received,'available'));
    const parcel=received.parcels[0];
    await page.screenshot({path:path.join(OUT,'02-reception-confirmee.png'),fullPage:true});
    // Le Comptoir Remises est indépendant du flux de réception : c'est l'écran
    // métier réel du retrait. Ne pas chercher une action dans une file cachée.
    await page.goto('/admin/relais-live?view=remises&market='+MARKET);
    await expect(page.locator('[data-workspace-mode="relay-execution"]')).toBeVisible({timeout:25000});
    await expect(page.locator('h1')).toHaveText('Remises client');
    await expect(page.locator('#relay-execution-collect')).toBeVisible();
    assert(await page.locator('#relay-execution-shipments').count()===0,'counter-no-hub-arrivals');
    const collectRow=page.locator('#relay-execution-collect tr').filter({hasText:parcel.reference});
    await expect(collectRow).toBeVisible({timeout:20000});
    // Le guichet par code ne prétend pas sélectionner le colis d'une ligne :
    // la remise canonique choisit le prochain lot valide de la commande.
    // Negatifs avec le vrai guichet : absence de secret et last4 ne font
    // jamais de POST, un code entier erroné ne modifie aucun colis.
    const codeInput=page.locator('[data-pickup-code-input]');
    const codeConfirm=page.locator('[data-pickup-code-confirm]');
    const pickupRequests=[];
    page.on('request',request=>{
      if(request.method()==='POST' &&
         new URL(request.url()).pathname==='/api/scans/collect')
        pickupRequests.push(request);
    });
    await codeConfirm.click();
    assert(pickupRequests.length===0,'pickup-missing-code-no-post');
    await codeInput.fill(pickupCode.slice(-4));
    await codeConfirm.click();
    assert(pickupRequests.length===0,'pickup-last4-no-post');
    const badCode=(pickupCode[0]==='A'?'B':'A')+pickupCode.slice(1);
    await codeInput.fill(badCode);
    const badResponse=page.waitForResponse(r=>
      new URL(r.url()).pathname==='/api/scans/collect'&&r.request().method()==='POST');
    await codeConfirm.click();
    const rejected=await badResponse;
    assert(rejected.status()>=400&&rejected.status()<500,
      'pickup-invalid-full-code-refused',rejected.status());
    const afterBadCode=await snapshot(db,orderId);
    assert(assess(afterBadCode,'available').length===0,
      'pickup-invalid-code-no-mutation',assess(afterBadCode,'available'));
    await codeInput.fill(pickupCode);
    const collectResponse=page.waitForResponse(r=>
      new URL(r.url()).pathname==='/api/scans/collect'&&r.request().method()==='POST');
    await page.locator('[data-pickup-code-confirm]').click();
    const collectedHttp=await collectResponse;
    if(collectedHttp.status()!==200){
      // Persist sanitized business rejection for the NEXT iteration; never
      // relax the expected 200 or invent a successful pickup status.
      let rejection={};
      try{rejection=await collectedHttp.json();}catch(_){}
      const code=rejection.code||rejection.error?.code||
        (typeof rejection.error==='string' ? rejection.error : 'UNKNOWN');
      record.pickup_failure={http:collectedHttp.status(),
        code:String(code).slice(0,100),
        message:String(rejection.message||rejection.error?.message||'').slice(0,160)};
      console.error('G3_PICKUP_REJECTED:'+record.pickup_failure.http+
        ':'+record.pickup_failure.code);
    }
    assert(collectedHttp.status()===200,'pickup-click-http-200',collectedHttp.status());
    const collectedBody=await collectedHttp.json();
    assert(collectedBody.parcel_reference===parcel.reference,'pickup-exact-parcel-by-code');
    await wait(350);
    const done=await snapshot(db,orderId);
    assert(assess(done,'collected').length===0,'pickup-db-zero-hub',assess(done,'collected'));
    // Verify again after both server round-trips: no delayed duplicate POST.
    assert(receiptRequests.length===1,'receipt-single-post-after-pickup',receiptRequests.length);
    assert(record.blockedWrites.length===0,'no-unexpected-write',record.blockedWrites);
    assert(record.jsErrors.length===0,'no-browser-js-error',record.jsErrors);
    await page.screenshot({path:path.join(OUT,'03-retrait-confirme.png'),fullPage:true});
    record.order_reference=ref;
    record.parcel_reference=parcel.reference;
    record.verdict='LOCAL_STOCK_RELAIS_LIVE_CLICK_PASS';
  } catch(error) {
    record.failure=String(error?.message||error).slice(0,320);
    try{const url=new URL(page.url());record.failure_navigation={
      path:url.pathname,view:url.searchParams.get('view'),market:url.searchParams.get('market')};
    }catch(_){}
    record.verdict='LOCAL_STOCK_RELAIS_LIVE_CLICK_FAIL';
    throw error;
  } finally {save();await db.pool?.end?.();}
});
