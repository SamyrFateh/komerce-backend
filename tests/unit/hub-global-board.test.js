'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { summarizeMarket, summarizePurchaseOrders, summarizeLogisticsWork, getGlobalBoard } = require('../../services/hub-global-board');

const order = (id, ref, qty) => ({
  id, reference: ref, items: [{id:'item-'+id,product:'Objet confidentiel',ordered:qty}],
});
const empty = orders => ({
  orders, needs:[], purchase_orders:[], client_parcels:[], boxes:[],
});

describe('Hub central : tous les marchés, lecture seule', () => {
  test('une commande en attente de PO reste visible, sans détails article ni informations fournisseurs', () => {
    const input = empty([order('a','KM-1',2)]);
    input.needs=[{order_id:'a',quantity:2,supplier_name:'Privé'}];
    const rows=summarizeMarket({id:'km',code:'KM',name:'Comores'},input);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reference:'KM-1',market:'KM',po:'À constituer',supplier:'Non commandé',
      remaining:'2 à recevoir',attention:true,
    });
    expect(rows[0].next_action).toBe('Constituer PO');
    expect(rows[0].stage_states).toMatchObject({po:'waiting',supplier:'muted',remaining:'warning'});
    expect(JSON.stringify(rows)).not.toMatch(/Objet confidentiel|Privé|price|email|payment/);
  });

  test('L8 : commande import non sourcée, action explicite sans détails privés', () => {
    const input = empty([{
      id: 'order-l8', reference: 'KRGNX5O',
      items: [
        { id: 'item1', product: 'Article confidentiel', ordered: 2,
          sourcing_required: true, purchasing_missing: 2 },
        { id: 'item2', product: 'Article confidentiel 2', ordered: 1,
          sourcing_required: false, purchasing_missing: 0 },
      ],
    }]);
    const [row] = summarizeMarket({ id: 'km', code: 'KM', name: 'Comores' }, input);
    expect(row.po).toBe('Sourcing requis');
    expect(row.next_action).toBe('Résoudre le sourcing');
    expect(row.stage_states.po).toBe('warning');
    expect(row.remaining_detail).toContain('2 à sourcer');
    expect(JSON.stringify(row)).not.toMatch(/Article confidentiel|supplier_sku|payment_status|prix/);
  });

  test('reliquat et anomalie sont tous deux lisibles, non additionnés', () => {
    const payload=empty([order('a','KM-2',3)]);
    payload.purchase_orders=[{
      id:'po1',stage:'confirmed',sent_at:'2026-11-02',supplier_name:'Privé',
      lines:[{order_id:'a',received:2,confirmed:3,anomaly:1}],
    }];
    payload.boxes=[{unit_id:'box1',shipment_ref:'SHIP1',contents:[{order_id:'a'}]}];
    const [row]=summarizeMarket({id:'km',code:'KM',name:'Comores'},payload);
    expect(row.reception).toBe('2 / 3 reçu(s)');
    expect(row.remaining).toBe('1 à recevoir');
    expect(row.remaining_detail).toContain('1 à contrôler');
    expect(row.departure).toBe('Expédition préparée · remise non attestée');
    expect(row.departure).toContain('remise non attestée');
    expect(row.next_action).toBe('Contrôler les écarts');
    expect(row.stage_states).toMatchObject({reception:'critical',remaining:'critical',departure:'ready'});
  });

  test('l’API de synthèse balaie tous les marchés actifs sans sélection cliente', async () => {
    const query={query:jest.fn(async ()=>({rows:[
      {id:'market-km',code:'KM',name:'Comores'},
      {id:'market-cm',code:'CM',name:'Cameroun'},
    ]}))};
    const dossierReader=jest.fn(async id=>empty([
      order('order-'+id,'ORDER-'+id,1),
    ]));
    const result=await getGlobalBoard(query,dossierReader);
    expect(query.query).toHaveBeenCalledWith(
      'SELECT id, code, name FROM markets WHERE is_active = TRUE ORDER BY code'
    );
    expect(dossierReader.mock.calls).toEqual([['market-km'],['market-cm']]);
    expect(result.scope).toBe('HUB_GLOBAL');
    expect(result.markets).toEqual(['KM','CM']);
    expect(result.orders).toHaveLength(2);
    expect(result.orders.map(x=>x.market)).toEqual(['CM','KM']);
  });

  test('tableau Hub marché: SQL filtre AVANT lecture des dossiers, même si scope vide', async () => {
    const query={query:jest.fn(async (_sql, params)=>({rows:params?.[0]?.length
      ? [{id:'market-km',code:'KM',name:'Comores'}] : []}))};
    const reader=jest.fn(async id=>empty([order('o-'+id,'CMD-KM-1',1)]));
    const result=await getGlobalBoard(query,reader,{marketIds:['market-km']});
    expect(query.query.mock.calls[0][0]).toContain('id = ANY($1::uuid[])');
    expect(query.query.mock.calls[0][1]).toEqual([['market-km']]);
    expect(reader).toHaveBeenCalledTimes(1);
    expect(reader).toHaveBeenCalledWith('market-km');
    expect(result.audience).toBe('MARKET_SCOPED');
    expect(result.markets).toEqual(['KM']);
    expect(result.orders.map(o=>o.market)).toEqual(['KM']);
    const denied=await getGlobalBoard(query,reader,{marketIds:[]});
    expect(denied.orders).toEqual([]);
    expect(reader).toHaveBeenCalledTimes(1);
  });

  test('aucune ligne de commande import : tableau vide, sans inventer des mouvements', async () => {
    const r=await getGlobalBoard({query:async ()=>({rows:[]})},jest.fn());
    expect(r).toEqual({scope:'HUB_GLOBAL',markets:[],orders:[]});
  });
});


