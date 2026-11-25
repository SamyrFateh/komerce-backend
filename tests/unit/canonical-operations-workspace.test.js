'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');
const workspace = require('../../public/dashboards/canonical/js/operations-workspace');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical', 'js', 'operations-workspace.js'),
  'utf8'
);

test('endpointFor impose un code marché et reste dans le namespace Canonical', () => {
  expect(workspace.endpointFor('cm')).toBe('/api/admin/workspaces/operations/market/CM');
  expect(workspace.endpointFor('CM', 'distribution/run')).toBe(
    '/api/admin/workspaces/operations/market/CM/distribution/run'
  );
  expect(() => workspace.endpointFor(null)).toThrow('canonical_operations_workspace_market_required');
});

test('le frontend ne construit jamais market_id comme autorité', () => {
  const executable = SOURCE.replace(/\/\*\*[\s\S]*?\*\//, '');
  expect(executable).not.toMatch(/\bmarket_id\b/);
  expect(executable).not.toMatch(/\bmarketId\b/);
  // Direction lit les preuves d'autorisation via le GET existant, sans créer
  // une autre autorité de marché. Aucun writer Hub hors confirmation physique.
  const read="jsonRequest(context.fetch,'/api/hub/administration')";
  expect(executable).toContain(read);
  expect(executable.replace(read,'').replace('/api/hub/physical-codes/confirm','')).not.toContain('/api/hub/');
  expect(executable).not.toContain('/api/v2/');
});

test('les KPI du Workspace sont une projection pure du résumé serveur', () => {
  const items = workspace.metricItems({
    hub_unassigned: 3,
    hub_to_ship: 4,
    relay_cash_pending: 5,
    relay_to_receive: 6,
    relay_to_collect: 7,
    inventory_to_assign: 8,
  });

  expect(items.map(item => item.value)).toEqual(['3', '4', '5', '6', '7', '8']);
  expect(items.every(item => item.tone === 'warning')).toBe(true);
});

test('jsonRequest POST sérialise uniquement le body métier fourni', async () => {
  const fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue({ ok: true }),
  });

  await workspace.jsonRequest(
    fetch,
    '/api/admin/workspaces/operations/market/CM/inventory/items/item-1/assign',
    { method: 'POST', body: { parcel_ref: 'PCL-CM-001' } }
  );

  expect(fetch).toHaveBeenCalledWith(
    '/api/admin/workspaces/operations/market/CM/inventory/items/item-1/assign',
    expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ parcel_ref: 'PCL-CM-001' }),
    })
  );
});


test('Hub / Relais overview ne rend plus le doublon Signaux réseau et porte son Hero contextuel', () => {
  expect(SOURCE).toContain("data-workspace-kind', 'hub-relay");
  const renderStart = SOURCE.indexOf('function renderPayload');
  const renderSource = SOURCE.slice(renderStart);
  expect(renderSource).not.toContain('renderSignals(rootNode');
  expect(SOURCE).toContain("'HUB & RELAIS'");
  expect(SOURCE).toContain("'Flux à traiter'");
});

test('l\'en-tête du workspace porte le rôle hero (cadre et illustration communs aux overviews)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/js/operations-workspace.js'), 'utf8');
  expect(src).toContain("header.setAttribute('data-dashboard-role', 'hero')");
});

test('UX-07 — Hub & Relais : une vue exclusive à la fois (Hub / Relais / Stock)', () => {
  expect(SOURCE).toContain("data-workspace-view");
  expect(SOURCE).toContain("if (view === 'hub') {");
  expect(SOURCE).toContain("if (view === 'relay') {");
  expect(SOURCE).toContain("if (view === 'inventory') renderInventorySection");
  expect(SOURCE).toContain("'Stock à affecter'");
});

