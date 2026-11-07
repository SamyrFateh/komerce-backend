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
      remaining:'1 non reçue(s)',remaining_detail:'1 à contrôler',attention:true,
      current_phase:'Réception Hub',current_status:'Partielle · 1/2 reçus',
      current_expected:'Attendre 1 article(s) du fournisseur',current_key:'reception',
      current_detail:'Transport : 1/2 · Réception attendue : 1/2',
      stage_states:{po:'complete',supplier:'progress',reception:'warning',cartons:'complete',departure:'ready',remaining:'warning'},
      stage_notes:{departure:'Expédition préparée · remise non attestée'}},
  ],
};

test.use({ viewport:{width:1440,height:900} });

async function mount(page,role='agent_relais',search='',board=BOARD) {
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
      return route.fulfill({contentType:'application/json',body:JSON.stringify(board)});
    }
    if(url.pathname==='/api/admin/dashboard/context') {
      calls.push('UNEXPECTED_ADMIN_CONTEXT');
      return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:'should not fetch admin context'})});
    }
    return route.fulfill({status:404,body:''});
  });
  await page.goto(ORIGIN+'/admin/hub'+search);
  await expect(page.locator('[data-hub-global-order]')).toHaveCount(board.orders.length);
  return calls;
}

test.describe('Hub global sans scope marché',()=>{
  test.each(['admin','agent_hub','market_operator','agent_relais','finance','sourcing','support'])(
    '%s peut voir les commandes KM et CM sans contexte marché ni droit de mutation',async({page},role)=>{
      const calls=await mount(page,role);
      await expect(page.getByText('Toutes les commandes import · Tous les marchés')).toBeVisible();
      await expect(page.locator('[data-hub-global-order="KM-100"]')).toContainText('2 non reçue(s)');
      await expect(page.locator('[data-hub-global-order="CM-101"]')).toContainText('1 à contrôler');
      expect(calls).toEqual(['GET /api/hub/board']);
      await expect(page.locator('.kmc-market-context-select')).toHaveCount(0);
      await page.locator('[data-hub-global-order="KM-100"] [data-hub-global-stage="PO"]').click({button:'right'});
      await expect(page.locator('[data-hub-global-menu]')).toBeVisible();
      // Aucun lien universel : seule une action d'étape ou sa dépendance est admise.
      await expect(page.locator('[data-hub-global-menu] a')).toHaveCount(0);
      if(!['admin','agent_hub'].includes(role)){
        await expect(page.locator('[data-hub-global-menu]')).toContainText('Consultation seule');
      }else{
        await expect(page.locator('[data-hub-global-menu]')).toContainText('PO');
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


test.describe('Étapes physiques explicites du Hub',()=>{
  test('phase et attente se lisent à gauche, étape actuelle identifiable au clavier',async({page})=>{
    await mount(page,'agent_hub');
    const row=page.locator('[data-hub-global-order="CM-101"]');
    await expect(row).toContainText('Réception Hub · Partielle · 1/2 reçus');
    await expect(row).toContainText('Attendu : Attendre 1 article(s)');
    await expect(row).toContainText('Transport : 1/2 · Réception attendue : 1/2');
    const step=row.locator('[data-hub-global-stage="Réception"]');
    await expect(step).toHaveClass(/is-stage-current/);
    await expect(step).toContainText('À faire / suivre maintenant');
    await step.focus();
    await expect(step).toBeFocused();
  });

  test('étape verrouillée grisée, preuve consultable et aucune mutation ou réouverture',async({page})=>{
    const locked={...BOARD.orders[1],current_phase:'Transitaire',current_key:'departure',
      current_status:'Remise attestée',departure:'Remise attestée · 2/2',
      current_expected:'Attendre réception au relais',
      stage_states:{...BOARD.orders[1].stage_states,departure:'locked',remaining:'progress'},
      stage_notes:{...BOARD.orders[1].stage_notes,departure:'Remise attestée : SH-KM-1'}};
    const board={...BOARD,orders:[BOARD.orders[0],locked]};
    const calls=await mount(page,'agent_hub','',board);
    const step=page.locator('[data-hub-global-order="CM-101"] [data-hub-global-stage="Départ"]');
    await expect(step).toHaveClass(/is-stage-locked/);
    await expect(step).toContainText('Terminée · verrouillée');
    await step.click();
    const menu=page.locator('[data-hub-global-menu]');
    await expect(menu).toContainText('Remise attestée : SH-KM-1');
    await expect(menu).toContainText('Aucune réouverture');
    await expect(menu.locator('a')).toHaveCount(0);
    expect(calls).toEqual(['GET /api/hub/board']);
  });
});


test.describe('Lisibilité et fermeture du menu contextuel Hub',()=>{
  test('clic hors menu le ferme, clic à l’intérieur le conserve et Échap ferme partout',async({page})=>{
    const calls=await mount(page,'market_operator');
    const stage=page.locator('[data-hub-global-order="CM-101"] [data-hub-global-stage="Réception"]');
    const menu=page.locator('[data-hub-global-menu]');
    await stage.click();
    await expect(menu).toBeVisible();
    await expect(menu).toContainText('Étape actuelle · Réception Hub');
    await menu.locator('.kmc-hub-board-menu-title').click();
    await expect(menu).toBeVisible();
    await page.locator('.kmc-hub-global-toolbar').click();
    await expect(menu).toBeHidden();
    await stage.click({button:'right'});
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await stage.click();
    await expect(menu).toBeVisible();
    await page.getByRole('searchbox',{name:'Rechercher une commande ou un marché'}).click();
    await expect(menu).toBeHidden();
    expect(calls).toEqual(['GET /api/hub/board']);
  });

  test('la phase active et la mise en évidence sont textuelles en plus de la couleur',async({page})=>{
    await mount(page,'market_operator');
    const row=page.locator('[data-hub-global-order="CM-101"]');
    const step=row.locator('[data-hub-global-stage="Réception"]');
    await expect(step).toHaveAttribute('aria-current','step');
    await expect(step.locator('.kmc-hub-stage-primary')).toHaveText('1 / 2 reçu(s)');
    await expect(step.locator('.kmc-hub-stage-proof')).toContainText('À faire / suivre maintenant');
    await expect(row.locator('.kmc-hub-phase-title')).toContainText('Réception Hub');
  });
});


test.describe('Poste Hub optimisé pour le travail des agents',()=>{
  test('agent Hub : focus actif par défaut, six actions du Kanban visibles et navigation récupérable',async({page})=>{
    const calls=await mount(page,'agent_hub');
    const toggle=page.locator('[data-hub-focus-toggle]');
    await expect(toggle).toHaveAttribute('aria-pressed','true');
    await expect(toggle).toContainText('Réafficher la navigation');
    await expect(page.locator('body')).toHaveClass(/kmc-hub-agent-focus/);
    const width=await page.locator('#canonical-admin-root').evaluate(node=>node.getBoundingClientRect().width);
    expect(width).toBeGreaterThan(1350);
    await expect(page.locator('.kmc-hub-global-table thead th')).toHaveCount(7);
    await expect(page.locator('[data-hub-global-order="CM-101"] [data-hub-global-stage]')).toHaveCount(6);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed','false');
    await expect(page.locator('body')).not.toHaveClass(/kmc-hub-agent-focus/);
    await expect(page.locator('[data-hub-global-order]')).toHaveCount(2);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed','true');
    expect(calls).toEqual(['GET /api/hub/board']);
  });

  test('autres profils : navigation normale par défaut, plein poste activable à la demande',async({page})=>{
    await mount(page,'market_operator');
    const toggle=page.locator('[data-hub-focus-toggle]');
    await expect(toggle).toHaveAttribute('aria-pressed','false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('body')).toHaveClass(/kmc-hub-agent-focus/);
    await page.locator('[data-hub-global-order="CM-101"] [data-hub-global-stage="Réception"]').click();
    await expect(page.locator('[data-hub-global-menu]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-hub-global-menu]')).toBeHidden();
  });
});