describe('Tableau Hub : phase prouvée et tâches verrouillées', () => {
  const market = { id:'km', code:'KM', name:'Comores' };
  const evidence = ({ ordered=3, received=3, boxed=0, stage=null, state='DISPATCHED', collected=0, anomalies=0 }={}) => ({
    orders:[{ id:'a', reference:'KM-PHASE',
      items:[{ id:'item-a', ordered, received, in_boxes:boxed, in_bags:0, anomaly:anomalies }] }],
    purchase_orders:[{id:'po1',stage:'received',sent_at:'2026-11-07',
      lines:[{order_id:'a',received,anomaly:anomalies}]}],
    needs:[],
    boxes:boxed ? [{unit_id:'box1',state,shipment_ref:stage?'SH-KM-1':null,
      shipment_stage:stage,contents:[{order_id:'a',qty:boxed}]}] : [],
    client_parcels:collected ? [{order_id:'a',status:'collected',
      contents:[{quantity:collected}]}] : [],
  });
  const row = config => summarizeMarket(market,evidence(config))[0];

  test('3/3 reçus sans carton : emballage à faire maintenant, départ futur', () => {
    const r=row({});
    expect(r.current_phase).toBe('Emballage');
    expect(r.current_key).toBe('cartons');
    expect(r.current_expected).toContain('3 article(s)');
    expect(r.stage_states.reception).toBe('complete');
    expect(r.stage_states.departure).toBe('muted');
    expect(r.departure).not.toMatch(/remise attestée/i);
  });

  test('carton fermé et expédition créée : aucun transport ni remise inventés', () => {
    const r=row({boxed:3,stage:'hub_ready'});
    expect(r.current_phase).toBe('Départ');
    expect(r.current_expected).toMatch(/attester la remise/i);
    expect(r.departure).toContain('remise non attestée');
    expect(r.stage_states.departure).toBe('ready');
  });

  test('remise au transitaire attestée : départ verrouillé et toujours consultable', () => {
    const r=row({boxed:3,stage:'handed_over'});
    expect(r.current_phase).toBe('Transitaire');
    expect(r.current_status).toBe('Remise au transitaire attestée');
    expect(r.stage_states.departure).toBe('locked');
    expect(r.stage_notes.departure).toContain('SH-KM-1');
    expect(r.stage_states.remaining).not.toBe('locked');
  });

  test('transport prouvé 2/3 et reliquat fournisseur 1/3 coexistent', () => {
    const r=row({received:2,boxed:2,stage:'in_transit'});
    expect(r.current_phase).toBe('Réception Hub');
    expect(r.current_detail).toBe('Transport : 2/3 · Réception attendue : 1/3');
    expect(r.current_expected).toContain('Attendre 1 article(s)');
    expect(r.next_action).toBe('Attente du reliquat');
    expect(r.stage_states.departure).toBe('progress');
    expect(r.remaining).toBe('1 à recevoir');
  });

  test('réception partielle, 2 articles non emballés : geste possible sans masquer le reliquat', () => {
    const r=row({received:2});
    expect(r.current_status).toContain('2/3');
    expect(r.current_key).toBe('cartons');
    expect(r.current_expected).toContain('Emballer les 2 article(s) reçus');
    expect(r.current_expected).toContain('1 attendu(s)');
  });

  test('tous les articles au relais ne signifient pas remis au client', () => {
    const r=row({boxed:3,stage:'relay_received'});
    expect(r.current_phase).toBe('Remise client');
    expect(r.current_status).toContain('en attente');
    expect(r.stage_states.departure).toBe('locked');
    expect(r.stage_states.remaining).not.toBe('locked');
    expect(r.remaining).toBe('Remise client à confirmer');
  });

  test('remise client attestée : terminé et aucun reliquat seulement alors', () => {
    const r=row({boxed:3,stage:'relay_received',collected:3});
    expect(r.current_phase).toBe('Terminé');
    expect(r.next_action).toContain('Aucune action');
    expect(r.remaining).toContain('Aucun reliquat');
    expect(r.stage_states.remaining).toBe('locked');
  });

  test('écart physique prioritaire : blocage explicite et aucune clôture prématurée', () => {
    const r=row({received:2,boxed:2,stage:'handed_over',anomalies:1});
    expect(r.current_status).toContain('Bloqué');
    expect(r.current_phase).toBe('Réception Hub');
    expect(r.current_key).toBe('reception');
    expect(r.stage_states.reception).toBe('critical');
    expect(r.remaining_detail).toContain('à contrôler');
  });

  test('aucun identifiant fournisseur, produit ou prix exposé dans le tableau', () => {
    const payload=evidence({received:2,boxed:2,stage:'handed_over'});
    payload.orders[0].items[0].product='SECRET PRODUIT';
    payload.purchase_orders[0].supplier_name='SECRET FOURNISSEUR';
    const r=summarizeMarket(market,payload)[0];
    expect(JSON.stringify(r)).not.toMatch(/SECRET|supplier_name|prix|payment_status/);
  });
});

