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
const MARKET='e2e00000-0000-4000-8000-000000000007';
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
async function mount(page,{role='agent_hub',row=baseOrder,dossierData=dossier,admin=false,stageNotes=[],openLines=null}={}){
  const posts=[];
  const reads=[];
  const notes=[...stageNotes];
  const administration={scope:'HUB_ADMINISTRATION_GLOBAL',markets:['KM'],kpis:{
    purchase_orders:1,drafts:0,to_send:1,supplier_waiting:0,payment_to_reconcile:0,
  },purchase_orders:[{id:PO,supplier:'Alpha',market:'KM',order_count:1,stage:'issued_not_sent',
    status:'notified',sent_at:null,received:1,expected:2,anomalies:0,
    commitment_authorization:'À valider',payment_authorization:'À autoriser',
    payment_evidence:'Aucune preuve de débit'}]};
  await page.route(ORIGIN+'/**',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(request.method()==='POST'){
      const body=request.postDataJSON();
      posts.push({url:url.pathname,body});
      if(url.pathname==='/api/hub-dash/orders/'+ORDER+'/comment' && body.hub_stage_key){
        const note={id:'00000000-0000-4000-8000-000000000034',hub_stage_key:body.hub_stage_key,
          text:body.content,author_name:'Agent Hub test',created_at:'2026-11-07T12:35:00Z'};
        notes.unshift(note);
        return route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({comment:note})});
      }
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
    if(url.pathname==='/api/hub/director-todo')data={scope:'ALL_MARKETS',overdue_count:1,tasks:[{
      kind:'AUTHORIZE_COMMITMENT',owner:'responsable_hub',
      market:{code:'KM'},subject:{po_id:PO},missing:'Engagement à décider',
      age_hours:52,overdue:true,viewer_can_act:false,
    }]};
    if(url.pathname==='/api/hub/administration')data=administration;
    if(url.pathname==='/api/hub/dossier')data=dossierData;
    if(url.pathname==='/api/hub-dash/orders/'+ORDER)data={id:ORDER,comments:notes};
    if(url.pathname==='/api/scans/hub/receivable')data=receivable;
    if(url.pathname==='/api/purchasing/open-lines')data=openLines||{groups:[{
      supplier_id:SUPPLIER,supplier_name:'Alpha',procurement_hub_ref:'DXB-1',
      market_id:MARKET,market_code:'KM',api_available:false,
      lines:[{order_id:ORDER,line_id:LINE,quantity:2,supplier_currency:'AED',groupable:true,api_eligible:false}],
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

test('Kanban : sourcing vers Opérations, sans formulaire ni achat local',async({page})=>{
  const row={...baseOrder,po:'Sourcing requis',current_key:'po',
    current_phase:'Achats',current_status:'Bloqué · sourcing requis',
    current_expected:'Identifier le fournisseur de 2 articles',next_action:'Résoudre le sourcing',
    stage_states:{...baseOrder.stage_states,po:'warning'}};
  const {posts}=await mount(page,{row});
  const inline=page.locator('[data-hub-inline-action="po"]');
  await expect(inline).toHaveText('Ouvrir l’atelier · PO');
  await inline.click();
  const menu=page.locator('[data-hub-global-menu]');
  await expect(menu).toContainText('Identifier le fournisseur');
  await expect(menu.locator('[data-hub-sourcing-form]')).toHaveCount(0);
  await expect(menu.locator('[data-hub-workflow-link]')).toHaveAttribute('href',
    '/admin/hub-live?view=execute&entry=operations&market=KM&atelier=purchasing&sel=order%3A'+ORDER);
  expect(posts).toEqual([]);
});

test('PO déjà liée ou lecteur : aucune action de sourcing manuel inadaptée',async({page})=>{
  await mount(page,{role:'market_operator',row:{...baseOrder,
    current_key:'po',next_action:'Résoudre le sourcing',po:'Sourcing requis'}});
  await expect(page.locator('[data-hub-inline-action="po"]')).toHaveCount(0);
  await page.locator('[data-hub-global-stage="PO"]').click();
  await expect(page.locator('[data-hub-global-menu]')).toContainText('Consultation seule');
});


test('focus lumineux : étape actuelle contrastée, libellée et non confondue avec les étapes closes',async({page})=>{
  const row={...baseOrder,current_key:'supplier',current_phase:'Fournisseur',
    current_status:'Envoi à prouver',next_action:'Attester l’envoi fournisseur',
    stage_states:{...baseOrder.stage_states,po:'locked',supplier:'warning'}};
  const {posts}=await mount(page,{row});
  const active=page.locator('[data-hub-global-order="KM-302"] [data-hub-global-stage="Fournisseur"]');
  await expect(active).toHaveClass(/is-stage-current/);
  await expect(active).toHaveAttribute('aria-current','step');
  await expect(active.locator('[data-hub-focus-signal="warning"]')).toHaveText('POINT À RÉSOUDRE');
  const activeStyle=await active.evaluate(node=>{
    const css=getComputedStyle(node);
    return {background:css.backgroundImage,foreground:css.color,shadow:css.boxShadow,
      animation:css.animationName,font:css.fontSize};
  });
  expect(activeStyle.background).toContain('linear-gradient');
  expect(activeStyle.foreground).toBe('rgb(255, 255, 255)');
  expect(activeStyle.shadow).not.toBe('none');
  expect(activeStyle.animation).toContain('kmc-hub-stage-breathe');
  await expect(page.locator('[data-hub-global-order="KM-302"]')).toHaveClass(/is-hub-active-order/);
  const completed=page.locator('[data-hub-global-order="KM-302"] [data-hub-global-stage="PO"]');
  await expect(completed).toHaveClass(/is-stage-locked/);
  await expect(completed).not.toHaveClass(/is-stage-current/);
  await expect(completed.locator('[data-hub-focus-signal]')).toHaveCount(0);
  expect(posts).toHaveLength(0);
});

test('focus atténué en attente, sans animation si mouvement réduit',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  const row={...baseOrder,current_key:'reception',current_phase:'Réception',
    next_action:'Attendre le fournisseur',stage_states:{...baseOrder.stage_states,reception:'waiting'}};
  const {posts}=await mount(page,{row});
  const waiting=page.locator('[data-hub-global-stage="Réception"]');
  await expect(waiting.locator('[data-hub-focus-signal="waiting"]')).toHaveText('EN ATTENTE');
  const animation=await waiting.evaluate(node=>getComputedStyle(node).animationName);
  expect(animation).toBe('none');
  await expect(page.locator('[data-hub-inline-action="reception"]')).toHaveCount(0);
  expect(posts).toHaveLength(0);
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

test('clic droit : menus distincts, destination canonique et aucune mutation',async({page})=>{
  const {posts}=await mount(page);
  const row=page.locator('[data-hub-global-order="KM-302"]');
  const menu=page.locator('[data-hub-global-menu]');
  await row.locator('[data-hub-global-stage="PO"]').click({button:'right'});
  await expect(menu).toContainText('Aucune réouverture');
  await expect(menu.locator('a')).toHaveCount(0);
  for(const [stage,atelier,type,id] of [
    ['Fournisseur','purchasing','po',PO],['Réception','reception','po',PO],
    ['Cartons','boxes','order',ORDER],['Départ','shipments','box',BOX]]){
    await row.locator('[data-hub-global-stage="'+stage+'"]').click({button:'right'});
    await expect(menu.locator('[data-hub-workflow-link]')).toHaveAttribute('href',
      '/admin/hub-live?view=execute&entry=operations&market=KM&atelier='+atelier+'&sel='+type+'%3A'+id);
    await expect(menu.locator('[data-hub-real-action],.kmc-hub-action-form')).toHaveCount(0);
  }
  expect(posts).toEqual([]);
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

// Les mutations anciennement testées dans les menus (envoi, réception, PO,
// rattachement COMBOX) sont désormais exercées dans les suites propriétaires :
// hub-live-execution, hub-live-supply, purchasing-workspace et G2 Hub PO Chromium.
// Ce contrat vérifie toutes les entrées du Kanban, sans substituer un POST simulé
// à un clic métier dans l'atelier.
for(const [stage,atelier] of [['PO','purchasing'],['Fournisseur','purchasing'],
  ['Réception','reception'],['Cartons','boxes'],['Départ','shipments']]){
  test('Kanban '+stage+' : lien contextualisé et aucun formulaire',async({page})=>{
    const row={...baseOrder,stage_states:{...baseOrder.stage_states,po:'ready',departure:'ready'}};
    const {posts}=await mount(page,{row});
    await page.locator('[data-hub-global-stage="'+stage+'"]').click();
    const menu=page.locator('[data-hub-global-menu]');
    await expect(menu.locator('[data-hub-workflow-link]').first()).toHaveAttribute('href',new RegExp('atelier='+atelier));
    await expect(menu.locator('[data-hub-real-action],.kmc-hub-action-form,[data-hub-sourcing-form]')).toHaveCount(0);
    expect(posts).toEqual([]);
  });
}

test('le menu suit la cellule lors du scroll puis disparaît si elle sort de la vue',async({page})=>{
  await page.setViewportSize({width:900,height:790});
  await mount(page);
  const cell=page.locator('[data-hub-global-stage="PO"]');
  await cell.click();
  const menu=page.locator('[data-hub-global-menu]');
  await expect(menu).toBeVisible();
  const scroll=page.locator('.kmc-hub-board-scroll').first();
  const before=await menu.evaluate(el=>parseFloat(el.style.left));
  await scroll.evaluate(el=>{el.scrollLeft+=50;});
  await expect.poll(()=>menu.evaluate(el=>parseFloat(el.style.left))).toBeLessThan(before);
  await scroll.evaluate(el=>{el.scrollLeft=el.scrollWidth;});
  await expect(menu).toBeHidden();
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
  await expect(menu).toContainText('Attendu : Identifier le fournisseur de 2 articles');
  await expect(menu.locator('[data-hub-workflow-link]')).toHaveAttribute('href',/atelier=purchasing&sel=order%3A/);
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
  await expect(menu.locator('[data-hub-workflow-link]')).toHaveAttribute('href','/admin/workspaces/shipping-customs?market=KM');
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


test.describe('Journal immuable par étape',()=>{
  const existing=[
    {id:'00000000-0000-4000-8000-000000000031',hub_stage_key:'supplier',
      author_name:'Agent Hub',text:'Fournisseur relancé par WhatsApp.',
      created_at:'2026-11-07T11:15:00Z'},
    {id:'00000000-0000-4000-8000-000000000032',hub_stage_key:'cartons',
      author_name:'Agent Hub',text:'Carton contrôlé et scellé.',
      created_at:'2026-11-07T11:20:00Z'},
  ];

  test('journal daté par étape, sans mélange de phases ni édition de note',async({page})=>{
    const {posts}=await mount(page,{stageNotes:existing});
    await page.locator('[data-hub-global-stage="Fournisseur"]').click({button:'right'});
    const menu=page.locator('[data-hub-global-menu]');
    await menu.locator('[data-hub-stage-journal-toggle]').click();
    const journal=menu.locator('[data-hub-stage-journal="supplier"]');
    await expect(journal).toContainText('Fournisseur relancé par WhatsApp');
    await expect(journal).not.toContainText('Carton contrôlé');
    await expect(journal).toContainText('Agent Hub');
    await expect(journal).toContainText('Publiée · non modifiable');
    await expect(journal.locator('.kmc-hub-journal-item')).toHaveCount(1);
    await expect(journal.getByRole('button',{name:/modifier|supprimer/i})).toHaveCount(0);
    expect(posts).toHaveLength(0);
  });

  test('publication ajoutée à la chronologie, sans autre action métier',async({page})=>{
    const {posts}=await mount(page,{stageNotes:existing});
    await page.locator('[data-hub-global-stage="Fournisseur"]').click({button:'right'});
    const journal=page.locator('[data-hub-stage-journal="supplier"]');
    await journal.locator('[data-hub-stage-journal-toggle]').click();
    await expect(journal).toContainText('Fournisseur relancé par WhatsApp');
    await journal.locator('[data-hub-journal-input]').fill('Livraison annoncée lundi, à confirmer.');
    expect(posts).toHaveLength(0);
    await journal.locator('[data-hub-journal-publish]').click();
    await expect(journal).toContainText('Livraison annoncée lundi, à confirmer');
    await expect(journal.locator('.kmc-hub-journal-item')).toHaveCount(2);
    expect(posts).toEqual([{url:'/api/hub-dash/orders/'+ORDER+'/comment',
      body:{content:'Livraison annoncée lundi, à confirmer.',hub_stage_key:'supplier'}}]);
    await expect(journal.getByRole('button',{name:/modifier|supprimer/i})).toHaveCount(0);
  });

  test('étape verrouillée : publier une note sans réouverture ni seconde mutation',async({page})=>{
    const locked={...baseOrder,current_key:'remaining',
      stage_states:{...baseOrder.stage_states,departure:'locked'}};
    const {posts}=await mount(page,{row:locked,stageNotes:existing});
    await page.locator('[data-hub-global-stage="Départ"]').click();
    const menu=page.locator('[data-hub-global-menu]');
    await expect(menu).toContainText('Aucune réouverture');
    const comment=menu.locator('[data-hub-completed-comment]');
    await expect(comment).toBeVisible();
    await comment.click();
    await expect(menu).toHaveClass(/is-editing/);
    const journal=menu.locator('[data-hub-stage-journal="departure"]');
    await expect(journal.locator('[data-hub-journal-input]')).toBeVisible();
    await journal.locator('[data-hub-journal-input]').fill('Colis remis au transitaire, preuve consultée.');
    expect(posts).toHaveLength(0);
    await journal.locator('[data-hub-journal-publish]').click();
    await expect(journal).toContainText('Colis remis au transitaire, preuve consultée.');
    await expect(journal.locator('.kmc-hub-journal-item')).toHaveCount(1);
    await expect(menu.locator('[data-hub-real-action]')).toHaveCount(0);
    expect(posts).toEqual([{url:'/api/hub-dash/orders/'+ORDER+'/comment',
      body:{content:'Colis remis au transitaire, preuve consultée.',hub_stage_key:'departure'}}]);
    await expect(page.locator('[data-hub-global-stage="Départ"]')).toHaveClass(/is-stage-locked/);
  });

  test('étape complète : commentaire accessible, mais aucun nouveau geste métier',async({page})=>{
    const {posts}=await mount(page);
    await page.locator('[data-hub-global-stage="PO"]').click();
    const menu=page.locator('[data-hub-global-menu]');
    await expect(menu).toContainText('Aucune réouverture');
    await expect(menu.locator('[data-hub-real-action]')).toHaveCount(0);
    await menu.locator('[data-hub-completed-comment]').click();
    const journal=menu.locator('[data-hub-stage-journal="po"]');
    await journal.locator('[data-hub-journal-input]').fill('PO vérifiée après réception fournisseur.');
    await journal.locator('[data-hub-journal-publish]').click();
    await expect(journal).toContainText('PO vérifiée après réception fournisseur.');
    expect(posts).toEqual([{url:'/api/hub-dash/orders/'+ORDER+'/comment',
      body:{content:'PO vérifiée après réception fournisseur.',hub_stage_key:'po'}}]);
  });

  test('profil marché : journal en lecture seule',async({page})=>{
    await mount(page,{role:'market_operator',stageNotes:existing});
    await page.locator('[data-hub-global-stage="Fournisseur"]').click();
    const journal=page.locator('[data-hub-stage-journal="supplier"]');
    await journal.locator('[data-hub-stage-journal-toggle]').click();
    await expect(journal).toContainText('Fournisseur relancé');
    await expect(journal).toContainText('Consultation seulement');
    await expect(journal.locator('[data-hub-journal-publish]')).toHaveCount(0);
    await expect(page.locator('[data-hub-completed-comment]')).toHaveCount(0);
  });
});

test('Navigation Hub : Kanban, Opérations et Direction restent distincts',async({page})=>{
  const {posts,reads}=await mount(page,{role:'admin'});
  await expect(page.locator('[data-hub-branch]')).toHaveCount(3);
  await expect(page.locator('[data-hub-open-operations]')).toHaveAttribute('href','/admin/hub-live?view=execute&entry=operations');
  await expect(page.locator('[data-hub-director-todo]')).toHaveCount(0);
  await expect(page.locator('[data-hub-global-order]')).toHaveCount(1);
  expect(reads.some(url=>url.startsWith('/api/hub/director-todo'))).toBe(false);
  await page.locator('[data-hub-branch="direction"]').click();
  await expect(page).toHaveURL(/branch=direction/);
  await expect(page.locator('[data-hub-director-todo]')).toBeVisible();
  await expect(page.locator('[data-hub-director-task="AUTHORIZE_COMMITMENT"]')).toBeVisible();
  await expect(page.locator('[data-hub-global-order]')).toHaveCount(0);
  await page.locator('[data-hub-branch="operations"]').click();
  await expect(page.locator('[data-hub-global-order]')).toHaveCount(1);
  await expect(page.locator('[data-hub-director-todo]')).toHaveCount(0);
  expect(posts).toHaveLength(0);
});