test('mode execution (Hub live) : actions Hub uniquement, aucune action Relais exposée', () => {
  expect(SOURCE).toContain("context.mode === 'execution' ? EXECUTION_VIEWS : WORKSPACE_VIEWS");
  expect(SOURCE).not.toMatch(/EXECUTION_VIEWS = Object\.freeze\(\[[^\]]*relay/);
  expect(SOURCE).toContain("mode: ['execution', 'relay-execution'].includes(options.mode) ? options.mode : 'pilot'");
  expect(SOURCE).toContain('HUB LIVE · EXÉCUTION');
});

test('réception fournisseur : route canonique, référence stable, aucune quantité préremplie, SHIPPED informatif', () => {
  expect(SOURCE).toContain("'/api/scans/hub/receive'");
  expect(SOURCE).toContain("'/api/scans/hub/receivable'");
  expect(SOURCE).toContain('receptionReferenceFor(context, po.purchase_order_id)');
  expect(SOURCE).toContain('Aucune quantité n’est préremplie');
  expect(SOURCE).toContain('(information, pas une réception)');
  expect(SOURCE).not.toMatch(/input\.value\s*=\s*String\(line\./);
});


test('le formulaire de sourcing partagé refuse les rôles sans écriture sans faire de requête', () => {
  const fetch = jest.fn();
  expect(typeof workspace.openManualSourcing).toBe('function');
  expect(() => workspace.openManualSourcing({ replaceChildren:jest.fn() }, {
    document:{}, fetch, user:{role:'market_operator'},
    order:{id:'order-1',items:[]},
  })).toThrow('hub_inline_sourcing_not_permitted');
  expect(fetch).not.toHaveBeenCalled();
});

test('l’interface source les articles via les seules API purchasing existantes', () => {
  expect(SOURCE).toContain('function renderManualSourcing');
  expect(SOURCE).toContain('function openManualSourcing');
  expect(SOURCE).toMatch(/\/api\/purchasing\/suppliers/);
  expect(SOURCE).toMatch(/\/api\/purchasing\/lines/);
  expect(SOURCE).not.toContain('createHubSourcingParallelWriter');
});

test('A2 : jsonRequest transmet Idempotency-Key uniquement quand elle est fournie', async () => {
  const mk = () => jest.fn().mockResolvedValue({ ok: true, status: 200, json: jest.fn().mockResolvedValue({}) });
  const withKey = mk();
  await workspace.jsonRequest(withKey, '/x/boxes', { method: 'POST', body: {}, idempotencyKey: 'K-1' });
  expect(withKey.mock.calls[0][1].headers['Idempotency-Key']).toBe('K-1');
  const without = mk();
  await workspace.jsonRequest(without, '/x/boxes', { method: 'POST', body: {} });
  expect(without.mock.calls[0][1].headers).not.toHaveProperty('Idempotency-Key');
});

test('l’onglet Cash & dépôts de Relais live reçoit la vraie session (déclarer / recevoir une remise)', () => {
  expect(SOURCE).toContain('user: context.user || {}');
  expect(SOURCE).not.toMatch(/cashModule\.mount\(\{\s*root: host, document: doc, ui, fetch: context\.fetch, user: \{\}/);
});

test('sourcing manuel : la cotation réelle cible la création de ligne pour une association sans prix',()=>{
  const source=require('node:fs').readFileSync(require.resolve('../../public/dashboards/canonical/js/operations-workspace'),'utf8');
  expect(source).toContain('mapped && supplier.matching_price_aed === null');
  expect(source).toContain('actual_unit_price: actualPrice.value');
  expect(source).toContain("supplier_price_aed: price");
});


test('UX1 : veille Hub GET seule, pas de repaint pendant formulaire et sélection préservée',()=>{
  expect(SOURCE).toContain("endpointFor(marketCode, 'supply')");
  expect(SOURCE).toContain("doc.visibilityState === 'hidden'");
  expect(SOURCE).toContain("rootNode.querySelector('form:not([hidden])");
  expect(SOURCE).toContain('hubInputBusy()');
  expect(SOURCE).toContain('Nouvelles données disponibles — ');
  expect(SOURCE).toContain('context.hubRefresh.signature = supplySignature(context.dossier)');
  expect(SOURCE).toContain('watchHubSupply();');
});


test('UX1 : backoff exponentiel des lectures 429/5xx et Retry-After respecté', () => {
  expect(workspace.hubPollDelayMs(0)).toBe(30000);
  expect(workspace.hubPollDelayMs(1)).toBe(60000);
  expect(workspace.hubPollDelayMs(2)).toBe(120000);
  expect(workspace.hubPollDelayMs(5)).toBe(300000);
  expect(workspace.hubPollDelayMs(1, '180')).toBe(180000);
  expect(workspace.hubPollDelayMs(1, 'Fri, 20 Nov 2026 10:05:00 GMT', Date.parse('2026-11-20T10:00:00Z'))).toBe(300000);
  expect(workspace.hubPollDelayMs(1, 'invalid')).toBe(60000);
  expect(SOURCE).toContain('await reload({ freshDossier: fresh });');
  expect(SOURCE).toContain('if (supplySignature(fresh) !== watch.signature)');
});

test('UX1 : jsonRequest propage le Retry-After en cas de réponse 429', async () => {
  const fetch = jest.fn().mockResolvedValue({
    ok: false, status: 429,
    headers: { get: jest.fn(() => '120') },
    json: jest.fn().mockResolvedValue({ error: 'rate limited' }),
  });
  await expect(workspace.jsonRequest(fetch, '/api/admin/workspaces/operations/market/CG/supply'))
    .rejects.toMatchObject({ status: 429, retryAfter: '120' });
});

test('le montage achat compact refuse un profil marché avant toute lecture', async () => {
  const fetch=jest.fn();
  await expect(workspace.mountPurchaseActions({}, {user:{role:'market_operator'},marketCode:'CM',poId:'p1',fetch}))
    .rejects.toThrow('Accès achat Hub requis');
  expect(fetch).not.toHaveBeenCalled();
});

test('le montage achat compact charge supply authentifié et échoue fermé sans viewer',async()=>{
  const previous=global.KomerceHubLiveCockpit;
  const render=jest.fn();
  global.KomerceHubLiveCockpit={render};
  try{
    const node=()=>({children:[],setAttribute(){},appendChild(n){this.children.push(n);return n;},replaceChildren(...n){this.children=n;}});
    const host=node(),dossier={purchase_orders:[],cockpit:{}};
    const fetch=jest.fn(async()=>({ok:true,json:async()=>dossier}));
    await workspace.mountPurchaseActions(host,{document:{createElement:node},fetch,user:{role:'agent_hub'},marketCode:'CM',poId:'p1'});
    expect(fetch).toHaveBeenCalledWith('/api/admin/workspaces/operations/market/CM/supply',expect.objectContaining({method:'GET',credentials:'include'}));
    expect(render).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({dossier,purchaseOnly:true,isReadOnly:true,state:expect.objectContaining({sel:{type:'po',id:'p1'}})}));
    expect(fetch).toHaveBeenCalledTimes(1);
  }finally{global.KomerceHubLiveCockpit=previous;}
});

test('le montage réception compact refuse les rôles hors Hub avant toute lecture',async()=>{
  const fetch=jest.fn();
  await expect(workspace.mountReceptionActions({}, {user:{role:'market_operator'},marketCode:'CM',poId:'p1',fetch})).rejects.toThrow('Accès réception Hub requis');
  expect(fetch).not.toHaveBeenCalled();
});
test('les QR de réception sont limités à la PO exacte, même pour une commande partagée',()=>{
  const own={allocation_id:'a1',purchase_order_id:'p1',order_id:'o1',quantity:1};
  const other={allocation_id:'a2',purchase_order_id:'p2',order_id:'o1',quantity:1};
  expect(workspace.receptionLabelRows({fillable:[own,other,{allocation_id:'a3',order_id:'o1'}]},'p1')).toEqual([own]);
});

test('COMBOX : groupes relais puis rail demandé, plusieurs PO compatibles, aucun rail implicite',()=>{
  const r=(po,relay,rail,state='QUALITY_CHECKED')=>({purchase_order_id:po,relais_id:relay,relais_code:relay,requested_transport_rail:rail,source_state:state,quantity:1});
  const a=r('p1','A','SEA_STANDARD'), b=r('p2','A','SEA_STANDARD'), c=r('p1','A','AIR_EXPRESS'), d=r('p1','B',null), e=r('p1','A',null), f=r('p2','C','SEA_STANDARD');
  const groups=workspace.packingGroups({fillable:[a,b,c,d,e,f],boxes:[]},'p1');
  expect(groups.map(g=>[g.relay,g.rail])).toEqual([['A',null],['A','AIR_EXPRESS'],['A','SEA_STANDARD'],['B',null]]);
  const sea=groups.find(g=>g.rail==='SEA_STANDARD');
  expect([a,b,c,d,e,f].filter(row=>workspace.matchesPackingGroup(row,sea))).toEqual([a,b]);
  expect(workspace.packingBoxMatches({contents:[a,b]},sea)).toBe(true);
  expect(workspace.packingBoxMatches({contents:[a,c]},sea)).toBe(false);
  expect(workspace.packingBoxMatches({contents:[a,d]},sea)).toBe(false);
  expect(workspace.sourceQualityChecked(a)).toBe(true);
  expect(workspace.sourceQualityChecked(r('p1','A','SEA_STANDARD','RECEIVED'))).toBe(false);
  expect(workspace.sourceQualityChecked(r('p1','A','SEA_STANDARD','IDENTIFIED'))).toBe(false);
  expect(workspace.sourceQualityChecked({})).toBe(false);
});
test('COMBOX : groupe maintenu après placement de tous les articles de la PO',()=>{
  const row={purchase_order_id:'p1',relais_id:'A',relais_code:'A',requested_transport_rail:null};
  expect(workspace.packingGroups({fillable:[],boxes:[{contents:[row]}]},'p1')).toEqual([expect.objectContaining({relay:'A',rail:null})]);
});
test('le montage COMBOX refuse un rôle non Hub avant toute lecture',async()=>{
  const fetch=jest.fn();
  await expect(workspace.mountBoxActions({}, {user:{role:'market_operator'},marketCode:'CM',poId:'p1',fetch})).rejects.toThrow('Accès COMBOX Hub requis');
  expect(fetch).not.toHaveBeenCalled();
});

test('départ : seul DISPATCHED non rattaché est sélectionnable et liaison PO exacte',()=>{
  const own={unit_id:'b1',state:'DISPATCHED',contents:[{purchase_order_id:'p1',qty:1},{purchase_order_id:'p2',qty:2}]};
  const other={unit_id:'b2',state:'PACKED',contents:[{purchase_order_id:'p2',qty:1}]};
  const linked={...own,unit_id:'b3',shipment_ref:'SHIP'};
  expect(workspace.departureBoxes({boxes:[own,other,linked]},'p1')).toEqual([own,linked]);
  expect(workspace.departureReady(own)).toBe(true);
  expect(workspace.departureReady({...own,state:'PACKED'})).toBe(false);
  expect(workspace.departureReady(linked)).toBe(false);
  expect(workspace.departureReady({...own,contents:[]})).toBe(false);
  expect(workspace.departureShipmentRefs({boxes:[own,other,linked]},'p1')).toEqual(['SHIP']);
});
test('montage départ interdit à un responsable marché avant toute lecture',async()=>{
  const fetch=jest.fn();
  await expect(workspace.mountDepartureActions({}, {user:{role:'market_operator'},marketCode:'CM',poId:'p1',fetch})).rejects.toThrow('Accès départ Hub requis');
  expect(fetch).not.toHaveBeenCalled();
});

test('réception : la file globale ne peut afficher que les PO du dossier marché chargé',()=>{
  const a={purchase_order_id:'p1'},b={purchase_order_id:'p2'},c={purchase_order_id:'foreign'};
  expect(workspace.receptionOrdersForMarket({purchase_orders:[{id:'p1'},{id:'p2'}]},{purchase_orders:[a,b,c]})).toEqual([a,b]);
  expect(workspace.receptionOrdersForMarket(null,{purchase_orders:[a,b,c]})).toEqual([]);
});
