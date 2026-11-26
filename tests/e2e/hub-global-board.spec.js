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

async function mount(page,role='agent_relais',search='',board=BOARD,visual=false) {
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
  const params=new URLSearchParams(search);
  if(!visual && ['admin','agent_hub'].includes(role)) params.set('ux','legacy');
  await page.goto(ORIGIN+'/admin/hub'+(params.size?'?'+params.toString():''));
  if(visual) await expect(page.locator('[data-hub-po-v8]')).toBeVisible();
  else await expect(page.locator('[data-hub-global-order]')).toHaveCount(board.orders.length);
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
    await expect(page).toHaveURL(ORIGIN+'/admin/hub?ux=legacy');
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
  await expect(page).toHaveURL(ORIGIN+'/admin/hub?ux=legacy');
});

test('pilote PO : réception partielle et QR dans la cellule, sans navigation ni QR d’une autre PO',async({page})=>{
  const poId='10000000-0000-4000-8000-000000000001';
  const otherId='10000000-0000-4000-8000-000000000002';
  const alloc='20000000-0000-4000-8000-000000000001';
  let received=0,issued=false,qualityState='RECEIVED';
  const qualityWrites=[];
  const writes=[];
  const board=()=>({...BOARD,purchase_orders:[{id:poId,reference:'PO-1',market:'KM',supplier:'Fournisseur test',
    order_count:1,order_references:['KM-100'],ordered:2,expected:2,received,missing:2-received,anomalies:0,
    purchase_step:received?'received':'sent',purchase_stage:'confirmed',sent:true}]});
  await mount(page,'agent_hub','',board());
  await page.route(ORIGIN+'/api/hub/board?view=po',route=>route.fulfill({json:board()}));
  await page.route(ORIGIN+'/api/admin/workspaces/operations/market/KM/supply',route=>route.fulfill({json:{
    purchase_orders:[{id:poId},{id:otherId}],cockpit:{viewer:{role:'agent_hub'}},
    receipts:received?[{id:'30000000-0000-4000-8000-000000000001',reference:'KOM-RCV-1',state:qualityState,po_ids:[poId],qty:received,single_purchase_order:true}]:[],
    fillable:[...(received?[{allocation_id:alloc,purchase_order_id:poId,order_id:'one',quantity:received,product:'Article reçu',relais_code:'M01',source_state:qualityState}]:[]),
      {allocation_id:'20000000-0000-4000-8000-000000000002',purchase_order_id:otherId,order_id:'one',quantity:1,product:'Article autre PO'}],
  }}));
  await page.route(ORIGIN+'/api/scans/hub/receivable',route=>route.fulfill({json:{purchase_orders:[
    {purchase_order_id:poId,po_status:'confirmed',supplier:{name:'Fournisseur test'},
      lines:[{product_name:'Article test',product_sku_id:'sku1',expected_quantity:2,received_quantity:received,remaining_quantity:2-received,reception_state:received?'PARTIAL':'NOT_RECEIVED'}]},
    {purchase_order_id:otherId,po_status:'confirmed',lines:[]},
  ]}}));
  await page.route(ORIGIN+'/api/scans/hub/receive',route=>{
    writes.push(route.request().postDataJSON());received=1;return route.fulfill({json:{quarantined:false}});
  });
  await page.route(ORIGIN+'/api/admin/workspaces/operations/market/KM/supply/receipts/30000000-0000-4000-8000-000000000001/quality',route=>{
    const body=route.request().postDataJSON();qualityWrites.push(body.to_state);qualityState=body.to_state;return route.fulfill({json:{state:qualityState}});
  });
  await page.route(ORIGIN+'/api/admin/workspaces/operations/market/KM/labels/articles/'+alloc+'/issue',route=>{
    issued=true;return route.fulfill({json:{count:1}});
  });
  page.on('dialog',dialog=>dialog.accept());
  await page.locator('[data-hub-po-pilot-toggle]').click();
  const row=page.locator('[data-hub-pilot-po="'+poId+'"]');
  await row.getByText('0 / 2 reçus · 2 attendus',{exact:true}).click();
  const cell=row.locator('[data-hub-inline-reception]');
  await expect(cell.locator('[data-receive-po="'+poId+'"]')).toBeVisible();
  await expect(cell.locator('[data-receive-po="'+otherId+'"]')).toHaveCount(0);
  await expect(cell.getByText('Article autre PO')).toHaveCount(0);
  expect(writes).toHaveLength(0);
  await cell.locator('[data-receive-manual-toggle]').check();
  await cell.locator('[data-receive-manual-proof]').fill('Contrôle visuel test');
  await cell.locator('[data-receive-line="0"]').fill('1');
  await cell.getByRole('button',{name:'Enregistrer la réception'}).click();
  await expect(row.getByText('1 / 2 reçus · 1 attendus',{exact:true})).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0].contents).toEqual([{purchase_order_id:poId,product_sku_id:'sku1',quantity:1,evidence_method:'MANUAL',evidence_ref:'Contrôle visuel test'}]);
  await expect(cell.getByText('Article autre PO')).toHaveCount(0);
  await expect(cell.getByRole('button',{name:'Préparer les étiquettes'})).toHaveCount(0);
  await cell.getByRole('button',{name:'Confirmer le contenu identifié'}).click();
  await expect(cell.getByRole('button',{name:'Préparer les étiquettes'})).toHaveCount(0);
  await cell.getByRole('button',{name:'Confirmer le contrôle qualité'}).click();
  await expect(cell.getByRole('button',{name:'Préparer les étiquettes'})).toBeVisible();
  expect(qualityWrites).toEqual(['IDENTIFIED','QUALITY_CHECKED']);
  await cell.getByRole('button',{name:'Préparer les étiquettes'}).click();
  await expect(cell.getByText('1 QR article(s) disponibles à imprimer.')).toBeVisible();
  expect(issued).toBe(true);
  await expect(cell.locator('[data-hub-pdf-article-a4]')).toHaveCount(1);
  await expect(page).toHaveURL(ORIGIN+'/admin/hub?ux=legacy');
});

