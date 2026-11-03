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
    commitment_authorization:'Non tracée',payment_authorization:'Non tracée',
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
  await expect(page.locator('[data-hub-admin-po="'+PO+'"]')).toContainText('Brouillon à préparer');
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
