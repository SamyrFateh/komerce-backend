/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires staging
 * @komerce-arch-lite
 * @role staging-p1-twenty-chromium-domain-sequence
 * @domain catalog
 * @layer e2e
 * @owner backend-core
 * @purpose Prove the real Sourcing, Refinery, Global Catalog, market commercial decision and customer views for twenty identities.
 * @impact-areas sourcing, catalog, market, pricing, boutique, staging-only
 */
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {test,expect}=require('@playwright/test');
const {ORIGIN,allowedRequest}=require('./write-policy');

const MARKET='KM';
const MANIFEST=path.resolve('test-results/staging-p1-20/cohort.json');
const HUMAN=process.env.E2E_P1_20_HUMAN_MODE==='curate';
const INTERACTIVE=process.env.E2E_P1_20_INTERACTIVE==='1';

const STAGES=Object.freeze([
  {key:'01-sourcing',area:'sourcing',role:'sourcing',route:'/admin/workspaces/sourcing'},
  {key:'02-raffinerie',area:'sourcing',role:'sourcing',route:'/admin/import-runtime'},
  {key:'03-catalogue-global',area:'catalog',role:'admin',route:'/admin/workspaces/catalog'},
  {key:'04-decision-marche',area:'market',role:'market_operator',route:'/dashboards/canonical/market-catalog.html?market=KM'},
  {key:'05-prix-local',area:'pricing',role:'market_operator',route:'/admin/workspaces/pricing?market=KM'},
  {key:'06-boutique',area:'buyer',role:null,route:'/boutique/?market=KM'}
]);

function requireStagingEnv(env=process.env){
  if(env.E2E_STAGING_BASE_URL!==ORIGIN)throw Error('P1_20_STAGING_HOST_REQUIRED');
  if(env.KOMERCE_ENV!=='staging')throw Error('P1_20_STAGING_MODE_REQUIRED');
  if(env.E2E_P1_20_HUMAN_MODE && !['read-only','curate'].includes(env.E2E_P1_20_HUMAN_MODE))
    throw Error('P1_20_UNKNOWN_HUMAN_MODE');
  if(HUMAN&&!INTERACTIVE)throw Error('P1_20_CURATE_REQUIRES_MANUAL_INTERACTIVE_PAUSE');
  if(HUMAN&&env.E2E_P1_20_EXPLICIT_ACK!=='YES_P1_20_KM_HUMAN_DECISIONS')
    throw Error('P1_20_HUMAN_WRITE_ACK_MISSING');
}
requireStagingEnv();

async function verifyVersion(request){
  const response=await request.get(ORIGIN+'/health/version',{timeout:15000});
  expect(response.status()).toBe(200);
  const payload=await response.json();
  const sha=String(payload.commit||payload.sha||'');
  expect(sha).toMatch(/^[a-f0-9]{40}$/);
  const expected=String(process.env.E2E_EXPECTED_DEPLOY_SHA||'');
  expect(expected,'Déploiement non épinglé').toMatch(/^[a-f0-9]{40}$/);
  expect(sha,'Le staging a changé: campagne à arrêter').toBe(expected);
  return sha;
}

async function login(context,role){
  if(!role)return {role:'anonymous',status:200};
  const key='E2E_'+role.toUpperCase();
  const email=process.env[key+'_EMAIL'];
  const password=process.env[key+'_PASSWORD'];
  if(!email||!password)throw Error('P1_20_E2E_CREDENTIALS_MISSING_'+role);
  const response=await context.request.post(ORIGIN+'/api/auth/login',{
    data:{email,password},timeout:15000
  });
  expect(response.status(),'Login réel du rôle '+role).toBe(200);
  const me=await context.request.get(ORIGIN+'/api/auth/me');
  expect(me.status()).toBe(200);
  const actor=await me.json();
  expect(actor.role).toBe(role);
  return {role,status:200};
}

async function inspectBuyer(request,manifest){
  const response=await request.get(ORIGIN+'/api/products?market=KM&limit=1000',{
    timeout:17000
  });
  if(response.status()!==200){
    return {http:response.status(),count:0,matched:0,missing:[],
      status:'PUBLIC_API_UNAVAILABLE'};
  }
  const body=await response.json();
  expect(Array.isArray(body.products),'Boutique: JSON products[] requis').toBe(true);
  const ids=new Set(body.products.map(p=>String(p.id)));
  const matched=(manifest.products||[])
    .filter(item=>item.global?.product_id&&ids.has(String(item.global.product_id)));
  return {http:200,market:'KM',count:body.products.length,listed_ids:[...ids],
    matched:matched.length,
    missing:(manifest.products||[])
      .filter(item=>!item.global?.product_id||!ids.has(String(item.global.product_id)))
      .map(item=>({candidate_ref:item.candidate_ref,
        product_ref:item.global?.product_ref||null,
        blockers:item.gate?.blockers||[]})),
    status:matched.length===20?'BUYER_20_COHORT_ITEMS_OBSERVED':'BUYER_20_NOT_PROVED'};
}