test('pilote PO : préparation COMBOX partagée, filtrée par relais, rail et contrôle qualité',async({page})=>{
  const poId='10000000-0000-4000-8000-000000000001', other='10000000-0000-4000-8000-000000000002';
  const boxId='20000000-0000-4000-8000-000000000001';
  let placed=false, closed=false, issued=false;
  const row=(id,po,relay,rail,product,state='QUALITY_CHECKED')=>({allocation_id:id,purchase_order_id:po,relais_id:relay,relais_code:relay,requested_transport_rail:rail,source_state:state,product,quantity:1,from_unit_id:'source-'+id,from_unit_ref:'RCV-'+id});
  const a=row('a',poId,'M01','SEA_STANDARD','Article PO 1');
  const b=row('b',other,'M01','SEA_STANDARD','Article PO 2');
  const c=row('c',poId,'M01','AIR_EXPRESS','Article aérien');
  const d=row('d',poId,'M02','SEA_STANDARD','Autre relais');
  const e=row('e',other,'M01','SEA_STANDARD','Non contrôlé','RECEIVED');
  const board={...BOARD,purchase_orders:[{id:poId,reference:'PO-1',market:'KM',supplier:'Fournisseur test',order_count:1,order_references:['KM-100'],ordered:3,expected:3,received:3,missing:0,anomalies:0,purchase_step:'received',sent:true}]};
  await mount(page,'agent_hub','',board);
  await page.route(ORIGIN+'/api/hub/board?view=po',route=>route.fulfill({json:board}));
  await page.route(ORIGIN+'/api/admin/workspaces/operations/market/KM/supply',route=>route.fulfill({json:{
    purchase_orders:[{id:poId},{id:other}],cockpit:{viewer:{role:'agent_hub'}},
    fillable:[a,...(placed?[]:[b]),c,d,e],
    boxes:[{unit_id:boxId,reference:'KOM-BOX-TEST',state:closed?'PACKED':'RECEIVED',contents:placed?[{...b,qty:1}]:[]}],
  }}));
  const writes=[];
  await page.route(ORIGIN+'/api/admin/workspaces/operations/market/KM/boxes/'+boxId+'/fill',route=>{
    writes.push(route.request().postDataJSON());placed=true;return route.fulfill({json:{ok:true}});
  });
  await page.route(ORIGIN+'/api/admin/workspaces/operations/market/KM/boxes/'+boxId+'/close',route=>{
    closed=true;return route.fulfill({json:{state:'PACKED'}});
  });
  await page.route(ORIGIN+'/api/admin/workspaces/operations/market/KM/labels/boxes/'+boxId+'/issue',route=>{
    issued=true;return route.fulfill({json:{count:1}});
  });
  await page.locator('[data-hub-po-pilot-toggle]').click();
  const po=page.locator('[data-hub-pilot-po="'+poId+'"]');
  await po.getByText('Préparation COMBOX',{exact:true}).click();
  const cell=po.locator('[data-hub-inline-combox]');
  await cell.getByLabel('Relais puis rail demandé').selectOption({label:'M01 · SEA_STANDARD'});
  let box=cell.locator('[data-hub-inline-box="'+boxId+'"]');
  await box.locator('summary').click();
  const options=box.getByLabel('Article réceptionné à placer dans KOM-BOX-TEST');
  await expect(options.locator('option')).toHaveCount(2);
  for(const excluded of ['Article aérien','Autre relais','Non contrôlé'])await expect(options.locator('option').filter({hasText:excluded})).toHaveCount(0);
  await options.selectOption({label:'Article PO 2 · M01 · 1 disponible(s) · RCV-b'});
  await box.getByLabel('Scanner la référence de la COMBOX KOM-BOX-TEST').fill('KOM-BOX-TEST');
  await box.getByLabel('Mode de preuve du scan article dans KOM-BOX-TEST').selectOption('MANUAL');
  await box.getByLabel('Preuve du constat manuel pour KOM-BOX-TEST').fill('Contrôle test');
  await box.getByRole('button',{name:'Placer l’article dans la COMBOX'}).click();
  await expect(cell.getByText('1 article(s) placé(s) dans KOM-BOX-TEST.')).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0].allocation_id).toBe('b');
  await cell.locator('[data-hub-inline-box="'+boxId+'"] summary').click();
  await cell.getByRole('button',{name:'Fermer la COMBOX'}).click();
  await expect(cell.getByText('KOM-BOX-TEST fermée et prête pour la suite.')).toBeVisible();
  await cell.locator('[data-hub-inline-box="'+boxId+'"] summary').click();
  await cell.getByRole('button',{name:'Préparer QR COMBOX'}).click();
  await expect(cell.getByText('QR COMBOX définitif prêt à imprimer.')).toBeVisible();
  expect(issued).toBe(true);
  await expect(cell.locator('[data-hub-pdf-box-a4]')).toHaveCount(1);
  await expect(page).toHaveURL(ORIGIN+'/admin/hub?ux=legacy');
});

