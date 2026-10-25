/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires staging
 * @komerce-arch-lite
 * @role staging-p1-anonymous-buyer-boundary-proof
 * @domain catalog
 * @layer e2e
 * @owner backend-core
 * @purpose Verify anonymous buyer availability against the exact canonical P1 lineage, including fail-closed when local price is missing.
 * @impact-areas catalog, market, storefront, staging-only
 */
'use strict';
const {test,expect}=require('@playwright/test');
const fs=require('fs');
const path=require('path');
const host='https://komerce-backend-production.up.railway.app';
const dir=path.resolve('test-results/staging-p1');
const file=path.join(dir,'lineage.json');

test('P1 buyer gate: same product, actual KM price authority and nonempty storefront',async({page,request},testInfo)=>{
  if(!fs.existsSync(file))throw Error('P1_LINEAGE_NOT_AVAILABLE');
  const proof=JSON.parse(fs.readFileSync(file,'utf8'));
  if(proof.blocker||!proof.identity?.target_confirmed||!proof.product?.id||
     !proof.product?.product_ref||!proof.market)throw Error('P1_TARGET_OR_LINEAGE_NOT_PROVED');
  const selected=proof.market_states.find(x=>x.code===proof.market);
  if(!selected)throw Error('P1_MARKET_NOT_GROUNDED');
  const priceActive=selected.price_status==='LOCAL_ACTIVE';
  const observed={ref:proof.product.product_ref,product_id:proof.product.id,market:proof.market,
    deployed_sha:proof.deployed_sha||proof.git_sha,market_state:selected,
    buyer_http:null,public_catalog_requests:[],cards:0,product_card_count:null,
    blocked_writes:[]};
  testInfo.attach('canonical-identities',{body:Buffer.from(JSON.stringify({ref:observed.ref,market:observed.market,
    market_state:selected,priceActive},null,2)),contentType:'application/json'});
  const response=await request.get(host+'/api/products/'+encodeURIComponent(proof.product.id)+
    '?market='+encodeURIComponent(proof.market));
  observed.buyer_http=response.status();
  // No local ACTIVE price => it MUST NOT be offered as purchasable.
  if(!priceActive)expect(response.status(),'Unpriced product must fail closed to anonymous buyer').toBe(404);
  else if(proof.gates.some(g=>g.key==='STOREFRONT_PROVED'&&g.status==='PROVED'))
    expect(response.status(),'Certified public buyer endpoint must be 200').toBe(200);
  else expect(response.status(),'Unproved buyer endpoint must not silently become sellable').not.toBe(200);

  await page.route('**/*',route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin!==host||['GET','HEAD','OPTIONS'].includes(req.method()))return route.continue();
    observed.blocked_writes.push(req.method()+' '+url.pathname);
    return route.abort('blockedbyclient');
  });
  page.on('request',req=>{
    const u=new URL(req.url());
    if(u.origin===host&&u.pathname==='/api/products')
      observed.public_catalog_requests.push(u.pathname+u.search);
  });
  const html=await page.goto('/boutique/?market='+proof.market,{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(1200);
  await page.screenshot({path:testInfo.outputPath('anonymous-boutique.png'),fullPage:true});
  expect(html?.status(),'Real staging boutique HTML').toBe(200);
  expect(observed.public_catalog_requests.length,'Real boutique MUST load the market-specific catalog').toBeGreaterThan(0);
  expect(observed.public_catalog_requests.every(u=>new URL(u,host).searchParams.get('market')===proof.market),
    'No catalog API may silently bypass market filtering').toBe(true);
  observed.cards=await page.locator('#k-grid .k-card,#k-grid .k-promo-card').count();
  expect(observed.cards,'The public storefront must not be empty (positive control)').toBeGreaterThan(0);
  observed.product_card_count=await page.locator('#k-grid [data-id="'+proof.product.id+'"]').count();
  if(!priceActive)expect(observed.product_card_count,'Unpriced product must be absent from the grid').toBe(0);
  else if(response.status()===200)expect(observed.product_card_count,
    'A priced, exposed and certified product must appear in the market grid').toBeGreaterThan(0);
  expect(observed.blocked_writes,'Read-only public audit must not depend on backend writes').toEqual([]);
  await testInfo.attach('buyer-boundary-result',{
    body:Buffer.from(JSON.stringify(observed,null,2)),contentType:'application/json'
  });
});
