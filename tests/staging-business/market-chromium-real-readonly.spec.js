/**
 * @komerce-arch-lite
 * @role staging-five-market-chromium-readiness
 * @domain dashboard
 * @layer e2e
 * @owner backend-core
 * @purpose Real staging role+market browser checks without mocked business APIs.
 * @impact-areas staging-only, market, auth
 */
'use strict';
const {test,expect}=require('@playwright/test');
const {MARKET_PROOFS,CODES}=require('../staging-canonical/market-business-proof-matrix');
const BASE=process.env.E2E_STAGING_BASE_URL||process.env.STAGING_BASE_URL;
function account(code){
  const roleAccount=MARKET_PROOFS[code].roleAccount;
  return {email:process.env[`E2E_MARKET_OPERATOR_${roleAccount}_EMAIL`],
    password:process.env[`E2E_MARKET_OPERATOR_${roleAccount}_PASSWORD`]};
}
async function login(page, email, password){
  if(!BASE||!/^https:\/\//.test(BASE))throw Error('STAGING_HTTPS_BASE_REQUIRED');
  if(!email||!password)throw Error('E2E_MARKET_TEST_IDENTITY_MISSING (L10 invitations must be activated)');
  await page.goto(BASE+'/login.html?next='+encodeURIComponent('/admin/operations'),{waitUntil:'domcontentloaded'});
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  const response=page.waitForResponse(r=>r.url().endsWith('/api/auth/login')&&r.request().method()==='POST');
  await page.locator('#btn-submit').click();
  expect((await response).status()).toBe(200);
  await page.waitForURL(url=>url.pathname!=='/login.html');
}
for(const code of CODES){
  test(`${code} : session opérateur marché, données réelles et isolation serveur`,async({page})=>{
    const meta=MARKET_PROOFS[code],errors=[];
    page.on('pageerror',e=>errors.push(String(e.message).slice(0,160)));
    const credentials=account(code);
    await login(page,credentials.email,credentials.password);
    const version=await page.request.get(BASE+'/health/version');
    expect(version.ok()).toBe(true);
    const ver=await version.json();const sha=ver.sha||ver.commit;
    expect(sha).toBeTruthy();
    if(process.env.E2E_EXPECTED_DEPLOY_SHA)
      expect(String(sha).startsWith(process.env.E2E_EXPECTED_DEPLOY_SHA.slice(0,8))).toBe(true);
    const response=await page.request.get(BASE+'/api/admin/dashboard/context');
    expect(response.ok()).toBe(true);
    const context=await response.json();
    const allowed=context.access?.allowedMarkets||[];
    expect(context.actor?.role).toBe('market_operator');
    expect(allowed).toContain(code);
    for(const other of CODES.filter(m=>!meta.marketGroup.includes(m))){
      const forbidden=await page.request.get(BASE+'/api/admin/dashboard/unified/market/'+other);
      expect(forbidden.ok(),`le rôle ${code} ne peut lire ${other}`).toBe(false);
    }
    for(const surface of ['/admin/operations','/admin/orders','/admin/finance']){
      const response=await page.goto(BASE+surface+'?market='+code,{waitUntil:'domcontentloaded'});
      expect(response.status()).toBe(200);
      await expect(page.locator('body')).not.toBeEmpty();
      const sc=page.viewportSize()?.width||1440;
      await page.screenshot({path:test.info().outputPath(`${code}-${surface.split('/').pop()}-${sc}.png`),fullPage:true});
    }
    expect(errors).toEqual([]);
  });
}
