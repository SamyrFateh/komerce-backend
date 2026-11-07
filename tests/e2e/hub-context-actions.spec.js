/**
 * @e2e hub-context-actions.spec.js
 * @feature dashboard
 * @brief Actions canoniques depuis Hub Live, états colorés, guards et confirmations.
 */
'use strict';
const fs=require('fs');
const path=require('path');
const {test,expect}=require('@playwright/test');
const ORIGIN='http://komerce.test';
const ROOT=path.join(__dirname,'..','..','public','dashboards','canonical');
const ORDER='e2e00000-0000-4000-8000-000000000001';
const PO='e2e00000-0000-4000-8000-000000000002';
const SKU='e2e00000-0000-4000-8000-000000000003';
const LINE='e2e00000-0000-4000-8000-000000000004';
const SUPPLIER='e2e00000-0000-4000-8000-000000000005';
const BOX='e2e00000-0000-4000-8000-000000000006';
const baseOrder={
  id:ORDER, reference:'KM-302',market:'KM',market_name:'Comores',
  po:'1 PO liée(s)',supplier:'Envoi à prouver',reception:'1 / 2 reçu(s)',
  cartons:'1 KOM-BOX',departure:'Pas de départ',remaining:'1 non reçue(s)',
  next_action:'Prouver l’envoi fournisseur',
  stage_states:{po:'complete',supplier:'warning',reception:'warning',cartons:'ready',departure:'muted',remaining:'warning'},
  attention:true,
};
const dossier={
  orders:[{id:ORDER,reference:'KM-302'}],
  needs:[],
  purchase_orders:[{
    id:PO,status:'notified',stage:'issued_not_sent',sent_at:null,supplier_id:SUPPLIER,
    lines:[{line_id:LINE,order_id:ORDER,product_sku_id:SKU,confirmed:2,received:1}],
  }],
  boxes:[{unit_id:BOX,reference:'KOM-BOX-302',state:'DISPATCHED',shipment_ref:null,contents:[{order_id:ORDER}]}],
  open_shipments:[{reference:'KM-SHIP-7',forwarder_name:'Transitaire test'}],
};
const receivable={
  purchase_orders:[{
    purchase_order_id:PO,lines:[{
      product_sku_id:SKU,product_name:'Chargeur',remaining_quantity:1,
    }],
  }],
};
test.use({viewport:{width:1440,height:900}});
async function mount(page,{role='agent_hub',row=baseOrder,dossierData=dossier,admin=false}={}){
  const posts=[];
  const reads=[];
  const administration={scope:'HUB_ADMINISTRATION_GLOBAL',markets:['KM'],kpis:{
    purchase_orders:1,drafts:0,to_send:1,supplier_waiting:0,payment_to_reconcile:0,
  },purchase_orders:[{id:PO,supplier:'Alpha',market:'KM',order_count:1,stage:'issued_not_sent',
    status:'notified',sent_at:null,received:1,expected:2,anomalies:0,
    commitment_authorization:'À valider',payment_authorization:'À autoriser',
    payment_evidence:'Aucune preuve de débit'}]};
  await page.route(ORIGIN+'/**',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(request.method()==='POST'){
      posts.push({url:url.pathname,body:request.postDataJSON()});
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})});
    }
    if(url.pathname==='/admin/hub')return route.fulfill({contentType:'text/html',path:path.join(ROOT,'index.html')});
    if(url.pathname.startsWith('/dashboards/canonical/')){
      const name=path.join(ROOT,url.pathname.replace('/dashboards/canonical/',''));
      return fs.existsSync(name)?route.fulfill({path:name}):route.fulfill({status:404,body:''});
    }
    if(url.pathname==='/api/auth/me')return route.fulfill({contentType:'application/json',body:JSON.stringify({role,id:'f761a3ed-0000-4000-8000-000000000001'})});
    let data;
    if(url.pathname==='/api/hub/board')data={scope:'HUB_GLOBAL',markets:['KM'],orders:[row]};
    if(url.pathname==='/api/hub/administration')data=administration;
    if(url.pathname==='/api/hub/dossier')data=dossierData;
    if(url.pathname==='/api/scans/hub/receivable')data=receivable;
    if(url.pathname==='/api/purchasing/open-lines')data={groups:[{
      supplier_id:SUPPLIER,supplier_name:'Alpha',procurement_hub_ref:'DXB-1',market_code:'KM',
      lines:[{order_id:ORDER,line_id:LINE,groupable:true}],
    }]};
    if(data){
      reads.push(url.pathname+url.search);
      return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
    }
    return route.fulfill({status:404,body:''});
  });
  await page.goto(ORIGIN+'/admin/hub?branch='+(admin?'administrative':'operations'));
  await expect(page.locator(admin?'[data-hub-admin-po]':'[data-hub-global-order]')).toHaveCount(1);
  return {posts,reads};
}