/*
 * Explicit render oracles. A shell/sidebar and HTTP 200 are NOT evidence
 * that the business workspace finished loading.
 */
const SCREEN_ORACLES=Object.freeze({
  '01-sourcing':{
    root:'[data-workspace-kind="sourcing"]',
    heading:'h1.kmc-workspace-title',title:'Produits à qualifier',
    evidence:'.kmc-workspace-metrics'
  },
  '02-raffinerie':{
    root:'[data-cockpit-domain="imports"] .kir-page:not(.kir-loading)',
    heading:'h1',title:'Suivi d’import — Source → Catalogue',
    evidence:'.kir-main, .kir-empty-launch'
  },
  '03-catalogue-global':{
    // The canonical admin shell now renders the commercial catalogue header,
    // not the legacy kmc-workspace-title/layout.
    root:'main',
    heading:'h1',title:'Catalogue commercial',
    evidence:'h2:has-text("Catalogue global commercial")'
  },
  '04-decision-marche':{
    root:'#market-catalog-root[data-workspace-kind="market-catalog"]',
    heading:'h1.kmc-workspace-title',title:'Choisir les produits du marché',
    evidence:'[data-market-catalog-overview="decision-first-v1"]'
  },
  '05-prix-local':{
    // KM economy is exposed through the canonical "Atelier des prix" shell.
    root:'main',
    heading:'h1',title:'Atelier des prix · Comores',
    evidence:'h2:has-text("Situation économique")'
  },
  '06-boutique':{
    root:'#k-grid',
    heading:null,title:null,evidence:null
  }
});
async function verifyRenderedBusinessSurface(page,stage){
  const oracle=SCREEN_ORACLES[stage.key];
  if(!oracle)throw Error('P1_20_NO_SCREEN_ORACLE_'+stage.key);
  const root=page.locator(oracle.root).first();
  if(stage.area==='buyer'){
    // An empty #k-grid can have zero dimensions: it must be attached,
    // while the API+matching-card assertions below decide buyer readiness.
    await expect(root,'Le conteneur boutique doit exister').toBeAttached({timeout:30000});
    return {oracle:stage.key,root:oracle.root,rendered:false,
      reason:'API_AND_EXACT_DOM_CARD_PROOF_REQUIRED'};
  }
  await expect(root,'Le contenu métier '+stage.key+' doit être monté, pas seulement le shell').toBeVisible({timeout:30000});
  let heading=null;
  if(oracle.heading){
    const element=root.locator(oracle.heading).first();
    await expect(element,'Le vrai titre métier doit être visible').toContainText(oracle.title,{timeout:15000});
    heading=(await element.innerText()).trim();
  }
  if(oracle.evidence){
    await expect(root.locator(oracle.evidence).first(),
      'Une projection métier, un état vide terminal ou un état d’erreur explicite est requis'
    ).toBeVisible({timeout:30000});
  }
  return {oracle:stage.key,root:oracle.root,heading,rendered:true};
}