test('la destination relais canonique est projetée sans identité client',()=>{
 const payload=empty([{...order('a','CM-YA01-B7Q01',3),relay_name:'Yaoundé Centre',relay_id:'internal-id',client_name:'PRIVÉ'}]);
 const [row]=summarizeMarket({id:'cm',code:'CM',name:'Cameroun'},payload);
 expect(row.relay_name).toBe('Yaoundé Centre');
 expect(row.reference).toBe('CM-YA01-B7Q01');
 expect(JSON.stringify(row)).not.toMatch(/PRIVÉ|internal-id|client_name/);
});

test('QR partiels et réception partielle : aucun faux terminé, le tri reste distinct',()=>{
 const input=empty([{...order('a','KM-3',3),items:[{ordered:3,received:2,article_labels_issued:1}]}]);
 input.purchase_orders=[{id:'po',stage:'confirmed',sent_at:'2026-11-02',lines:[{order_id:'a',received:2}]}];
 let [row]=summarizeMarket({code:'KM'},input);
 expect(row).toMatchObject({physical_focus:'labels',stage_states:{labels:'ready',reception:'warning'}});
 input.orders[0].items[0].article_labels_issued=2;
 [row]=summarizeMarket({code:'KM'},input);
 expect(row.stage_states.labels).toBe('progress');
 expect(row.stage_notes.labels).toContain('impression physique non attestée');
 expect(row.physical_focus).toBe('cartons');
 input.orders[0].items[0].received=3;input.orders[0].items[0].article_labels_issued=3;
 [row]=summarizeMarket({code:'KM'},input);
 expect(row.stage_states.labels).toBe('complete');
 expect(row.stage_states.cartons).toBe('ready');
});