test('Départ : preuve de remise transitaire dans le Kanban, jamais au simple clic',async({page})=>{
  const row={...baseOrder,current_key:'departure',current_phase:'Départ',
    current_status:'À remettre au transitaire',next_action:'Attester la remise au transitaire',
    stage_states:{...baseOrder.stage_states,departure:'progress'}};
  const dossierData={...dossier,boxes:[{...dossier.boxes[0],
    shipment_ref:'KM-SHIP-7',shipment_stage:'hub_ready'}],
    open_shipments:[{reference:'KM-SHIP-7',box_count:1,hub_draft:true,
      forwarder_name:null,transport_mode:null}]};
  const {posts}=await mount(page,{row,dossierData});
  await page.locator('[data-hub-global-stage="Départ"]').click();
  const menu=page.locator('[data-hub-global-menu]');
  await expect(menu).toContainText('Attester la remise au transitaire · KM-SHIP-7');
  expect(posts).toHaveLength(0);
  await menu.getByRole('button',{name:/Attester la remise au transitaire/}).click();
  await menu.locator('[name="forwarder_name"]').fill('Transitaire confirmé');
  await menu.locator('[name="transport_mode"]').selectOption('sea');
  expect(posts).toHaveLength(0);
  await menu.locator('[name="proof_ref"]').fill('BORDEREAU-2026-11');
  await menu.getByRole('button',{name:'Confirmer l’opération'}).click();
  await expect.poll(()=>posts.length).toBe(1);
  expect(posts[0].url).toBe('/api/admin/workspaces/shipping-customs/market/KM/international/KM-SHIP-7/transition');
  expect(posts[0].body).toMatchObject({
    to_stage:'handed_over',proof_ref:'BORDEREAU-2026-11',
    forwarder_name:'Transitaire confirmé',transport_mode:'sea',
  });
});

test('Départ : aucune attestation in situ si composition du départ non réconciliée',async({page})=>{
  const row={...baseOrder,current_key:'departure',current_phase:'Départ',
    next_action:'Attester la remise',stage_states:{...baseOrder.stage_states,departure:'progress'}};
  const dossierData={...dossier,boxes:[{...dossier.boxes[0],
    shipment_ref:'KM-SHIP-7',shipment_stage:'hub_ready'}],
    open_shipments:[{reference:'KM-SHIP-7',box_count:2,hub_draft:true}]};
  const {posts}=await mount(page,{row,dossierData});
  await page.locator('[data-hub-global-stage="Départ"]').click();
  const menu=page.locator('[data-hub-global-menu]');
  await expect(menu).toContainText('Attester le transfert réel dans Expéditions & Douane');
  await expect(menu.getByRole('button',{name:/Attester la remise au transitaire/})).toHaveCount(0);
  expect(posts).toHaveLength(0);
});

