'use strict';
/** @e2e Sourcing Live single operator screen. Mock-only: no Railway writes. */
const fs=require('fs');
const path=require('path');
const {test,expect}=require('@playwright/test');
const BASE=path.join(__dirname,'..','..','public','dashboards','canonical');
const ORIGIN='http://komerce.test';
const data=()=>({
  source_controls:[{
    source_ref:'api:cj',label:'CJdropshipping',state:'active',
    autopilot_enabled:true,autopilot_ready:true,activation_ready:true,
    connection:{verified:true},credential_status:'configured',
    last_capture_at:'2026-10-27T10:05:00Z',
  }],
  lots:[{run_ref:'KIR-000013',source_ref:'api:cj',provider:'CJdropshipping',
    source_total:20,business_status:'ACTION_REQUIRED'}],
  selected:{
    run_ref:'KIR-000013',provider:'CJdropshipping',source_ref:'api:cj',
    started_at:'2026-10-27T10:05:00Z',status:'RUNNING',sourcing_status:'ACTION_REQUIRED',
    accounting:{source_total:20,certified:16,catalogued:12,action_required:2},
    stages:[{key:'CERTIFICATION',status:'COMPLETED'}],
    action_items:[
      {candidate_ref:'KSC-000194',product_name:'Stain Treater',
       reason:'Catégorie économique manquante',action:'choose',correction_kind:'category'},
      {candidate_ref:'KSC-000195',product_name:'Fiche fournisseur',
       reason:'Prix d’achat manquant',action:'complete',correction_kind:'purchase_price'}
    ]
  },source_requests:[],
});
async function mount(page,payload=data(),search='?run=KIR-000013'){
 await page.route(`${ORIGIN}/**`,async route=>{
   const pathname=new URL(route.request().url()).pathname;
   if(pathname==='/admin/import-runtime') return route.fulfill({
     contentType:'text/html',
     body:`<!doctype html><html><head><meta charset="utf-8">
     <link rel="stylesheet" href="/dashboards/canonical/css/base.css">
     <link rel="stylesheet" href="/dashboards/canonical/css/import-runtime.css">
     </head><body><main id="root"></main>
     <script src="/dashboards/canonical/js/import-runtime.js"></script></body></html>`
   });
   if(pathname.startsWith('/dashboards/canonical/')){
     const file=path.join(BASE,pathname.replace('/dashboards/canonical/',''));
     return fs.existsSync(file)?route.fulfill({path:file}):route.fulfill({status:404,body:''});
   }
   return route.fulfill({status:404,body:''});
 });
 await page.setViewportSize({width:1440,height:900});
 await page.goto(ORIGIN+'/admin/import-runtime'+search);
 await page.evaluate(payload=>window.KomerceCanonicalImportRuntime.render(
   document.getElementById('root'),payload),payload);
}
test('Suivi : un seul écran, trois onglets locaux et un seul panneau visible',async({page})=>{
 await mount(page);
 await expect(page.locator('[data-sourcing-single-screen]')).toHaveCount(1);
 await expect(page.getByRole('heading',{name:'Sourcing Live'})).toHaveCount(1);
 await expect(page.locator('nav.kir-domain-nav')).toHaveCount(0);
 await expect(page.locator('[data-sourcing-tabs] a')).toHaveCount(3);
 await expect(page.locator('[data-sourcing-tab="overview"]')).toHaveAttribute('aria-current','page');
 await expect(page.locator('[data-sourcing-tab="sources"]')).toHaveAttribute('href','/admin/import-runtime?run=KIR-000013&view=sources');
 await expect(page.locator('[data-sourcing-tab="passages"]')).toHaveAttribute('href','/admin/import-runtime?run=KIR-000013&view=passages');
 await expect(page.locator('[data-sourcing-panel="overview"]')).toBeVisible();
 await expect(page.locator('[data-unified-sources]')).toBeHidden();
 await expect(page.locator('[data-unified-passages]')).toBeHidden();
 await expect(page.getByText('20',{exact:true})).toHaveCount(1);
 await expect(page.getByText('16',{exact:true})).toHaveCount(1);
 await expect(page.getByText('12',{exact:true})).toHaveCount(1);
 await expect(page.locator('[data-action-classify]')).toHaveCount(0);
 await expect(page.locator('.kir-command-bar')).toHaveCount(0);
 const dimensions=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth}));
 expect(dimensions.document).toBeLessThanOrEqual(dimensions.width+2);
});
test('les exceptions guident vers la bonne autorité métier',async({page})=>{
 await mount(page);
 await expect(page.locator('a[href="/admin/workspaces/catalog?search=KSC-000194"]')).toBeVisible();
 await expect(page.locator('a[href="/admin/workspaces/sourcing?candidate_ref=KSC-000195"]')).toBeVisible();
 await expect(page.getByRole('button',{name:'Classer'})).toHaveCount(0);
});
test('une source s’ouvre sur demande et ses commandes utilisent son identité exacte',async({page})=>{
 await mount(page,data(),'?run=KIR-000013&view=sources');
 const sources=page.locator('[data-unified-sources]');
 await expect(page.locator('[data-sourcing-tab="sources"]')).toHaveAttribute('aria-current','page');
 await expect(page.locator('[data-sourcing-panel="overview"]')).toBeHidden();
 await expect(sources).toHaveAttribute('open','');
 await expect(sources.locator('[data-source-card="api:cj"]')).toBeVisible();
 await expect(sources.locator('[data-source-command="update"][data-source-ref="api:cj"]')).toBeVisible();
 await expect(sources.locator('[data-add-source]')).toBeVisible();
 await expect(sources.getByText('Mettre à jour maintenant')).toHaveCount(0);
});
test('la source non identifiée n’hérite jamais d’un lien KIR deviné',async({page})=>{
 const payload=data();payload.selected.source_ref=null;payload.lots[0].source_ref=null;
 await mount(page,payload,'?run=KIR-000013&view=sources');
 const sources=page.locator('[data-unified-sources]');
 await expect(sources.locator('[data-source-card="api:cj"]')).toBeVisible();
 await expect(sources.locator('[data-source-card="api:cj"] .kir-source-follow')).toHaveCount(0);
});
test('Passages : onglet actif, historique visible sans second cockpit',async({page})=>{
 await mount(page,data(),'?view=passages');
 await expect(page.locator('[data-sourcing-single-screen]')).toHaveCount(1);
 await expect(page.locator('[data-unified-passages]')).toHaveAttribute('open','');
 await expect(page.locator('[data-sourcing-tab="passages"]')).toHaveAttribute('aria-current','page');
 await expect(page.locator('[data-sourcing-panel="overview"]')).toBeHidden();
 await expect(page.locator('[data-unified-sources]')).toBeHidden();
 await expect(page.locator('nav.kir-domain-nav')).toHaveCount(0);
});