test('pilote PO : sortie Hub, dossier et remise transitaire sur manifeste complet',async({page})=>{
  const poId='10000000-0000-4000-8000-000000000001',boxId='20000000-0000-4000-8000-000000000001';
  const ref='INT-KM-TEST',base=ORIGIN+'/api/admin/workspaces/operations/market/KM';
  const journey=ORIGIN+'/api/admin/workspaces/shipping-customs/market/KM/international/'+ref;
  const writes=[];let state='PACKED',linked=false,scanned=false,stage='hub_ready';
  const board=()=>({...BOARD,purchase_orders:[{id:poId,reference:'PO-1',market:'KM',supplier:'Fournisseur test',order_count:1,order_references:['KM-100'],ordered:2,expected:2,received:1,missing:1,anomalies:0,purchase_step:'received',sent:true,boxed_quantity:1,box_count:1,dispatched_quantity:state==='DISPATCHED'?1:0,handed_quantity:stage==='handed_over'?1:0}]});
  const box=()=>({unit_id:boxId,reference:'KOM-BOX-TEST',state,shipment_ref:linked?ref:null,shipment_stage:linked?stage:null,contents:[{purchase_order_id:poId,relais_id:'M01',relais_code:'M01',requested_transport_rail:'SEA_STANDARD',qty:1}]});
  await mount(page,'agent_hub','',board());
  await page.route(ORIGIN+'/api/hub/board?view=po',route=>route.fulfill({json:board()}));
  await page.route(base+'/supply',route=>route.fulfill({json:{purchase_orders:[{id:poId}],cockpit:{viewer:{role:'agent_hub'}},fillable:[],boxes:[box()],open_shipments:linked&&stage==='hub_ready'?[{reference:ref,box_count:1}]:[]}}));
  await page.route(base+'/boxes/'+boxId+'/advance',route=>{writes.push(['advance',route.request().postDataJSON()]);state='DISPATCHED';return route.fulfill({json:{state}});});
  await page.route(base+'/boxes/shipment',route=>{writes.push(['create',route.request().postDataJSON()]);linked=true;return route.fulfill({json:{result:{reference:ref}}});});
  await page.route(journey,route=>route.fulfill({json:{shipment:{reference:ref,stage,hub_draft:true},hub_units:[box()],events:[],charges:[]}}));
  await page.route(journey+'/box-scan',route=>{writes.push(['scan',route.request().postDataJSON()]);scanned=true;return route.fulfill({json:{ok:true}});});
  await page.route(journey+'/transition',route=>{writes.push(['handover',route.request().postDataJSON()]);if(!scanned)return route.fulfill({status:409,json:{error:'Manifeste incomplet'}});stage='handed_over';return route.fulfill({json:{result:{stage}}});});
  page.on('dialog',dialog=>dialog.accept());
  await page.locator('[data-hub-po-pilot-toggle]').click();
  const po=page.locator('[data-hub-pilot-po="'+poId+'"]');
  await po.getByText('0 / 2 remis · 0 sorti(s)',{exact:true}).click();
  const cell=po.locator('[data-hub-inline-departure]');
  await expect(cell.getByRole('button',{name:'Ouvrir le dossier d’expédition'})).toBeDisabled();
  await cell.locator('[data-hub-final-box-scan]').fill('KQ1_0123456789ABCDEF0123456789ABCDEF');
  await cell.locator('[data-hub-box-label-applied]').check();
  await cell.getByRole('button',{name:'Prêt à remettre au transitaire'}).click();
  await expect(po.getByText('0 / 2 remis · 1 sorti(s)',{exact:true})).toBeVisible();
  await cell.getByLabel('Inclure KOM-BOX-TEST').check();
  await cell.getByLabel('Référence de la nouvelle expédition').fill(ref);
  await cell.getByRole('button',{name:'Ouvrir le dossier d’expédition'}).click();
  const manifest=cell.locator('[data-hub-handover-manifest="'+ref+'"]');
  await expect(manifest).toBeVisible();
  const scan=manifest.locator('[data-journey-custody-scan="HUB_HANDOVER"]');
  await scan.locator('[name=qr_code]').fill('KQ1_0123456789ABCDEF0123456789ABCDEF');
  await scan.locator('[name=proof_ref]').fill('PREUVE-SCAN');
  await scan.locator('[name=confirmed]').selectOption('yes');
  await scan.getByRole('button',{name:'Enregistrer'}).click();
  await expect.poll(()=>writes.length).toBe(3);
  const hand=manifest.locator('[data-journey-next-task]');
  await hand.locator('[name=forwarder_name]').fill('Transitaire test');
  await hand.locator('[name=transport_mode]').selectOption('sea');
  await hand.locator('[name=proof_ref]').fill('BON-REMISE-TEST');
  await hand.getByRole('button',{name:'Enregistrer'}).click();
  await expect(po.getByText('1 / 2 remis · 1 sorti(s)',{exact:true})).toBeVisible();
  expect(writes.map(w=>w[0])).toEqual(['advance','create','scan','handover']);
  expect(writes[1][1].hub_unit_ids).toEqual([boxId]);
  expect(writes[2][1]).toMatchObject({event_type:'HUB_HANDOVER',confirmed:true,proof_ref:'PREUVE-SCAN'});
  expect(writes[3][1]).toMatchObject({to_stage:'handed_over',proof_ref:'BON-REMISE-TEST',forwarder_name:'Transitaire test',transport_mode:'sea'});
  await expect(cell.locator('[data-journey-next-task]')).toHaveCount(0);
  await expect(page).toHaveURL(ORIGIN+'/admin/hub?ux=legacy');
});