test('action PO dans le Kanban : sourcing en place, sans achat ni mutation au simple clic',async({page})=>{
  const row={...baseOrder,po:'Sourcing requis',current_key:'po',
    current_phase:'Achats',current_status:'Bloqué · sourcing requis',
    current_expected:'Identifier le fournisseur de 2 articles',
    next_action:'Résoudre le sourcing',
    stage_states:{...baseOrder.stage_states,po:'warning'}};
  const dossierData={...dossier,needs:[],purchase_orders:[],boxes:[],
    orders:[{id:ORDER,reference:'KM-302',items:[{
      id:'abc00000-0000-4000-8000-000000000012',
      product_id:'abc00000-0000-4000-8000-000000000013',
      product:'Article test',sourcing_required:true,purchasing_missing:2,
    }]}]};
  const {posts}=await mount(page,{row,dossierData});
  await page.route('**/api/purchasing/suppliers?**',route=>route.fulfill({
    contentType:'application/json',body:JSON.stringify([]),
  }));
  const inline=page.locator('[data-hub-global-order="KM-302"] [data-hub-inline-action="po"]');
  await expect(inline).toHaveText('Créer la ligne d’achat');
  await inline.click();
  const menu=page.locator('[data-hub-global-menu]');
  await expect(menu).toHaveClass(/is-sourcing-inline/);
  await expect(menu.locator('[data-hub-sourcing-form]')).toBeVisible();
  await expect(menu).toContainText('Résoudre le sourcing · KM-302');
  await expect(menu).toContainText('La quantité à acheter est calculée');
  await expect(menu.locator('[data-sourcing-quantity]')).toContainText('2 unités');
  expect(posts).toHaveLength(0);
  await menu.locator('[data-sourcing-close]').click();
  await expect(menu).toBeHidden();
  expect(posts).toHaveLength(0);
});

test('PO déjà liée ou lecteur : aucune action de sourcing manuel inadaptée',async({page})=>{
  await mount(page,{role:'market_operator',row:{...baseOrder,
    current_key:'po',next_action:'Résoudre le sourcing',po:'Sourcing requis'}});
  await expect(page.locator('[data-hub-inline-action="po"]')).toHaveCount(0);
  await page.locator('[data-hub-global-stage="PO"]').click();
  await expect(page.locator('[data-hub-global-menu]')).toContainText('Consultation seule');
});

test('colors et prochaine action restent des faits lisibles, sans détail article',async({page})=>{
  const {posts}=await mount(page);
  const row=page.locator('[data-hub-global-order="KM-302"]');
  await expect(row.locator('[data-hub-next-action]')).toHaveText('Prouver l’envoi fournisseur');
  await expect(row.locator('[data-hub-global-stage="Fournisseur"]')).toHaveClass(/is-stage-warning/);
  await expect(row.locator('[data-hub-global-stage="Cartons"]')).toHaveClass(/is-stage-ready/);
  await expect(row.locator('[data-hub-global-stage="Réception"]')).toHaveClass(/is-stage-warning/);
  await expect(page.locator('.kmc-hub-board thead th')).toHaveCount(7);
  await expect(row).not.toContainText('Chargeur');
  expect(posts).toHaveLength(0);
  await page.screenshot({path:'test-results/hub-context-colors-1440.png',fullPage:true});
});

test('clic droit : PO, fournisseur, cartons et départ affichent des menus vraiment distincts',async({page})=>{
  const {posts}=await mount(page);
  const row=page.locator('[data-hub-global-order="KM-302"]');
  const menu=page.locator('[data-hub-global-menu]');
  await row.locator('[data-hub-global-stage="PO"]').click({button:'right'});
  await expect(menu).toContainText('PO déjà constituée');
  await expect(menu.locator('a')).toHaveCount(0);
  await expect(menu.locator('[data-hub-real-action]')).toHaveCount(0);

  await row.locator('[data-hub-global-stage="Fournisseur"]').click({button:'right'});
  await expect(menu.getByRole('button',{name:'Attester l’envoi fournisseur'})).toBeVisible();
  await expect(menu).not.toContainText('PO déjà constituée');
  await expect(menu.locator('a')).toHaveCount(0);

  await row.locator('[data-hub-global-stage="Cartons"]').click({button:'right'});
  await expect(menu).toContainText('Carton(s) présent(s)');
  await expect(menu.locator('[data-hub-real-action]')).toHaveCount(0);
  await expect(menu.locator('[data-hub-workflow-link]')).toHaveAttribute('href','/admin/workspaces/operations');

  await row.locator('[data-hub-global-stage="Départ"]').click({button:'right'});
  await expect(menu.getByRole('button',{name:/Affecter KOM-BOX-302 à un départ/})).toBeVisible();
  await expect(menu).not.toContainText('Carton(s) présent(s)');
  await expect(menu.locator('a')).toHaveCount(0);
  expect(posts).toHaveLength(0);
});