test('ancien lien de remise KIR mène au Suivi sans page technique concurrente',async({page})=>{
 await mount(page,data(),'?run=KIR-000013&view=handoff');
 await expect(page.locator('[data-sourcing-panel="overview"]')).toBeVisible();
 await expect(page.locator('[data-sourcing-tab="overview"]')).toHaveAttribute('aria-current','page');
 await expect(page.locator('.kir-drill-head')).toHaveCount(0);
 await expect(page.getByText('Examiner la remise')).toHaveCount(0);
 await expect(page.locator('.kir-one-metrics')).toBeVisible();
});


// Mounted proof: real history.pushState/popstate and async cockpit refresh, API mocked.
async function mountNavigable(page,payload=data(),search='?run=KIR-000013') {
 await mount(page,payload,search);
 await page.route('**/api/admin/workspaces/sourcing/import-cockpit?*', route =>
   route.fulfill({contentType:'application/json',body:JSON.stringify(payload)}));
 await page.route('**/api/admin/workspaces/sourcing/import-passages?*', route =>
   route.fulfill({contentType:'application/json',body:JSON.stringify({
     passages:payload.lots,offset:0,next_offset:null
   })}));
 await page.evaluate(() => window.KomerceCanonicalImportRuntime.mount({
   root:document.getElementById('root')
 }));
}

test('onglets navigables : Suivi → Sources → Passages → Back conserve le KIR et son contexte',async({page})=>{
 await mountNavigable(page);
 await page.locator('[data-sourcing-tab="sources"]').click();
 await expect(page).toHaveURL(/run=KIR-000013&view=sources/);
 await expect(page.locator('[data-unified-sources]')).toBeVisible();
 await expect(page.locator('[data-sourcing-panel="overview"]')).toBeHidden();
 await page.locator('[data-sourcing-tab="passages"]').click();
 await expect(page).toHaveURL(/run=KIR-000013&view=passages/);
 await expect(page.locator('[data-unified-passages]')).toBeVisible();
 await expect(page.locator('.kir-one-passage-list')).toContainText('KIR-000013');
 await page.goBack();
 await expect(page.locator('[data-sourcing-tab="sources"]')).toHaveAttribute('aria-current','page');
 await expect(page.locator('[data-unified-sources]')).toBeVisible();
 await expect(page.locator('[data-unified-passages]')).toBeHidden();
});

test('deep-link historique handoff : URL normalisée et aucun appel de population',async({page})=>{
 await mountNavigable(page,data(),'?run=KIR-000013&view=handoff');
 await expect(page).toHaveURL(/\/admin\/import-runtime\?run=KIR-000013$/);
 await expect(page.locator('[data-sourcing-tab="overview"]')).toHaveAttribute('aria-current','page');
 await expect(page.locator('.kir-drill-head')).toHaveCount(0);
 await expect(page.locator('[data-sourcing-panel="overview"]')).toBeVisible();
});
