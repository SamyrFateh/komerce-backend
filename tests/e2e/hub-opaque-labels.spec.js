/**
 * @e2e   hub-opaque-labels.spec.js
 * @feature dashboard (Hub Live · étiquettes articles/COMBOX)
 * @brief Chromium réel + API simulée : impression, refus du scan implicite,
 *        caméra simulée et geste explicite. Aucun staging ni matériel revendiqué.
 */
'use strict';
const fs=require('fs'),path=require('path');
const {test,expect}=require('@playwright/test');
const {shapeDossier}=require('./fixtures/hub-cockpit-shape');
const CANONICAL=path.join(__dirname,'..','..','public','dashboards','canonical');
const FX=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures','pricing-atelier-km.json'),'utf8'));
const ORIGIN='http://komerce.test';
const API='/api/admin/workspaces/operations/market/KM';
const ALLOCATION='11111111-1111-4111-8111-111111111111';
const BOX='22222222-2222-4222-8222-222222222222';
const RELAY='33333333-3333-4333-8333-333333333333';
const SUPPLIER_UNIT='44444444-4444-4444-8444-444444444444';
const QR='KQ1_'+'A'.repeat(32);
const WORKSPACE={
  scope:{code:'KM',name:'Comores'},
  summary:{hub_to_order:0,hub_unassigned:0,hub_to_ship:0,relay_cash_pending:0,
    relay_to_receive:0,relay_to_collect:0,inventory_to_assign:0},
  queues:{hub:{to_order:[],to_ship:[]},relay:{cash_pending:[],to_receive:[],to_collect:[]}},
  distribution:{unassigned:[]},inventory:{items:[],open_parcels:[]},
};
const DOSSIER={
  market:{id:'m1',code:'KM',name:'Comores'},
  kpis:{orders_waiting:0,qty_missing:0,boxes_open:1,boxes_unshipped:1},
  orders:[],purchase_orders:[],client_parcels:[],needs:[],receipts:[],
  to_handle:[],open_shipments:[],
  boxes:[{unit_id:BOX,reference:'KOM-BOX-TEST',state:'RECEIVED',shipment_ref:null,contents:[]}],
  fillable:[{allocation_id:ALLOCATION,from_unit_id:SUPPLIER_UNIT,from_unit_ref:'SUP-TEST',
    order_id:'55555555-5555-4555-8555-555555555555',
    order_ref:'CM-YA01-B7Q01',relais_id:RELAY,relais_code:'YA01',
    product:'Casque de test',quantity:3}],
};
test.use({viewport:{width:1280,height:900}});

