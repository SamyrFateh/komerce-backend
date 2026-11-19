/**
 * @komerce-arch-lite
 * @role chromium-staging-market-visibility-readonly-proof
 * @domain dashboard
 * @layer e2e
 * @owner backend-core
 * @purpose Prove actual market-scoped Hub, Order 360 and delegated read-only views on a pinned staging SHA.
 * @impact-areas dashboard, market-authorization, staging-only
 * @test-kind e2e @test-runner playwright @test-requires staging
 */
'use strict';
const fs=require('fs'),path=require('path');
const {test,expect}=require('@playwright/test');
const BASE='https://komerce-backend-production.up.railway.app';
const OUT=path.resolve('test-results/staging-chromium/evidence/market-visibility.json');
const CODES=['KM','CM','CG','DJ','YT'];
function apiPath(url) { try {return new URL(url).pathname;} catch {return '';} }

test('Responsable marché : Hub et Order 360 isolés, lecture seule par capability, refus tiers', async ({page},info)=>{
  test.skip(info.project.name!=='market_operator-desktop','Proof only for the real market operator account');
  const proof={role:'market_operator',result:'NOT_PROVEN',version:null,finalVersion:null,
    allowedMarkets:[],boardMarkets:[],boardOrderCount:null,order360:null,
    checkedReads:[],unauthorized:[],blockedWrites:[],jsErrors:[]};
  const save=()=>{fs.mkdirSync(path.dirname(OUT),{recursive:true});fs.writeFileSync(OUT,JSON.stringify(proof,null,2)+'\n')};
  const fetchJSON=async url=>{
    const r=await page.request.get(url,{timeout:20000});
    return {status:r.status(),body:await r.json().catch(()=>({}))};
  };
  try {
    expect(new URL(process.env.E2E_STAGING_BASE_URL||BASE).origin).toBe(BASE);
    const expected=process.env.E2E_EXPECTED_DEPLOY_SHA;
    expect(expected).toMatch(/^[a-f0-9]{40}$/);
    await page.route('**/*',route=>{
      const r=route.request(),u=new URL(r.url());
      if(u.origin!==BASE)return route.continue();
      if(['GET','HEAD','OPTIONS'].includes(r.method()) ||
         (r.method()==='POST' && u.pathname==='/api/auth/login'))return route.continue();
      proof.blockedWrites.push(r.method()+' '+u.pathname);
      return route.abort('blockedbyclient');
    });
    page.on('pageerror',error=>proof.jsErrors.push(String(error.message).slice(0,180)));
    const v=await fetchJSON('/health/version');
    expect(v.status).toBe(200);
    proof.version=v.body.commit||v.body.sha;
    expect(proof.version).toBe(expected);

    const email=process.env.E2E_MARKET_OPERATOR_EMAIL,password=process.env.E2E_MARKET_OPERATOR_PASSWORD;
    expect(Boolean(email&&password)).toBe(true);
    await page.goto('/login.html?next='+encodeURIComponent('/admin/hub'),{waitUntil:'domcontentloaded'});
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    const response=page.waitForResponse(r=>apiPath(r.url())==='/api/auth/login' && r.request().method()==='POST',{timeout:20000});
    await page.locator('#btn-submit').click();
    const login=await response;proof.loginStatus=login.status();
    expect(login.status(),'real market login must succeed, HTTP 429 is NOT green').toBe(200);
    await page.waitForURL(u=>u.pathname!=='/login.html',{timeout:18000});
    const ctx=await fetchJSON('/api/admin/dashboard/context');
    expect(ctx.status).toBe(200);
    expect(ctx.body.actor?.role).toBe('market_operator');
    expect(ctx.body.access?.mode).toBe('market');
    const allowed=ctx.body.access?.allowedMarkets||[];
    expect(allowed.length).toBeGreaterThan(0);
    expect(allowed.every(m=>/^[A-Z]{2}$/.test(m))).toBe(true);
    proof.allowedMarkets=[...allowed];

    const board=await fetchJSON('/api/hub/board');
    expect(board.status).toBe(200);
    expect(board.body.scope).toBe('HUB_GLOBAL');
    expect(board.body.audience).toBe('MARKET_SCOPED');
    expect(Array.isArray(board.body.markets)).toBe(true);
    expect(Array.isArray(board.body.orders)).toBe(true);
    proof.boardMarkets=board.body.markets;
    proof.boardOrderCount=board.body.orders.length;
    expect(board.body.markets.every(m=>allowed.includes(m)),'Hub exposed a forbidden market').toBe(true);
    expect(board.body.orders.every(o=>allowed.includes(o.market)),'Hub exposed a forbidden order').toBe(true);
    // A tangible imported order is required; empty data cannot certify the end-to-end drill.
    expect(board.body.orders.length,'No market Hub order available for Chromium proof').toBeGreaterThan(0);

    await page.goto('/admin/hub',{waitUntil:'domcontentloaded'});
    await expect(page.locator('.kmc-hub-app-title h1')).toHaveText('Hub · Mes marchés',{timeout:20000});
    await expect(page.locator('[data-hub-global-order]')).toHaveCount(board.body.orders.length,{timeout:20000});
    const own=board.body.orders.find(o=>o.reference);
    expect(Boolean(own)).toBe(true);
    const order=await fetchJSON('/api/admin/entities/orders/'+encodeURIComponent(own.reference));
    proof.order360={reference:own.reference,status:order.status,
      readOnly:order.body.purchasing?.read_only,poCount:order.body.purchasing?.purchase_orders?.length};
    expect(order.status).toBe(200);
    expect(allowed).toContain(order.body.order?.market?.code);
    expect(order.body.purchasing?.read_only).toBe(true);
    expect(Array.isArray(order.body.purchasing?.purchase_orders)).toBe(true);
    for(const po of order.body.purchasing.purchase_orders) {
      expect(po).not.toHaveProperty('supplier_order_id');
      expect(po).not.toHaveProperty('procurement_hub_ref');
    }

    await page.goto('/admin/orders/'+encodeURIComponent(own.reference),{waitUntil:'domcontentloaded'});
    await expect(page.locator('.kmc-entity-extras-summary')).toBeVisible({timeout:20000});
    await page.locator('.kmc-entity-extras-summary').click();
    await expect(page.getByText('Achats fournisseurs · suivi en lecture seule')).toBeVisible({timeout:12000});
    await expect(page.locator('a[href*="/admin/workspaces/purchasing?po="]')).toHaveCount(0);

    // For each genuinely delegated read, verify the real response and data shape.
    const endpoints=[
      {cap:'client.read',suffix:'/client-cases/disputes',key:'disputes'},
      {cap:'catalog.read',suffix:'/local-offer/services',key:'services'},
      {cap:'catalog.read',suffix:'/local-offer/physical-offers',key:'physical_offers'},
      {cap:'network.read',suffix:'/network/providers',key:'providers'}
    ];
    for(const market of allowed) {
      const caps=ctx.body.access?.delegatedCapabilities?.[market]||[];
      for(const item of endpoints) {
        if(!caps.includes(item.cap))continue;
        const url='/api/market-delegation/markets/'+market+item.suffix;
        const res=await fetchJSON(url);
        proof.checkedReads.push({market,capability:item.cap,path:item.suffix,http:res.status});
        expect(res.status,url).toBe(200);
        expect(res.body.market?.code).toBe(market);
        expect(Array.isArray(res.body[item.key])).toBe(true);
      }
    }
    expect(proof.checkedReads.length,'No delegated read views covered').toBeGreaterThan(0);

    const foreign=CODES.filter(m=>!allowed.includes(m));
    for(const market of foreign) {
      const denied=await fetchJSON('/api/market-delegation/markets/'+market+'/network/relais');
      proof.unauthorized.push({market,status:denied.status});
      expect(denied.status,'Unexpected authorized read on market '+market).toBeGreaterThanOrEqual(400);
      expect(denied.status).toBeLessThan(500);
      expect(denied.body.relais).toBeUndefined();
    }
    expect(foreign.length,'No foreign market to test').toBeGreaterThan(0);
    const final=await fetchJSON('/health/version');
    expect(final.status).toBe(200);
    proof.finalVersion=final.body.commit||final.body.sha;
    expect(proof.finalVersion).toBe(expected);
    expect(proof.jsErrors).toEqual([]);
    expect(proof.blockedWrites).toEqual([]);
    proof.result='PASS';
  } catch(error) {
    proof.result='FAIL';
    proof.error=String(error.message||error).slice(0,600);
    throw error;
  } finally {
    save();
  }
});
