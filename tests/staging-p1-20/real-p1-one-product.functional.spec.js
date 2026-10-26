/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires staging
 * @komerce-arch-lite
 * @role p1-one-real-product-functional-readonly
 * @domain catalog
 * @layer e2e
 * @owner backend-core
 * @purpose Test source lineage, fail-closed market price, access isolation and exact buyer API/DOM for one REAL product.
 * @impact-areas sourcing, catalog, market, pricing, boutique, staging-only
 */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {test,expect}=require('@playwright/test');
const {ORIGIN,allowedRequest}=require('./write-policy');

const SOURCE_RUN='KIR-000009';
const CANDIDATE='KSC-000177';
const PRODUCT_REF='KPR-000093';
const MARKET='KM';
const MANIFEST=path.resolve('test-results/staging-p1-20/cohort.json');

if(process.env.KOMERCE_ENV!=='staging'||
   process.env.E2E_STAGING_BASE_URL!==ORIGIN||
   process.env.E2E_P1_20_HUMAN_MODE!=='read-only'){
  throw Error('P1_FUNCTIONAL_STAGING_READ_ONLY_REQUIRED');
}

function loadRealIdentity(){
  if(!fs.existsSync(MANIFEST))throw Error('P1_FUNCTIONAL_COHORT_SNAPSHOT_REQUIRED');
  const manifest=JSON.parse(fs.readFileSync(MANIFEST,'utf8'));
  expect(manifest.target).toBe(ORIGIN);
  expect(manifest.market).toBe(MARKET);
  expect(manifest.write_count).toBe(0);
  expect(manifest.source_runs.map(x=>x.ref)).toContain(SOURCE_RUN);
  const matches=manifest.products.filter(x=>x.candidate_ref===CANDIDATE);
  expect(matches,'Identité source unique').toHaveLength(1);
  const item=matches[0];
  expect(item.source_run_ref).toBe(SOURCE_RUN);
  expect(item.global?.product_ref,'Même KPR canonique').toBe(PRODUCT_REF);
  expect(String(item.global?.product_id||''),'product_id canonique requis').not.toBe('');
  return {manifest,item};
}

async function pinnedSha(request,manifest){
  const resp=await request.get(ORIGIN+'/health/version',{timeout:15000});
  expect(resp.status()).toBe(200);
  const raw=await resp.json();
  const deployed=String(raw.commit||raw.sha||'');
  const expected=process.env.E2E_EXPECTED_DEPLOY_SHA||'';
  expect(deployed).toMatch(/^[0-9a-f]{40}$/);
  expect(deployed,'Version staging figée par le préflight').toBe(expected);
  expect(manifest.deployed_sha).toBe(deployed);
  return deployed;
}

async function buyerSnapshot(request){
  const resp=await request.get(ORIGIN+'/api/products?market=KM&limit=1000',{timeout:17000});
  expect(resp.status(),'API boutique KM').toBe(200);
  const body=await resp.json();
  expect(Array.isArray(body.products)).toBe(true);
  return body.products;
}

function findPublicProduct(products,item){
  return products.find(p=>String(p.id)===String(item.global.product_id)||
    String(p.product_ref||'')===PRODUCT_REF)||null;
}