describe('Kanban PO : projection centrale opt-in', () => {
  const market={id:'km',code:'KM',name:'Comores'};
  const po={id:'p1',ref:'PO-1',supplier_name:'Fournisseur',status:'confirmed',stage:'partially_received',
    sent_at:'2026-11-24',lines:[
      {order_id:'a',order_ref:'KAAAAAA',ordered:3,confirmed:3,received:3,missing:0,anomaly:0,unit_price:10},
      {order_id:'b',order_ref:'KBBBBBB',ordered:2,confirmed:2,received:0,missing:2,anomaly:0},
    ]};
  test('une PO multi-commandes reste unique, reliquat exact et pas de COMBOX inférée', () => {
    const payload={purchase_orders:[po,po],boxes:[{contents:[{order_id:'a',qty:3}]}]};
    const rows=summarizePurchaseOrders(market,payload);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({id:'p1',order_count:2,ordered:5,expected:5,received:3,missing:2,reception_complete:false});
    expect(rows[0].order_references).toEqual(['KAAAAAA','KBBBBBB']);
    expect(rows[0]).not.toHaveProperty('boxes');
    expect(JSON.stringify(rows)).not.toMatch(/unit_price|payment/);
  });
  test('un écart empêche de déclarer la réception complète', () => {
    const [row]=summarizePurchaseOrders(market,{purchase_orders:[{...po,lines:[{order_id:'a',confirmed:1,ordered:1,received:1,missing:0,anomaly:1}]}]});
    expect(row.reception_complete).toBe(false);
  });
  test('projection absente par défaut et interdite dans le scope marché, même opt-in', async () => {
    const query={query:jest.fn(async()=>({rows:[market]}))};
    const reader=jest.fn(async()=>({...empty([]),purchase_orders:[po]}));
    expect(await getGlobalBoard(query,reader)).not.toHaveProperty('purchase_orders');
    const central=await getGlobalBoard(query,reader,{includePurchaseOrders:true});
    expect(central.purchase_orders).toHaveLength(1);
    expect(await getGlobalBoard(query,reader,{marketIds:['km'],includePurchaseOrders:true})).not.toHaveProperty('purchase_orders');
  });
});