async function mount(page,posts,boxState='RECEIVED',placed=false) {
  page.on('dialog',dialog=>dialog.accept());
  await page.route(ORIGIN+'/**',async(route)=>{
    const u=new URL(route.request().url());
    const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
    if(u.pathname==='/admin/hub-live')
      return route.fulfill({contentType:'text/html',path:path.join(CANONICAL,'index.html')});
    if(u.pathname.startsWith('/dashboards/canonical/')){
      const file=path.join(CANONICAL,u.pathname.replace('/dashboards/canonical/',''));
      return fs.existsSync(file)?route.fulfill({path:file}):route.fulfill({status:404,body:''});
    }
    if(route.request().method()==='POST'){
      posts.push({path:u.pathname,body:route.request().postDataJSON()});
      if(u.pathname.includes('/labels/articles/'))return json({ok:true,count:3},201);
      if(u.pathname.includes('/labels/boxes/'))return json({ok:true,type:'COMBOX',alias:'ABCDEFGH'},201);
      if(u.pathname.endsWith('/fill'))return json({operation_id:'scan-1',quantity:1},200);
      return json({ok:true},200);
    }
    if(u.pathname==='/api/auth/me')return json(FX.auth_me);
    if(u.pathname==='/api/admin/dashboard/context')return json(FX.context);
    if(u.pathname===API)return json(WORKSPACE);
    if(u.pathname==='/api/scans/hub/receivable')return json({purchase_orders:[]});
    if(u.pathname===API+'/supply')return json(shapeDossier({
      ...DOSSIER,fillable:placed?[]:DOSSIER.fillable,boxes:DOSSIER.boxes.map(box=>({...box,state:boxState,contents:placed?[{allocation_id:ALLOCATION,order_ref:'KTEST01',qty:3,issued_label_count:3}]:box.contents}))
    }));
    if(u.pathname===API+'/supply/trace')return json({chain:[]});
    if(u.pathname===API+'/labels/resolve')return json({
      ok:true,label:{target_type:'ARTICLE',allocation_id:ALLOCATION,short_alias:'ABCDEFGH'},
    });
    if(u.pathname.includes('/labels/')&&u.pathname.endsWith('/print'))
      return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>KOMERCE</title><h1>Etiquette</h1>'});
    return route.fulfill({status:404,body:''});
  });
  await page.goto(ORIGIN+'/admin/hub-live?view=execute');
  await page.locator('select').first().selectOption({label:'KM · Comores'});
  await page.locator('[data-workspace-view="supply"]').click();
  const physical=page.locator('[data-hub-physical-details]');
  if(!(await physical.evaluate(node=>node.open)))await physical.locator('summary').click();
  await expect(page.locator('[data-supply-boxes]')).toBeVisible();
}
test('étiquettes article : préparer puis imprimer sans changement métier implicite',async({page})=>{
  const posts=[];await mount(page,posts,'PACKED');
  await expect(page.locator('[data-hub-label-printing]')).toBeVisible();
  await expect(page.locator('[data-hub-print-article]')).toHaveCount(1);
  await expect(page.locator('[data-hub-print-box]')).toHaveCount(1);
  await expect(page.getByRole('button',{name:'Préparer QR COMBOX'})).toHaveCount(1);
  await page.getByRole('button',{name:'Préparer les étiquettes'}).click();
  await expect.poll(()=>posts.filter(p=>p.path.includes('/labels/articles/')).length).toBe(1);
  expect(posts.some(p=>p.path.endsWith('/fill'))).toBe(false);
  // Real Chromium clicks: authenticated HTTP response and a printable Blob popup.
  const [articlePreview]=await Promise.all([
    page.waitForEvent('popup'),
    page.locator('[data-hub-print-article]').click(),
  ]);
  await expect(articlePreview.locator('h1')).toContainText('Etiquette');
  await articlePreview.close();
  await page.getByRole('button',{name:'Préparer QR COMBOX'}).click();
  const [boxPreview]=await Promise.all([
    page.waitForEvent('popup'),
    page.locator('[data-hub-print-box]').click(),
  ]);
  await expect(boxPreview.locator('h1')).toContainText('Etiquette');
  await boxPreview.close();
  expect(posts.some(p=>p.path.endsWith('/fill'))).toBe(false);
});
test('QR COMBOX et article : validation seulement au clic, quantité 1',async({page})=>{
  const posts=[];await mount(page,posts);
  const cell=page.locator('.kmc-workspace-box-compose').first();
  await expect(cell.getByRole('button',{name:'Préparer QR COMBOX'})).toHaveCount(0);
  await cell.locator('[data-hub-box-scan]').fill('KOM-BOX-TEST');
  await cell.getByLabel('Code physique de l’article à placer dans KOM-BOX-TEST').fill('KQ1_'+'B'.repeat(32));
  expect(posts.some(p=>p.path.endsWith('/fill'))).toBe(false);
  await cell.getByRole('button',{name:'Placer l’article dans la COMBOX'}).click();
  await expect.poll(()=>posts.filter(p=>p.path.endsWith('/fill')).length).toBe(1);
  const move=posts.find(p=>p.path.endsWith('/fill')).body;
  expect(move).toMatchObject({
    allocation_id:ALLOCATION,from_unit_id:SUPPLIER_UNIT,quantity:1,
    box_reference_scan:'KOM-BOX-TEST',evidence_method:'SCAN',evidence_code:'KQ1_'+'B'.repeat(32),
  });
});
test('caméra Chromium simulée : reconnaître une unité, jamais valider le placement',async({page})=>{
  await page.addInitScript(()=>{
    window.BarcodeDetector=class{
      static async getSupportedFormats(){return ['qr_code'];}
      async detect(){return [{rawValue:'KQ1_'+'A'.repeat(32)}];}
    };
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{
      getUserMedia:async()=>new MediaStream(),
    }});
    HTMLMediaElement.prototype.play=async function(){return undefined;};
  });
  const posts=[];await mount(page,posts);
  const cell=page.locator('.kmc-workspace-box-compose').first();
  await cell.getByRole('button',{name:'Scanner par caméra'}).last().click();
  await expect(cell.getByLabel('Code physique de l’article à placer dans KOM-BOX-TEST')).toHaveValue(QR);
  expect(posts.some(p=>p.path.endsWith('/fill'))).toBe(false);
});

test('après placement intégral : réimpression PDF du lot existant sans nouveau QR',async({page})=>{
  const posts=[];await mount(page,posts,'PACKED',true);
  const history=page.locator('[data-hub-article-label-reprints]');
  await expect(history).toBeVisible();
  await history.locator('summary').click();
  await expect(history).toContainText('3 QR émis');
  await expect(history.locator('[data-hub-pdf-article-a4]')).toHaveAttribute('href',API+'/labels/articles/'+ALLOCATION+'/pdf?format=a4');
  await expect(history.locator('[data-hub-pdf-article-thermal]')).toBeVisible();
  await expect(page.getByRole('button',{name:'Préparer les étiquettes'})).toHaveCount(0);
  expect(posts).toEqual([]);
});
