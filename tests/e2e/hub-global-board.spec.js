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
  for (const role of ['admin','agent_hub','market_operator','agent_relais','finance','sourcing','support']) {
    test(`${role} peut voir les commandes autorisées sans droit de mutation`,async({page})=>{
      const calls=await mount(page,role);
      await expect(page.getByText(role === 'market_operator' ? 'Commandes import · Mes marchés autorisés' : 'Toutes les commandes import · Tous les marchés')).toBeVisible();
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
    });
  }

  test('Responsable marché : écran Hub limité au scope autorisé et aucun geste physique', async ({page}) => {
    // La réponse représente la projection serveur filtrée. La SQL isolation est
    // indépendamment prouvée par tests/unit/hub-global-board.test.js.
    const marketOnly = {...BOARD, audience:'MARKET_SCOPED', markets:['KM'], orders:[BOARD.orders[0]]};
    const calls = await mount(page,'market_operator','',marketOnly);
    await expect(page.getByText('Commandes import · Mes marchés autorisés')).toBeVisible();
    await expect(page.locator('[data-hub-global-order]')).toHaveCount(1);
    await expect(page.locator('[data-hub-global-order="KM-100"]')).toBeVisible();
    await expect(page.locator('[data-hub-global-order="CM-101"]')).toHaveCount(0);
    await page.locator('[data-hub-global-order="KM-100"] [data-hub-global-stage="PO"]').click();
    await expect(page.locator('[data-hub-global-menu]')).toContainText('Consultation seule');
    expect(calls).toEqual(['GET /api/hub/board']);
  });

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

  test('la molette parcourt un long menu sans faire défiler le Kanban, puis Échap restaure le focus',async({page})=>{
    await mount(page,'market_operator');
    const stage=page.locator('[data-hub-global-order="CM-101"] [data-hub-global-stage="Réception"]');
    const menu=page.locator('[data-hub-global-menu]');
    const boardScroll=page.locator('.kmc-hub-board-scroll').first();
    await stage.click();
    await expect(menu).toBeVisible();

    // Simule un journal long sans aucune mutation métier ou requête supplémentaire.
    await menu.evaluate(el=>{
      for(let i=0;i<32;i++){
        const line=document.createElement('p');
        line.textContent='Justificatif '+(i+1);
        line.style.cssText='margin:0;min-height:30px;padding:3px 8px';
        el.appendChild(line);
      }
    });
    expect(await menu.evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
    const backgroundBefore=await boardScroll.evaluate(el=>({x:el.scrollLeft,y:el.scrollTop}));
    const rectBefore=await menu.boundingBox();
    await page.mouse.move(rectBefore.x+Math.min(30,rectBefore.width/2),rectBefore.y+Math.min(45,rectBefore.height/2));
    await page.mouse.wheel(0,480);
    await expect.poll(()=>menu.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
    const rectAfter=await menu.boundingBox();
    expect(Math.abs(rectAfter.x-rectBefore.x)).toBeLessThan(2);
    expect(Math.abs(rectAfter.y-rectBefore.y)).toBeLessThan(2);
    await page.mouse.wheel(0,4000);
    await expect(menu).toBeVisible();
    expect(await boardScroll.evaluate(el=>({x:el.scrollLeft,y:el.scrollTop}))).toEqual(backgroundBefore);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(stage).toBeFocused();
    // Une nouvelle cellule rouvre le menu depuis le haut, pas à l'ancienne position.
    await stage.click();
    await expect(menu).toBeVisible();
    expect(await menu.evaluate(el=>el.scrollTop)).toBe(0);
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


test.describe('Étapes physiques explicites du Hub',()=>{
  test('phase lisible dans le Kanban, attente et preuves dans le détail, étape actuelle accessible au clavier',async({page})=>{
    await mount(page,'agent_hub');
    const row=page.locator('[data-hub-global-order="CM-101"]');
    await expect(row).toContainText('Réception Hub · Partielle · 1/2 reçus');
    await expect(row).not.toContainText('Attendu : Attendre 1 article(s)');
    const step=row.locator('[data-hub-global-stage="Réception"]');
    await expect(step).toHaveClass(/is-stage-current/);
    await expect(step).toContainText('À faire / suivre maintenant');
    await step.focus();
    await expect(step).toBeFocused();
    await step.press('Enter');
    const menu=page.locator('[data-hub-global-menu]');
    await expect(menu).toBeVisible();
    await expect(menu).toContainText('Attendu : Attendre 1 article(s)');
    await expect(menu).toContainText('Transport : 1/2 · Réception attendue : 1/2');
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

test('Kanban : tri par relais de destination et détail contextuel non redondant',async({page})=>{
  const board={...BOARD,orders:BOARD.orders.map((o,i)=>({...o,relay_name:i?'Yaoundé Centre':'Mutsamudu Centre'}))};
  const calls=await mount(page,'market_operator','',board);
  await page.getByRole('searchbox',{name:'Rechercher une commande ou un marché'}).fill('Yaoundé');
  const row=page.locator('[data-hub-global-order="CM-101"]');
  await expect(page.locator('[data-hub-global-order]')).toHaveCount(1);
  await expect(row.locator('[data-hub-relay-destination]')).toHaveText('Relais · Yaoundé Centre');
  await expect(row).not.toContainText('Attendre 1 article(s) du fournisseur');
  await row.locator('[data-hub-global-stage="Réception"]').click();
  await expect(page.locator('[data-hub-global-menu]')).toContainText('Attendu : Attendre 1 article(s) du fournisseur');
  expect(calls).toEqual(['GET /api/hub/board']);
});

test('Kanban : le menu actif ne contient aucun formulaire métier local',async({page})=>{
  const calls=await mount(page,'agent_hub');
  await page.route(ORIGIN+'/api/hub/dossier?market=CM',route=>route.fulfill({
    contentType:'application/json',body:JSON.stringify({purchase_orders:[
      {id:'6748895a-89bf-4236-9fb0-737fcf1e59ca',lines:[{order_id:'two',received:1}]}
    ]})
  }));
  const row=page.locator('[data-hub-global-order="CM-101"]');
  await row.locator('[data-hub-global-stage="Réception"]').click();
  const menu=page.locator('[data-hub-global-menu]');
  await expect(menu).toBeVisible();
  const link=menu.getByRole('link',{name:/Ouvrir l’atelier Réception/});
  await expect(link).toHaveAttribute('href',/market=CM&atelier=reception&sel=po%3A6748895a/);
  await expect(menu.locator('[data-hub-real-action]')).toHaveCount(0);
  await expect(menu.locator('.kmc-hub-action-form')).toHaveCount(0);
  expect(calls.filter(call=>!call.startsWith('GET '))).toEqual([]);
});

test('pilote PO : engagement dans la cellule, formulaire canonique et droit serveur', async ({page})=>{
  const poId='10000000-0000-4000-8000-000000000001';
  const base={id:poId,ref:'PO-1',status:'draft',stage:'draft',step:{key:'draft'},order_ids:['one'],
    lines:[{line_id:'l1',order_id:'one',order_ref:'KM-100',product:'Article test',ordered:2,confirmed:2}],
    totals:{effective:2,missing:2,received:0},amount:{derived:true,amount:20,currency:'EUR'},
    authorizations:{commitment:null,payment:null}};
  let approved=false;
  const writes=[];
  const board=()=>({...BOARD,purchase_orders:[{id:poId,reference:'PO-1',market:'KM',supplier:'Fournisseur test',
    order_count:1,order_references:['KM-100'],ordered:2,expected:2,received:0,missing:2,anomalies:0,
    purchase_step:approved?'validation':'draft',purchase_stage:'draft'}]});
  await mount(page,'admin','',board());
  await page.route(ORIGIN+'/api/hub/board?view=po',route=>route.fulfill({json:board()}));
  await page.route(ORIGIN+'/api/admin/workspaces/operations/market/KM/supply',route=>route.fulfill({json:{
    market:{code:'KM'},orders:[],purchase_orders:[{...base,step:{key:approved?'validation':'draft'},
      authorizations:{commitment:approved?{amount:20,currency:'EUR'}:null,payment:null}}],
    cockpit:{viewer:{role:'admin',can_authorize_commitment:true,can_authorize_payment:false}},
  }}));
  await page.route(ORIGIN+'/api/purchasing/po/'+poId+'/authorize-commitment',route=>{
    writes.push(route.request().postDataJSON());
    approved=true;return route.fulfill({json:{ok:true}});
  });
  await page.locator('[data-hub-po-pilot-toggle]').click();
  const row=page.locator('[data-hub-pilot-po="'+poId+'"]');
  await row.getByText('Engagement à valider',{exact:true}).click();
  const cell=row.locator('[data-hub-inline-purchase]');
  await expect(cell.locator('[data-hlc-purchase-only]')).toBeVisible();
  await expect(cell.locator('[data-hlc-action="receive"]')).toHaveCount(0);
  await cell.locator('[data-hlc-action="authorize-commitment"]').click();
  await cell.locator('input[name="proof_ref"]').fill('JUSTIF-TEST');
  await cell.locator('[data-hlc-action="submit-commitment"]').click();
  await expect(cell.locator('[data-hlc-action="submit-po"]')).toBeVisible();
  await expect(row.getByText('Engagement validé · à soumettre',{exact:true})).toBeVisible();
  expect(writes).toEqual([{proof_ref:'JUSTIF-TEST'}]);
  await expect(page).toHaveURL(ORIGIN+'/admin/hub');
});