test('CANON-MARKET : PO marché en projection minimale, sans autre dossier ni secret fournisseur', async () => {
  const market = { id: 'm-cm', code: 'CM', name: 'Cameroun' };
  const query = { query: jest.fn(async (_sql, params) => ({
    rows: params && params[0].includes(market.id) ? [market] : [],
  })) };
  const reader = jest.fn(async id => {
    expect(id).toBe(market.id);
    return {
      ...empty([]),
      purchase_orders: [{
        id: 'po-mixed', ref: 'PO-1', supplier_name: 'SECRET_SUPPLIER',
        supplier_order_id: 'SECRET_ORDER', status: 'confirmed', stage: 'partially_received',
        sent_channel: 'SECRET_CHANNEL', authorizations: { commitment: { amount: 90000 } },
        lines: [{
          order_id: 'o-cm', order_ref: 'KAAAAAA', product: 'Article CM',
          product_sku_id: 'SECRET_SKU', unit_price: 9000, ordered: 3, confirmed: 3, received: 2, missing: 1,
        }],
      }],
      boxes: [{ state: 'PACKED', contents: [{ purchase_order_id: 'po-mixed', order_id: 'o-cm', qty: 2 }] }],
      receipts: [{ po_ids: ['po-mixed'], reference: 'SECRET_RECEIPT' }],
      to_handle: [{ po_id: 'po-mixed', kind: 'TEST', reason: 'SECRET_REASON' }],
    };
  });
  const result = await getGlobalBoard(query, reader, {
    marketIds: ['m-cm'], includePurchaseOrders: true, includeMarketPurchaseOrders: true,
  });
  expect(query.query).toHaveBeenCalledWith(expect.stringContaining('id = ANY($1::uuid[])'), [['m-cm']]);
  expect(reader).toHaveBeenCalledTimes(1);
  expect(result.audience).toBe('MARKET_SCOPED');
  expect(result.markets).toEqual(['CM']);
  expect(result.purchase_orders).toHaveLength(1);
  expect(result.purchase_orders[0]).toMatchObject({
    market: 'CM', market_scoped: true, order_references: ['KAAAAAA'],
    ordered: 3, expected: 3, received: 2, missing: 1, boxed_quantity: 2, reception_complete: false,
  });
  expect(result.purchase_orders[0].order_lines).toEqual([
    { order_ref: 'KAAAAAA', product: 'Article CM', ordered: 3, expected: 3, received: 2, missing: 1 },
  ]);
  expect(JSON.stringify(result)).not.toMatch(/SECRET_|unit_price|supplier_name|authorizations|receipt_evidence/);
  expect(result.logistics_work).toEqual([]);
  const denied = await getGlobalBoard(query, reader, { marketIds: [], includeMarketPurchaseOrders: true });
  expect(denied.purchase_orders).toEqual([]);
  expect(reader).toHaveBeenCalledTimes(1);
});

test('départ PO : trois faits distincts, carton partagé compté seulement pour ses allocations exactes',()=>{
  const po={id:'p1',lines:[{order_id:'a',confirmed:5,ordered:5,received:4,missing:1}]};
  const own={purchase_order_id:'p1',qty:1,order_id:'a'},other={purchase_order_id:'p2',qty:9,order_id:'a'};
  const boxes=[
    {state:'PACKED',contents:[own,other]},
    {state:'DISPATCHED',shipment_ref:'S1',shipment_stage:'hub_ready',contents:[own]},
    {state:'DISPATCHED',shipment_ref:'S2',shipment_stage:'handed_over',contents:[own,other]},
    {state:'QUARANTINED',contents:[own]},
    {state:'DISPATCHED',shipment_ref:'S2',shipment_stage:'handed_over',contents:[other]},
  ];
  const [r]=summarizePurchaseOrders({code:'KM'},{purchase_orders:[po],boxes});
  expect(r).toMatchObject({boxed_quantity:3,dispatched_quantity:2,handed_quantity:1,box_count:3,shipment_count:2,missing:1,reception_complete:false});
});

test('projection PO compacte : articles et FIFO strictement issus de la PO, sans données financières ou client',()=>{
  const own={order_id:'a',order_ref:'KAAAAAA',product:'Lampe',product_sku_id:'sku-1',ordered:3,confirmed:3,received:1,missing:2,fifo_rank:1,fifo_next:true,unit_price:99,client_email:'private@example.test'};
  const later={...own,order_id:'b',order_ref:'KBBBBBB',received:0,missing:3,fifo_rank:2,fifo_next:false};
  const foreign={...own,product:'Article autre PO',product_sku_id:'sku-2'};
  const rows=summarizePurchaseOrders({code:'KM'},{purchase_orders:[{id:'p1',lines:[own,later]},{id:'p2',lines:[foreign]}]});
  expect(rows[0].order_lines).toEqual([
    {order_ref:'KAAAAAA',product:'Lampe',product_sku_id:'sku-1',ordered:3,expected:3,received:1,missing:2,fifo_rank:1,fifo_next:true},
    {order_ref:'KBBBBBB',product:'Lampe',product_sku_id:'sku-1',ordered:3,expected:3,received:0,missing:3,fifo_rank:2,fifo_next:false}
  ]);
  expect(rows[0].order_lines).not.toContainEqual(expect.objectContaining({product:'Article autre PO'}));
  expect(JSON.stringify(rows[0])).not.toMatch(/unit_price|client_email|private@example/);
});

