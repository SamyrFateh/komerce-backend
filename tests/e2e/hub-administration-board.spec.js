/**
 * @e2e hub-administration-board.spec.js
 * @feature dashboard
 * @brief Separate Hub administration and operations without other Live tabs,
 *        scoped writers, or fictitious purchase/payment approvals.
 */
'use strict';
const fs=require('fs');
const path=require('path');
const {test,expect}=require('@playwright/test');
const ROOT=path.join(__dirname,'..','..','public','dashboards','canonical');
const ORIGIN='http://komerce.test';
const PO1='10000000-0000-4000-8000-000000000001';
const PO2='20000000-0000-4000-8000-000000000002';
const administration={
  scope:'HUB_ADMINISTRATION_GLOBAL',markets:['KM','CM'],approval_trace_available:false,
  kpis:{purchase_orders:2,drafts:1,to_send:1,supplier_waiting:0,payment_to_reconcile:1},
  purchase_orders:[
    {id:PO1,market:'KM',supplier:'Alpha Trading',stage:'draft',order_count:3,
      received:0,expected:4,anomalies:0,sent_at:null,payment_count:0,verified_debit_count:0,
      commitment_authorization:'Non tracée',payment_authorization:'Non tracée',
      payment_evidence:'Aucune preuve de débit'},
    {id:PO2,market:'CM',supplier:'Beta Dubai',stage:'issued_not_sent',order_count:2,
      received:1,expected:3,anomalies:0,sent_at:null,payment_count:1,verified_debit_count:0,
      commitment_authorization:'Non tracée',payment_authorization:'Non tracée',
      payment_evidence:'Débit à rapprocher'},
  ],
};
const operations={scope:'HUB_GLOBAL',markets:['KM','CM'],orders:[
  {id:'one',reference:'KM-1',market:'KM',market_name:'Comores',
    po:'À constituer',supplier:'Non commandé',reception:'Non reçue',
    cartons:'À préparer',departure:'Pas de départ',remaining:'1 non reçue(s)',attention:true},
]};
test.use({viewport:{width:1440,height:900}});
async function mount(page,role='admin',branch='administrative'){
  const calls=[];
  await page.route(ORIGIN+'/**',async route=>{
    const request=route.request(),u=new URL(request.url());
    if(request.method()!=='GET'){calls.push(request.method()+' '+u.pathname);return route.fulfill({status:405,body:'readonly'});}
    if(u.pathname==='/admin/hub')return route.fulfill({contentType:'text/html',path:path.join(ROOT,'index.html')});
    if(u.pathname.startsWith('/dashboards/canonical/')){
      const file=path.join(ROOT,u.pathname.replace('/dashboards/canonical/',''));
      return fs.existsSync(file)?route.fulfill({path:file}):route.fulfill({status:404,body:''});
    }
    if(u.pathname==='/api/auth/me')return route.fulfill({contentType:'application/json',body:JSON.stringify({role,id:'f761a3ed-0000-4000-8000-000000000001'})});
    if(u.pathname==='/api/hub/administration'){
      calls.push('GET /api/hub/administration'+u.search);
      return route.fulfill({contentType:'application/json',body:JSON.stringify(administration)});
    }
    if(u.pathname==='/api/hub/board'){
      calls.push('GET /api/hub/board'+u.search);
      return route.fulfill({contentType:'application/json',body:JSON.stringify(operations)});
    }
    return route.fulfill({status:404,body:''});
  });
  await page.goto(ORIGIN+'/admin/hub?branch='+branch);
  return calls;
}

test('Admin — PO en deux marchés, tableau compact, paiement non autorisé fictivement',async({page})=>{
  const calls=await mount(page,'admin');
  await expect(page.locator('[data-hub-active-branch="administrative"]')).toBeVisible();
  await expect(page.locator('[data-hub-admin-po]')).toHaveCount(2);
  await expect(page.locator('[data-hub-admin-po="'+PO1+'"]')).toContainText('Alpha Trading');
  await expect(page.locator('[data-hub-admin-po="'+PO2+'"]')).toContainText('CM');
  await expect(page.locator('[data-hub-admin-po="'+PO2+'"]')).toContainText('Envoi à prouver');
  await expect(page.locator('.kmc-admin-domain-tabs')).toHaveCount(0);
  await expect(page.getByText('Sourcing live',{exact:true})).toHaveCount(0);
  await expect(page.getByText('Relais live',{exact:true})).toHaveCount(0);
  await expect(page.locator('[data-hub-branch]')).toHaveCount(2);
  await expect(page.getByText('Global · Tous les marchés')).toBeVisible();
  await expect(page.locator('.kmc-market-context-select')).toHaveCount(0);
  await page.locator('[data-hub-admin-po="'+PO2+'"] [data-hub-admin-stage="Engagement"]').click({button:'right'});
  await expect(page.locator('[data-hub-admin-menu]')).toBeVisible();
  await expect(page.locator('[data-hub-admin-menu] a')).toHaveAttribute('href',
    '/admin/workspaces/purchasing?po='+PO2+'&market=CM');
  await page.keyboard.press('Escape');
  await page.locator('[data-hub-admin-view="payments"]').click();
  await expect(page.locator('[data-hub-admin-po="'+PO2+'"]')).toContainText('Débit à rapprocher');
  await expect(page.locator('[data-hub-admin-po="'+PO2+'"]')).toContainText('Non tracée');
  expect(calls).toEqual(['GET /api/hub/administration']);
  await page.screenshot({path:'test-results/hub-administration-1440.png',fullPage:true});
});

test('Agent Hub voit Administration, un relais ne peut pas ouvrir cette branche',async({page})=>{
  const hubCalls=await mount(page,'agent_hub');
  await expect(page.locator('[data-hub-active-branch="administrative"]')).toBeVisible();
  expect(hubCalls).toEqual(['GET /api/hub/administration']);
  const relayCalls=await mount(page,'agent_relais');
  await expect(page.locator('[data-hub-active-branch="operations"]')).toBeVisible();
  await expect(page.locator('[data-hub-branch="administrative"]')).toHaveCount(0);
  expect(relayCalls).toEqual(['GET /api/hub/board']);
});

test('recherche locale sans requête serveur et bascule Opérations préservée',async({page})=>{
  const calls=await mount(page,'admin');
  await expect(page.locator('[data-hub-admin-po]')).toHaveCount(2);
  await page.getByRole('searchbox',{name:'Rechercher PO, fournisseur ou marché'}).fill('Alpha');
  await expect(page.locator('[data-hub-admin-po]')).toHaveCount(1);
  expect(calls).toEqual(['GET /api/hub/administration']);
  await page.locator('[data-hub-branch="operations"]').click();
  await expect(page.locator('[data-hub-global-order="KM-1"]')).toBeVisible();
});
