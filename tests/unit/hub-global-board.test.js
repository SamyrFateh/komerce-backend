'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { summarizeMarket, getGlobalBoard } = require('../../services/hub-global-board');

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
      remaining:'2 non reçue(s)',attention:true,
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
    expect(row.remaining).toBe('1 non reçue(s)');
    expect(row.remaining_detail).toContain('1 à contrôler');
    expect(row.departure).toBe('1 expédition(s) liée(s)');
    expect(row.departure).not.toMatch(/livré|remis/i);
    expect(row.next_action).toBe('Contrôler les écarts');
    expect(row.stage_states).toMatchObject({reception:'warning',remaining:'critical',departure:'progress'});
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

  test('aucune ligne de commande import : tableau vide, sans inventer des mouvements', async () => {
    const r=await getGlobalBoard({query:async ()=>({rows:[]})},jest.fn());
    expect(r).toEqual({scope:'HUB_GLOBAL',markets:[],orders:[]});
  });
});