test('V8 : preuves de réception et exceptions limitées à la PO exacte',()=>{
 const payload={purchase_orders:[{id:'p1',sent_at:'2026-11-24',sent_channel:'email',confirmed_at:'2026-11-25',lines:[]}],
 receipts:[{reference:'REC-1',po_ids:['p1'],state:'QUALITY_CHECKED',received_at:'2026-11-25'},{reference:'REC-2',po_ids:['p2'],state:'RECEIVED'}],
 to_handle:[{po_id:'p1',kind:'PO_MISSING_QTY',reason:'Écart'},{po_id:'p2',kind:'PO_MISSING_QTY',reason:'Autre PO'}]};
 const [r]=summarizePurchaseOrders({code:'KM'},payload);
 expect(r.receipt_evidence).toEqual([{reference:'REC-1',state:'QUALITY_CHECKED',received_at:'2026-11-25'}]);
 expect(r.exceptions).toEqual([{kind:'PO_MISSING_QTY',reason:'Écart'}]);
 expect(r.sent_channel).toBe('email');
 expect(r).not.toHaveProperty('physical_settled');
});

test('charge logistique: comptage unique des cartons, distinction des rails et preuves de départ',()=>{
 const row=(relay,rail,state='QUALITY_CHECKED')=>({relais_id:relay,relais_code:relay,requested_transport_rail:rail,source_state:state,quantity:2});
 const a=row('A','SEA_STANDARD'),b=row('A','AIR_EXPRESS'),u=row('B',null);
 const box=(id,state,contents,shipment_ref=null,shipment_stage=null)=>({unit_id:id,state,contents,shipment_ref,shipment_stage});
 const ready=box('one','DISPATCHED',[a,a]);
 const payload={fillable:[a,b,u,row('C','SEA_STANDARD','RECEIVED')],boxes:[
  ready,ready,box('two','PACKED',[a]),box('three','PICKED',[a]),box('four','DISPATCHED',[b],'S','hub_ready'),
  box('five','DISPATCHED',[b],'T','handed_over'),box('six','QUARANTINED',[a]),box('seven','PACKED',[a,b])
 ]};
 const groups=summarizeLogisticsWork({code:'CM'},payload);
 expect(groups).toHaveLength(3);
 expect(groups.find(g=>g.rail==='SEA_STANDARD')).toMatchObject({market:'CM',relay:'A',to_pack:2,boxes_in_progress:1,boxes_to_dispatch:1,boxes_to_attach:1,boxes_to_handover:0});
 expect(groups.find(g=>g.rail==='AIR_EXPRESS')).toMatchObject({to_pack:2,boxes_to_handover:1,boxes_to_attach:0});
 expect(groups.find(g=>g.rail===null)).toMatchObject({relay:'B',to_pack:2});
});
test('charge logistique centrale uniquement, scope marché sans projection',async()=>{
 const query={query:jest.fn(async()=>({rows:[{id:'m1',code:'CM',name:'Cameroun'}]}))};
 const reader=jest.fn(async()=>({...empty([]),fillable:[{relais_id:'r1',requested_transport_rail:'AIR_EXPRESS',quantity:2,source_state:'QUALITY_CHECKED'}]}));
 expect((await getGlobalBoard(query,reader,{includePurchaseOrders:true})).logistics_work).toHaveLength(1);
 expect(await getGlobalBoard(query,reader,{marketIds:['m1'],includePurchaseOrders:true})).not.toHaveProperty('logistics_work');
});