// The normal URL must exercise the new board, independently of legacy contracts.
for(const role of ['admin','agent_hub']) {
  test(role+' : Kanban PO par défaut sur URL normale, sans contexte marché',async({page})=>{
    const board={...BOARD,purchase_orders:[{id:'po-default',reference:'PO-DEFAULT',market:'KM',supplier:'Fournisseur A',order_count:1,order_references:['KAAAAAA'],ordered:2,expected:2,received:0,missing:2,purchase_step:'sent',order_lines:[]}]};
    const calls=await mount(page,role,'?market=KM',board,true);
    await expect(page).toHaveURL(ORIGIN+'/admin/hub');
    await expect(page.locator('[data-hub-po-v8-card="po-default"]')).toBeVisible();
    await expect(page.locator('[data-hub-global-order]')).toHaveCount(0);
    expect(calls).toEqual(['GET /api/hub/board?view=po','GET /api/hub/board']);
    await expect(page.locator('.kmc-market-context-select')).toHaveCount(0);
  });
}


// UX-HUB-DENSITY-01 — real canonical screen, mocked reads only.
// This certifies geometry/interaction, not physical stock writes.
for(const [width,height] of [[1280,720],[1366,768],[1920,1080]]){
 test('V3 réception compacte 30 références '+width+'x'+height,async({page})=>{
  await page.setViewportSize({width,height});
  const poId='10000000-0000-4000-8000-000000000001';
  const lines=Array.from({length:30},(_,i)=>({
    product_sku_id:'sku-'+i,product_name:i===0?'Chargeur USB-C secteur haute puissance avec câble renforcé et adaptateur international':'Article '+(i+1),
    expected_quantity:i===1?5:1,received_quantity:0,remaining_quantity:i===1?5:1,reception_state:'NOT_RECEIVED'
  }));
  const board={...BOARD,purchase_orders:[{id:poId,reference:'PO-DENSITY',market:'KM',supplier:'Fournisseur test',order_count:1,order_references:[],ordered:34,expected:34,received:0,missing:34,purchase_step:'sent',purchase_stage:'confirmed',order_lines:[]}]};
  const calls=await mount(page,'agent_hub','',board,true);
  await page.route(ORIGIN+'/api/admin/workspaces/operations/market/KM/supply',route=>route.fulfill({json:{
    purchase_orders:[{id:poId,lines:[]}],cockpit:{viewer:{role:'agent_hub'}},receipts:[],fillable:[],supplier_quality_v3_enabled:true
  }}));
  await page.route(ORIGIN+'/api/scans/hub/receivable',route=>route.fulfill({json:{purchase_orders:[{purchase_order_id:poId,lines,po_status:'confirmed',supplier:{name:'Fournisseur test'}}]}}));
  await page.route(ORIGIN+'/api/admin/workspaces/operations/market/KM/supply/receipt-checks?purchase_order_id='+poId,route=>route.fulfill({json:{eligible:true,checks:[]}}));
  await page.locator('[data-hub-po-v8-card="'+poId+'"]').click();
  const form=page.locator('[data-hub-quality-v3]');
  await expect(form).toBeVisible();
  await expect(form.locator('tbody tr[data-hub-quality-sku]')).toHaveCount(30);
  await expect(form.locator('thead')).toHaveCount(1);
  const geometry=await form.evaluate(el=>{
    const table=el.querySelector('table'),rows=[...table.querySelectorAll('tbody tr')];
    const root=document.documentElement;
    return {overflow:root.scrollWidth-root.clientWidth,tableOverflow:table.scrollWidth-table.clientWidth,
      maxRowHeight:Math.max(...rows.map(r=>r.getBoundingClientRect().height)),
      medianRowHeight:rows.map(r=>r.getBoundingClientRect().height).sort((a,b)=>a-b)[15],
      clipped:[...table.querySelectorAll('input')].filter(n=>n.getClientRects().length).some(n=>{
        const r=n.getBoundingClientRect(),cell=n.closest('td').getBoundingClientRect();
        return r.left<cell.left-1||r.right>cell.right+1;
      })};
  });
  expect(geometry.overflow).toBeLessThanOrEqual(1);
  expect(geometry.tableOverflow).toBeLessThanOrEqual(1);
  expect(geometry.medianRowHeight).toBeLessThanOrEqual(58);
  expect(geometry.maxRowHeight).toBeLessThanOrEqual(100);
  expect(geometry.clipped).toBe(false);
  const multi=form.locator('[data-hub-quality-sku="sku-1"]');
  await expect(multi.getByRole('checkbox',{name:'Quantité confirmée : Article 2'})).not.toBeChecked();
  await multi.getByRole('checkbox',{name:'Non conforme — à retourner : Article 2'}).check();
  await multi.getByRole('spinbutton',{name:'Quantité à retourner : Article 2'}).fill('1');
  await multi.getByRole('checkbox',{name:'Quantité confirmée : Article 2'}).check();
  await expect(form.getByRole('status')).toContainText('33 à emballer · 1 à retourner');
  await expect(form.getByRole('button',{name:'Valider la réception'})).toBeDisabled();
  expect(calls.filter(x=>x.startsWith('POST'))).toEqual([]);
  await page.screenshot({path:'test-results/hub-v3-density-'+width+'x'+height+'.png',fullPage:false});
 });
}