for(const stage of STAGES){
  test(stage.key+' · '+stage.route,async({page,context,request},info)=>{
    const observation={stage:stage.key,role:stage.role||'anonymous',
      mode:HUMAN?'HUMAN_CURATE':'READ_ONLY',
      target:stage.route,market:MARKET,
      expected_sha:process.env.E2E_EXPECTED_DEPLOY_SHA||null,
      start_sha:null,end_sha:null,actual_url:null,actual_search:null,ui_gate:null,http:null,
      writes_allowed:[],writes_blocked:[],api5xx:[],js_errors:[],
      buyer:null,visible_cards:null,verdict:'NOT_PROVEN'};
    page.on('pageerror',error=>observation.js_errors.push(error.message.slice(0,180)));
    page.on('response',response=>{
      const u=new URL(response.url());
      if(u.origin===ORIGIN && u.pathname.startsWith('/api/')&&response.status()>=500){
        observation.api5xx.push({path:u.pathname,status:response.status()});
      }
    });
    try {
      observation.start_sha=await test.step('Pinner vrai staging',()=>verifyVersion(request));
      await test.step('Ouvrir la session canonique du rôle',()=>login(context,stage.role));
      // Browser/UI traffic only. Auth and diagnostics deliberately use
      // context.request before the route is installed. Never send writes via
      // request directly in this spec.
      await page.route('**/*',async route=>{
        const req=route.request();
        const verdict=allowedRequest({url:req.url(),method:req.method(),
          area:stage.area,humanApproved:HUMAN});
        if(verdict.allowed){
          if(verdict.reason==='EXPLICIT_HUMAN_P1_GESTURE')
            observation.writes_allowed.push({
              method:req.method(),path:new URL(req.url()).pathname
            });
          return route.continue();
        }
        observation.writes_blocked.push({
          method:req.method(),path:new URL(req.url()).pathname,reason:verdict.reason
        });
        return route.abort('blockedbyclient');
      });
      await test.step('Voir le vrai propriétaire métier dans Chromium',async()=>{
        const res=await page.goto(ORIGIN+stage.route,{
          waitUntil:'domcontentloaded',timeout:30000
        });
        observation.http=res?.status()||null;
        expect(observation.http).toBe(200);
        await expect(page.locator('body')).toBeVisible({timeout:15000});
        await expect.poll(async()=>page.locator('body').innerText()
          .then(text=>text.trim().length),{timeout:15000})
          .toBeGreaterThan(60);
        const actual=new URL(page.url());
        const expected=new URL(ORIGIN+stage.route);
        observation.actual_url=actual.pathname;
        observation.actual_search=actual.search;
        expect(observation.actual_url,'L’écran doit rester sur la route métier demandée').toBe(expected.pathname);
        if(expected.searchParams.has('market')){
          expect(actual.searchParams.get('market'),'Contexte marché KM perdu').toBe(MARKET);
        }
        observation.ui_gate=await verifyRenderedBusinessSurface(page,stage);
      });
      if(stage.area==='buyer'){
        await test.step('Observer les vingt produits exacts sur le vrai marché KM',async()=>{
          if(!fs.existsSync(MANIFEST))throw Error('P1_20_SOURCE_MANIFEST_MISSING');
          const manifest=JSON.parse(fs.readFileSync(MANIFEST,'utf8'));
          observation.buyer=await inspectBuyer(request,manifest);
          // Functional negative oracle: a source lacking ANY sale gate must
          // never appear in the buyer API. Independent from the 20-product GO.
          const listed=new Set(observation.buyer.listed_ids||[]);
          const forbidden=(manifest.products||[]).filter(item=>
            item.global?.product_id&&(
              item.sourcing?.sourcing_certified!==true||
              item.global?.is_active!==true||
              item.global?.is_available!==true||
              item.global?.lifecycle_status!=='active'||
              item.market?.commercial_exposure!=='ENABLED'||
              item.market?.price_status!=='LOCAL_ACTIVE'
            ));
          const leaks=forbidden.filter(item=>listed.has(String(item.global.product_id)));
          observation.buyer.negative_gate={tested:forbidden.length,
            leaked_product_refs:leaks.map(item=>item.global.product_ref)};
          expect(leaks,'Un produit non autorisé ou sans prix actif ne doit jamais être achetable').toEqual([]);
          observation.visible_cards=await page.locator('#k-grid .k-card,#k-grid .k-promo-card').count();
          for(const entry of manifest.products||[]){
            if(!entry.global?.product_id)continue;
            const n=await page.locator('#k-grid [data-id="'+entry.global.product_id+'"]').count();
            observation.buyer.matched_dom=observation.buyer.matched_dom||0;
            if(n>0)observation.buyer.matched_dom+=1;
          }
          // The 20-product goal is not certified by seeing 20 other offers.
          expect(observation.buyer.matched,'Les 20 références du manifeste doivent apparaître dans l’API acheteur').toBe(20);
          expect(observation.buyer.matched_dom,'Les mêmes 20 références doivent apparaître en cartes').toBe(20);
        });
      }
      if(INTERACTIVE){
        await test.step('Inspection humaine sur le vrai écran (Resume pour continuer)',async()=>{
          await page.pause();
        });
      }
      await test.step('Relire version, code et effets',async()=>{
        observation.end_sha=await verifyVersion(request);
        expect(observation.end_sha).toBe(observation.start_sha);
        expect(observation.api5xx).toEqual([]);
        expect(observation.js_errors).toEqual([]);
        expect(observation.writes_blocked,
          'L’écran a tenté une écriture non autorisée, aucun GO').toEqual([]);
        observation.verdict='STAGE_SCREEN_PROVED';
      });
    }finally{
      await info.attach('p1-20-stage-proof.json',{
        body:Buffer.from(JSON.stringify(observation,null,2)),
        contentType:'application/json'
      });
      if(observation.actual_url){
        const shot=await page.screenshot({fullPage:true,timeout:12000}).catch(()=>null);
        if(shot)await info.attach('p1-20-real-screen.png',{body:shot,contentType:'image/png'});
      }
    }
  });
}
module.exports={STAGES,inspectBuyer,requireStagingEnv};
