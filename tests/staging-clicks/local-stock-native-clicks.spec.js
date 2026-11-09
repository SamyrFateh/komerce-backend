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

const STAGING = 'https://komerce-backend-production.up.railway.app';
const MARKET = String(process.env.HTTP_RUNNER_MARKET || '').toUpperCase();
const RUN8 = String(process.env.HTTP_RUNNER_RUN8 || '').toUpperCase();
const EXPECTED_SHA = String(process.env.E2E_EXPECTED_DEPLOY_SHA || '');
const LABELS = { KM:'KM · Comores', CM:'CM · Cameroun', CG:'CG · Congo-Brazzaville' };
const OUT = path.resolve('test-results/local-stock-native-clicks');
const record = { schema:'relay-local-native-click-proof/1', market:MARKET, run8:RUN8,
  staging:STAGING, verdict:'NOT_CERTIFIED', checks:[], http:[], jsErrors:[], blockedWrites:[] };
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
    await page.route('**/*',route=>{
      const request=route.request(),u=new URL(request.url()),method=request.method();
      if(u.origin!==STAGING||['GET','HEAD','OPTIONS'].includes(method))return route.continue();
      if(method==='POST'&&(permitted.has(u.pathname)||
        /^\/api\/admin\/workspaces\/operations\/market\/[A-Z]{2}\/parcels\/[^/]+\/collect$/.test(u.pathname)))
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
    await page.goto('/login.html');
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    const login=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/login'&&r.request().method()==='POST');
    await page.locator('#btn-submit').click();
    assert((await login).status()===200,'agent-login-200');
    await page.waitForURL(u=>u.pathname!=='/login.html',{timeout:20000});
    await page.goto('/admin/relais-live?view=execute&market='+MARKET+'&focus=receive');
    const selector=page.locator('select').first();
    await selector.waitFor({timeout:20000});
    await selector.selectOption({label:LABELS[MARKET]}).catch(()=>{});
    const card=page.locator('[data-relay-local-order="'+ref+'"]');
    await expect(card).toBeVisible({timeout:25000});
    assert(await card.count()===1,'ui-direct-local-row');
    await page.screenshot({path:path.join(OUT,'01-before-reception.png'),fullPage:true});
    const button=card.locator('[data-workspace-action="local-relay-receipt"]');
    await expect(button).toBeVisible();
    const note='RECETTE NATIVE '+MARKET+' '+RUN8;
    await card.locator('[data-local-physical-proof]').check();
    await card.locator('[data-local-receipt-note]').fill(note);
    page.on('dialog',d=>d.accept());
    const receiptResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/orders/'+orderId+'/local-relay-receipt'&&r.request().method()==='POST');
    await button.click();
    const receipt=await receiptResponse;
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
    await expect(collectRow.locator('[data-workspace-action="collect"]')).toBeVisible({timeout:20000});
    const collectResponse=page.waitForResponse(r=>
      new URL(r.url()).pathname==='/api/admin/workspaces/operations/market/'+MARKET+'/parcels/'+encodeURIComponent(parcel.reference)+'/collect'
      &&r.request().method()==='POST');
    await collectRow.locator('[data-workspace-action="collect"]').click();
    const collectedHttp=await collectResponse;
    assert(collectedHttp.status()===200,'pickup-click-http-200',collectedHttp.status());
    await wait(350);
    const done=await snapshot(db,orderId);
    assert(assess(done,'collected').length===0,'pickup-db-zero-hub',assess(done,'collected'));
    assert(record.blockedWrites.length===0,'no-unexpected-write',record.blockedWrites);
    assert(record.jsErrors.length===0,'no-browser-js-error',record.jsErrors);
    await page.screenshot({path:path.join(OUT,'03-retrait-confirme.png'),fullPage:true});
    record.order_reference=ref;
    record.parcel_reference=parcel.reference;
    record.verdict='LOCAL_STOCK_RELAIS_LIVE_CLICK_PASS';
  } catch(error) {
    record.failure=String(error?.message||error).slice(0,320);
    record.verdict='LOCAL_STOCK_RELAIS_LIVE_CLICK_FAIL';
    throw error;
  } finally {save();await db.pool?.end?.();}
});
