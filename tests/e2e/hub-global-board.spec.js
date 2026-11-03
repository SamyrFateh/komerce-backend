/**
 * @e2e hub-global-board.spec.js
 * @feature dashboard + logistics
 * @brief Central Hub all markets, all internal roles; readable without market context.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const CANONICAL = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical');
const ORIGIN = 'http://komerce.test';
const BOARD = {
  scope:'HUB_GLOBAL', markets:['KM','CM'],
  orders:[
    {id:'one',reference:'KM-100',market:'KM',market_name:'Comores',
      po:'À constituer',supplier:'Non commandé',reception:'Non reçue',
      cartons:'À préparer',departure:'Pas de départ',remaining:'2 non reçue(s)',
      remaining_detail:'2 à acheter',attention:true},
    {id:'two',reference:'CM-101',market:'CM',market_name:'Cameroun',
      po:'1 PO liée(s)',supplier:'Attente fournisseur',reception:'1 / 2 reçu(s)',
      cartons:'1 KOM-BOX',departure:'1 expédition(s) liée(s)',
      remaining:'1 non reçue(s)',remaining_detail:'1 à contrôler',attention:true},
  ],
};

test.use({ viewport:{width:1440,height:900} });

async function mount(page,role='agent_relais',search='') {
  const calls=[];
  await page.route(ORIGIN+'/**', async route=>{
    const req=route.request(),url=new URL(req.url());
    if(req.method()!=='GET') { calls.push(req.method()+' '+url.pathname); return route.fulfill({status:405,body:'readonly'}); }
    if(url.pathname==='/admin/hub') return route.fulfill({contentType:'text/html',path:path.join(CANONICAL,'index.html')});
    if(url.pathname.startsWith('/dashboards/canonical/')) {
      const file=path.join(CANONICAL,url.pathname.replace('/dashboards/canonical/',''));
      return fs.existsSync(file)?route.fulfill({path:file}):route.fulfill({status:404,body:''});
    }
    if(url.pathname==='/api/auth/me') return route.fulfill({contentType:'application/json',body:JSON.stringify({role,id:'f761a3ed-0000-4000-8000-000000000001'})});
    if(url.pathname==='/api/hub/board') {
      calls.push('GET /api/hub/board'+url.search);
      return route.fulfill({contentType:'application/json',body:JSON.stringify(BOARD)});
    }
    if(url.pathname==='/api/admin/dashboard/context') {
      calls.push('UNEXPECTED_ADMIN_CONTEXT');
      return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:'should not fetch admin context'})});
    }
    return route.fulfill({status:404,body:''});
  });
  await page.goto(ORIGIN+'/admin/hub'+search);
  await expect(page.locator('[data-hub-global-order]')).toHaveCount(2);
  return calls;
}

test.describe('Hub global sans scope marché',()=>{
  test.each(['admin','agent_hub','market_operator','agent_relais','finance','sourcing','agent_transitaire','support'])(
    '%s peut voir les commandes KM et CM sans contexte marché ni droit de mutation',async({page},role)=>{
      const calls=await mount(page,role);
      await expect(page.getByText('Toutes les commandes import · Tous les marchés')).toBeVisible();
      await expect(page.locator('[data-hub-global-order="KM-100"]')).toContainText('2 non reçue(s)');
      await expect(page.locator('[data-hub-global-order="CM-101"]')).toContainText('1 à contrôler');
      expect(calls).toEqual(['GET /api/hub/board']);
      await expect(page.locator('.kmc-market-context-select')).toHaveCount(0);
      await page.locator('[data-hub-global-order="KM-100"] [data-hub-global-stage="PO"]').click({button:'right'});
      await expect(page.locator('[data-hub-global-menu]')).toBeVisible();
      if(['admin','agent_hub'].includes(role)){
        await expect(page.locator('[data-hub-global-menu] a').first())
          .toHaveAttribute('href','/admin/hub-live?view=execute&market=KM');
      }else{
        await expect(page.locator('[data-hub-global-menu] a')).toHaveCount(0);
        await expect(page.locator('[data-hub-global-menu]')).toContainText('Consultation seule');
      }
      expect(calls).toEqual(['GET /api/hub/board']);
    }
  );

  test('une URL héritée ?market=KM ne filtre pas le Hub et est nettoyée',async({page})=>{
    const calls=await mount(page,'agent_hub','?market=KM');
    await expect(page).toHaveURL(ORIGIN+'/admin/hub');
    await expect(page.locator('[data-hub-global-order]')).toHaveCount(2);
    expect(calls).toEqual(['GET /api/hub/board']);
    await page.screenshot({path:'test-results/hub-global-board-1440.png',fullPage:true});
  });

  test('le filtre est purement visuel et ne relance pas les lectures serveur',async({page})=>{
    const calls=await mount(page,'market_operator');
    await page.getByRole('searchbox',{name:'Rechercher une commande ou un marché'}).fill('CM');
    await expect(page.locator('[data-hub-global-order]')).toHaveCount(1);
    await expect(page.locator('[data-hub-global-order="CM-101"]')).toBeVisible();
    expect(calls).toEqual(['GET /api/hub/board']);
  });
});
