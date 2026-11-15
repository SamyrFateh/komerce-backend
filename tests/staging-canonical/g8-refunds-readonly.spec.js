/**
 * @komerce-arch-lite
 * @role g8-refunds-staging-readonly-chromium
 * @domain refunds
 * @layer e2e
 * @owner backend-core
 * @purpose Real staging browser verifies G8 UI and disabled financial writes, no payout.
 * @impact-areas refunds, admin-dashboard, staging-only
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const ORIGIN = 'https://komerce-backend-production.up.railway.app';
const RESULT = path.resolve('test-results/staging-chromium/evidence/g8-refunds-readonly.json');
test.use({ screenshot:'off', video:'off', trace:'off' });

test('G8 UI: two real authenticated roles, flags OFF and zero financial writes', async ({ browser, request }, info) => {
  test.skip(info.project.name !== 'admin-desktop', 'G8 dedicated proof launches exactly one project');
  const expected = process.env.E2E_EXPECTED_DEPLOY_SHA;
  expect(expected).toMatch(/^[a-f0-9]{40}$/);
  expect(new URL(process.env.E2E_STAGING_BASE_URL).origin).toBe(ORIGIN);
  const proof = { verdict:'NOT_PROVEN', initialSha:null, finalSha:null,
    admin:false, relay:false, disabled:true, blockedWrites:0, jsErrors:0, realPayouts:0 };
  fs.mkdirSync(path.dirname(RESULT),{recursive:true});
  const save=()=>fs.writeFileSync(RESULT,JSON.stringify(proof,null,2)+'\n');

  async function sha(){
    const r=await request.get('/health/version',{timeout:18000});
    expect(r.status()).toBe(200);
    return String((await r.json()).commit||'');
  }
  async function identity(kind, role){
    const pref=kind === 'admin' ? 'E2E_ADMIN_' : 'E2E_AGENT_RELAIS_';
    const email=process.env[pref+'EMAIL'],password=process.env[pref+'PASSWORD'];
    expect(Boolean(email&&password)).toBe(true);
    const context=await browser.newContext({baseURL:ORIGIN});
    const page=await context.newPage();
    try {
      await page.route('**/*',route=>{
        const req=route.request(),u=new URL(req.url());
        if (u.origin!==ORIGIN || ['GET','HEAD','OPTIONS'].includes(req.method()) ||
           (req.method()==='POST' && u.pathname==='/api/auth/login')) return route.continue();
        proof.blockedWrites++;
        return route.abort('blockedbyclient');
      });
      page.on('pageerror',()=>{proof.jsErrors++});
      await page.goto('/login.html?next='+encodeURIComponent('/g8-remboursements.html'),
        {waitUntil:'domcontentloaded'});
      await page.locator('#email').fill(email);
      await page.locator('#password').fill(password);
      const loginResponse=page.waitForResponse(r=>
        new URL(r.url()).pathname==='/api/auth/login' && r.request().method()==='POST');
      await page.locator('#btn-submit').click();
      expect((await loginResponse).status()).toBe(200);
      const me=await page.request.get('/api/auth/me');
      expect(me.status()).toBe(200);
      expect((await me.json()).role).toBe(role);
      // Login already navigates to the requested page via next=. Await that
      // exact redirect rather than issuing a competing second page.goto.
      await page.waitForURL(url => url.pathname === '/g8-remboursements.html',
        { timeout: 20000 });
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByRole('heading',{name:'Remboursements locaux'})).toBeVisible();
      await expect(page.locator('#g8-env')).toHaveText('Parcours désactivé',{timeout:15000});
      await expect(page.locator('#g8-list .empty')).toBeVisible();
      await expect(page.locator('form')).toHaveCount(0);
      const target=kind==='admin'?'/api/admin/orders/local-refunds':'/api/relay/local-cash-refunds';
      const hold=await page.request.get(target);
      expect(hold.status()).toBe(409);
      const b=await hold.json();
      expect(String(b.code)).toContain(kind==='admin'?'LOCAL_REFUND_NOT_CERTIFIED':'LOCAL_CASH_REFUND_HANDOFF_NOT_CERTIFIED');
      expect(proof.blockedWrites).toBe(0);
      return true;
    } finally {await context.close()}
  }
  try {
    proof.initialSha=await sha();
    expect(proof.initialSha).toBe(expected);
    proof.admin=await identity('admin','admin');
    proof.relay=await identity('relay','agent_relais');
    proof.finalSha=await sha();
    expect(proof.finalSha).toBe(expected);
    expect(proof.jsErrors).toBe(0);
    expect(proof.blockedWrites).toBe(0);
    proof.verdict='G8_STAGING_DISABLED_UI_PASS';
  } finally {save();console.log('[G8-readonly] '+JSON.stringify(proof))}
});