test('Administration : Engagement ne se confond pas avec Fournisseur ni Paiement',async({page})=>{
  const {posts}=await mount(page,{role:'admin',admin:true});
  const row=page.locator('[data-hub-admin-po="'+PO+'"]');
  const menu=page.locator('[data-hub-admin-menu]');
  await row.locator('[data-hub-admin-stage="Engagement"]').click({button:'right'});
  await expect(menu).toContainText('engagement');
  await expect(menu.locator('[data-hub-real-action]')).toHaveCount(0);
  await expect(menu.locator('a')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await row.locator('[data-hub-admin-stage="Fournisseur"]').click({button:'right'});
  await expect(menu.getByRole('button',{name:'Attester l’envoi fournisseur'})).toBeVisible();
  await expect(menu).not.toContainText('L’engagement se valide');
  await page.keyboard.press('Escape');
  await row.locator('[data-hub-admin-stage="Paiement"]').click({button:'right'});
  await expect(menu).toContainText('Une preuve de débit ne remplace pas');
  await expect(menu.locator('[data-hub-real-action]')).toHaveCount(0);
  expect(posts).toHaveLength(0);
});

test('fournisseur : preuve d’envoi saisie puis POST canonique seulement après confirmation',async({page})=>{
  const {posts}=await mount(page);
  await page.locator('[data-hub-global-stage="Fournisseur"]').click({button:'right'});
  const action=page.getByRole('button',{name:'Attester l’envoi fournisseur'});
  await expect(action).toBeVisible();
  expect(posts).toHaveLength(0);
  await action.click();
  await expect(page.getByText('Canal utilisé')).toBeVisible();
  await page.getByLabel('Référence fournisseur (facultative)').fill('SUP-777');
  expect(posts).toHaveLength(0);
  await page.getByRole('button',{name:'Confirmer l’opération'}).click();
  await expect.poll(()=>posts.length).toBe(1);
  expect(posts[0]).toMatchObject({url:'/api/purchasing/po/'+PO+'/sent',
    body:{channel:'whatsapp',supplier_order_id:'SUP-777'}});
});

test('réception : manifeste physique explicite, quantité 0 non recevable',async({page})=>{
  const {posts}=await mount(page);
  await page.locator('[data-hub-global-stage="Réception"]').click({button:'right'});
  await page.getByRole('button',{name:/Réceptionner un colis/}).click();
  await page.getByLabel('Référence physique du colis').fill('SUP-PKG-302');
  await page.getByRole('button',{name:'Confirmer l’opération'}).click();
  await expect(page.getByText('Renseigner au moins une quantité réellement reçue.')).toBeVisible();
  expect(posts).toHaveLength(0);
  await page.getByLabel(/Chargeur · restant 1/).fill('1');
  await page.getByRole('button',{name:'Confirmer l’opération'}).click();
  await expect.poll(()=>posts.length).toBe(1);
  expect(posts[0]).toEqual({url:'/api/scans/hub/receive',body:{
    reference:'SUP-PKG-302',contents:[{purchase_order_id:PO,product_sku_id:SKU,quantity:1}],
  }});
});

test('départ : rattacher la KOM-BOX DISPATCHED à une expédition ouverte',async({page})=>{
  const {posts}=await mount(page);
  await page.locator('[data-hub-global-stage="Départ"]').click({button:'right'});
  await page.getByRole('button',{name:/Affecter KOM-BOX-302 à un départ/}).click();
  expect(posts).toHaveLength(0);
  await page.getByRole('button',{name:'Confirmer l’opération'}).click();
  await expect.poll(()=>posts.length).toBe(1);
  expect(posts[0]).toEqual({url:'/api/hub/box/'+BOX+'/shipment',body:{shipment_reference:'KM-SHIP-7'}});
});

test('achat manuel : la constitution crée un brouillon sans soumettre ni payer',async({page})=>{
  const row={...baseOrder,po:'À constituer',supplier:'Non commandé',
    next_action:'Constituer PO',stage_states:{...baseOrder.stage_states,po:'waiting'}};
  const data={...dossier,purchase_orders:[],needs:[{order_id:ORDER,supplier_id:SUPPLIER,line_id:LINE}]};
  const {posts}=await mount(page,{row,dossierData:data});
  await page.locator('[data-hub-global-stage="PO"]').click({button:'right'});
  await page.getByRole('button',{name:/Préparer PO · Alpha/}).click();
  expect(posts).toHaveLength(0);
  await page.getByRole('button',{name:'Confirmer l’opération'}).click();
  await expect.poll(()=>posts.length).toBe(1);
  expect(posts[0]).toEqual({url:'/api/purchasing/po/prepare',body:{
    supplier_id:SUPPLIER,procurement_hub_ref:'DXB-1',line_ids:[LINE],execution_mode:'manual',
  }});
});

test('Administration : une PO transmise n’est pas une décision de la directrice',async({page})=>{
  const {posts}=await mount(page,{role:'admin',admin:true});
  await page.locator('[data-hub-admin-stage="Fournisseur"]').click({button:'right'});
  await expect(page.getByRole('button',{name:'Attester l’envoi fournisseur'})).toBeVisible();
  await expect(page.locator('[data-hub-admin-po="'+PO+'"]')).toContainText('Envoi à prouver');
  expect(posts).toHaveLength(0);
});

test('relais : aucun writer, aucun accès au dossier Hub privé',async({page})=>{
  const {posts,reads}=await mount(page,{role:'agent_relais'});
  await page.locator('[data-hub-global-stage="Fournisseur"]').click({button:'right'});
  await expect(page.locator('[data-hub-global-menu]')).toContainText('Consultation seule');
  await expect(page.locator('[data-hub-real-action]')).toHaveCount(0);
  expect(posts).toHaveLength(0);
  expect(reads).toEqual(['/api/hub/board']);
});


test('Sourcing requis : le menu PO indique la dépendance et la vraie surface de résolution',async({page})=>{
  const row={...baseOrder,po:'Sourcing requis',current_phase:'Achats',current_status:'Bloqué · sourcing requis',
    current_key:'po',current_expected:'Identifier le fournisseur de 2 articles',
    stage_states:{...baseOrder.stage_states,po:'warning'}};
  const data={...dossier,purchase_orders:[],needs:[],
    orders:[{id:ORDER,reference:'KM-302',items:[{id:'article-1',sourcing_required:true,purchasing_missing:2}]}]};
  const {posts}=await mount(page,{row,dossierData:data});
  await page.locator('[data-hub-global-stage="PO"]').click({button:'right'});
  const menu=page.locator('[data-hub-global-menu]');
  await expect(menu).toContainText('Sourcing requis : identifier un fournisseur');
  await expect(menu).toContainText('Attendu : Identifier le fournisseur de 2 articles');
  await expect(menu.locator('[data-hub-workflow-link]')).toHaveAttribute('href','/admin/workspaces/operations');
  await expect(menu.locator('[data-hub-real-action]')).toHaveCount(0);
  expect(posts).toHaveLength(0);
});

test('départ lié mais non remis : le menu distingue attestation du simple rattachement',async({page})=>{
  const row={...baseOrder,departure:'Expédition préparée · remise non attestée',current_key:'departure',
    current_phase:'Départ',current_status:'Expédition préparée',current_expected:'Attester la remise au transitaire',
    stage_states:{...baseOrder.stage_states,departure:'ready'}};
  const data={...dossier,boxes:[{...dossier.boxes[0],shipment_ref:'SH-77',shipment_stage:'hub_ready'}]};
  const {posts}=await mount(page,{row,dossierData:data});
  await page.locator('[data-hub-global-stage="Départ"]').click({button:'right'});
  const menu=page.locator('[data-hub-global-menu]');
  await expect(menu).toContainText('remise au transitaire non attestée');
  await expect(menu.locator('[data-hub-workflow-link]')).toHaveAttribute('href','/admin/workspaces/shipping-customs');
  await expect(menu.locator('[data-hub-real-action]')).toHaveCount(0);
  expect(posts).toHaveLength(0);
});

test('clic extérieur et Échap ferment aussi le menu Administration sans acte métier',async({page})=>{
  const {posts}=await mount(page,{admin:true});
  const stage=page.locator('[data-hub-admin-stage="Fournisseur"]');
  const menu=page.locator('[data-hub-admin-menu]');
  await stage.click({button:'right'});
  await expect(menu).toBeVisible();
  await page.locator('.kmc-hub-admin-toolbar').click();
  await expect(menu).toBeHidden();
  await stage.click();
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  expect(posts).toHaveLength(0);
});