async function browserReadOnly(page,blocked){
  await page.route('**/*',route=>{
    const req=route.request();
    const v=allowedRequest({url:req.url(),method:req.method(),area:'buyer',humanApproved:false});
    if(!v.allowed){
      blocked.push({method:req.method(),path:new URL(req.url()).pathname,reason:v.reason});
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
}

async function annotate(info,name,obj){
  await info.attach(name,{body:Buffer.from(JSON.stringify(obj,null,2)),
    contentType:'application/json'});
}

// Deliberately separate 3 verdicts: deny an invalid sale, enforce RBAC,
// and require the full positive sale readiness. Negative PASS != business GO.
test('P1-N01 · no unpriced product leaks into the public KM buyer',async({page,request},info)=>{
  const proof={test:'P1-N01',product_ref:PRODUCT_REF,candidate_ref:CANDIDATE,
    market:MARKET,verdict:'NOT_PROVEN',blocked_writes:[]};
  try{
    const {manifest,item}=loadRealIdentity();
    proof.sha=await pinnedSha(request,manifest);
    proof.source={ref:item.source_run_ref,candidate:item.candidate_ref,
      supplier_product_id:item.supplier_product_id,
      sourcing:item.sourcing,source_contract_v2:item.source_contract_v2};
    proof.catalogue=item.global;
    proof.market_state=item.market;
    const products=await buyerSnapshot(request);
    proof.buyer_api={total:products.length,found:Boolean(findPublicProduct(products,item))};
    await browserReadOnly(page,proof.blocked_writes);
    const nav=await page.goto(ORIGIN+'/boutique/?market=KM',{
      waitUntil:'domcontentloaded',timeout:30000});
    expect(nav?.status()).toBe(200);
    await expect(page.locator('#k-grid')).toBeAttached({timeout:15000});
    const card=page.locator('#k-grid [data-id="'+item.global.product_id+'"]');
    proof.dom_count=await card.count();
    if(item.market.price_status!=='LOCAL_ACTIVE'){
      expect(proof.buyer_api.found,
        'SÉCURITÉ: prix local non actif => API acheteur doit refuser le produit').toBe(false);
      // Browser still needs time to receive products; the API refusal is the
      // authoritative negative oracle, DOM is recorded separately.
      await expect(card,'SÉCURITÉ: aucune carte acheteur pour ce produit non tarifé')
        .toHaveCount(0,{timeout:10000});
      proof.verdict='EXPECTED_REFUSAL_UNPRICED_PRODUCT';
    }else{
      // When a human authorizes a price, the nominal test below owns the GO.
      proof.verdict='PRICE_ACTIVE_NEGATIVE_CASE_NOT_APPLICABLE';
    }
    expect(proof.blocked_writes).toEqual([]);
  }finally{
    await annotate(info,'p1-one-product-negative-proof.json',proof);
    const shot=await page.screenshot({fullPage:true}).catch(()=>null);
    if(shot)await info.attach('p1-one-product-buyer.png',{body:shot,contentType:'image/png'});
  }
});

test('P1-A01 · operator KM permissions and cross-market refusal',async({page,context,request},info)=>{
  const proof={test:'P1-A01',market:MARKET,verdict:'NOT_PROVEN',blocked_writes:[]};
  try{
    const {manifest,item}=loadRealIdentity();
    proof.sha=await pinnedSha(request,manifest);
    proof.product_id=item.global.product_id;
    const email=process.env.E2E_MARKET_OPERATOR_EMAIL;
    const password=process.env.E2E_MARKET_OPERATOR_PASSWORD;
    if(!email||!password)throw Error('E2E_MARKET_OPERATOR_CREDENTIALS_REQUIRED');
    const login=await context.request.post(ORIGIN+'/api/auth/login',{
      data:{email,password},timeout:15000});
    expect(login.status(),'Real auth as market operator').toBe(200);
    const me=await context.request.get(ORIGIN+'/api/auth/me');
    expect(me.status()).toBe(200);
    const actor=await me.json();
    expect(actor.role).toBe('market_operator');
    proof.actor_role=actor.role; // never log email, id, cookie or token
    const contextResponse=await context.request.get(ORIGIN+'/api/admin/dashboard/context');
    proof.context_http=contextResponse.status();
    expect(contextResponse.status()).toBe(200);
    const km=await context.request.get(ORIGIN+
      '/api/market-delegation/markets/KM/catalog/exposure');
    proof.km_http=km.status();
    expect(km.status(),'KM must be readable by its operator').toBe(200);
    const payload=await km.json();
    const exposure=Array.isArray(payload.exposure)?payload.exposure:[];
    proof.market_projection={rows:exposure.length,
      product_present:exposure.some(x=>String(x.product_id)===String(item.global.product_id))};
    const cm=await context.request.get(ORIGIN+
      '/api/market-delegation/markets/CM/catalog/exposure');
    proof.cm_http=cm.status();
    expect([401,403,404],
      'Cross-market read must be denied, no leakage 200').toContain(cm.status());
    await browserReadOnly(page,proof.blocked_writes);
    const resp=await page.goto(ORIGIN+
      '/dashboards/canonical/market-catalog.html?market=KM&product_ref='+PRODUCT_REF,{
      waitUntil:'domcontentloaded',timeout:30000});
    expect(resp?.status()).toBe(200);
    await expect(page.locator('#market-catalog-root[data-workspace-kind="market-catalog"]'))
      .toBeVisible({timeout:25000});
    proof.market_ui=(await page.locator('#market-catalog-root h1').first().innerText()).trim();
    expect(proof.market_ui).toContain('Choisir les produits du marché');
    expect(proof.blocked_writes,'No write attempt from market decision view').toEqual([]);
    proof.verdict='KM_ROLE_AND_FOREIGN_MARKET_REFUSAL_PROVED';
  }finally{
    await annotate(info,'p1-one-product-rbac-proof.json',proof);
  }
});

test('P1-P01 · same KPR must have approved local price AND buyer API + DOM',async({page,request},info)=>{
  const proof={test:'P1-P01',product_ref:PRODUCT_REF,candidate_ref:CANDIDATE,
    market:MARKET,verdict:'NOT_PROVEN',human_price_decision:'NOT_PERFORMED',blocked_writes:[]};
  try{
    const {manifest,item}=loadRealIdentity();
    proof.sha=await pinnedSha(request,manifest);
    proof.source={run:item.source_run_ref,candidate:item.candidate_ref,
      supplier_product_id:item.supplier_product_id,certified:item.gate.source_certified};
    proof.global=item.global;
    proof.market_state=item.market;
    proof.blockers=item.gate.blockers;
    const products=await buyerSnapshot(request);
    const publicProduct=findPublicProduct(products,item);
    proof.buyer_api={returned:products.length,matched:Boolean(publicProduct),
      product_id:publicProduct?.id||null,product_ref:publicProduct?.product_ref||null};
    await browserReadOnly(page,proof.blocked_writes);
    await page.goto(ORIGIN+'/boutique/?market=KM',{waitUntil:'domcontentloaded',timeout:30000});
    await expect(page.locator('#k-grid')).toBeAttached({timeout:15000});
    proof.visible_cards=await page.locator('#k-grid [data-id="'+item.global.product_id+'"]').count();
    // All business oracles must independently be true. A technical 200 is not GO.
    expect(item.gate.source_certified,'Source réelle certifiée').toBe(true);
    expect(item.gate.catalog_public_active,'Produit global effectivement actif').toBe(true);
    expect(item.gate.market_exposed,'Exposition KM explicitement ENABLED').toBe(true);
    expect(item.gate.local_price_active,
      'NO GO: activation d’un vrai prix local KM par acteur habilité encore requise').toBe(true);
    expect(publicProduct,'Produit identique dans API KM').not.toBeNull();
    await expect(page.locator('#k-grid [data-id="'+item.global.product_id+'"]'),
      'Carte du même product_id dans la boutique KM').toHaveCount(1,{timeout:20000});
    expect(proof.blocked_writes,'No buyer-side writes in audit').toEqual([]);
    proof.verdict='ONE_REAL_PRODUCT_FUNCTIONAL_SELLABILITY_PROVED';
  }finally{
    await annotate(info,'p1-one-product-positive-proof.json',proof);
    const shot=await page.screenshot({fullPage:true}).catch(()=>null);
    if(shot)await info.attach('p1-one-product-positive-buyer.png',{
      body:shot,contentType:'image/png'});
  }
});
