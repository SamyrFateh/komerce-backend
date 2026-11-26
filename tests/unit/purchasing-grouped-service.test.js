'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const grouped = require('../../services/purchasing-grouped-service');

describe('purchasing-grouped-service — dossiers mono-marché', () => {
  test('exports the grouped purchasing orchestration surface', () => {
    expect(grouped).toBeTruthy();
    expect(typeof grouped.preparePurchaseOrder).toBe('function');
    expect(typeof grouped.attachDraftLines).toBe('function');
    expect(typeof grouped.detachLines).toBe('function');
  });

  test('sépare les besoins par fournisseur, hub ET marché sans renommer un marché au navigateur', async () => {
    const shared = {
      supplier_id: 'supplier-a',
      supplier_name: 'Fournisseur A',
      procurement_hub_ref: 'DXB',
      supplier_currency: 'USD',
      supplier_unit_price: 10,
      supplier_unit_ref: 'VARIANT-A',
      product_sku_id: 'sku-1',
      supplier_order_identity: { provider: 'demo', payload: { sku: 'VARIANT-A' } },
      quantity: 2,
      groupable: true,
    };
    const rows = [
      { ...shared, id: 'line-km1', market_id: 'market-km', market_code: 'KM', market_name: 'Comores' },
      { ...shared, id: 'line-km2', market_id: 'market-km', market_code: 'KM', market_name: 'Comores', quantity: 3 },
      { ...shared, id: 'line-cm1', market_id: 'market-cm', market_code: 'CM', market_name: 'Cameroun' },
    ];
    const query = jest.fn().mockResolvedValue({ rows });
    const out = await grouped.listOpenLines({}, { query });
    expect(out.total_lines).toBe(3);
    expect(out.groups).toHaveLength(2);
    const km = out.groups.find((g) => g.market_code === 'KM');
    const cm = out.groups.find((g) => g.market_code === 'CM');
    expect(km.market_id).toBe('market-km');
    expect(km.multi_market).toBe(false);
    expect(km.lines).toHaveLength(2);
    expect(km.by_supplier_unit_ref).toEqual([{ supplier_unit_ref: 'VARIANT-A', quantity: 5, lines: 2 }]);
    expect(cm.market_id).toBe('market-cm');
    expect(cm.lines).toHaveLength(1);
    expect(query).toHaveBeenCalledTimes(1);
  });
});


describe('P0 éligibilité achat commercial / remplacement SAV',()=>{
 const guard=grouped.shared.assertCommercialPurchaseItem;
 const nominal={fulfillment_source:'IMPORT',order_status:'ordered',payment_status:'paid'};
 test('IMPORT payé accepté, aucun oracle SAV requis',async()=>{
   const q={query:jest.fn()};
   await expect(guard(q,nominal)).resolves.toBeUndefined();
   expect(q.query).not.toHaveBeenCalled();
 });
 test.each(['pending','failed','partially_paid','refunded',null])('paiement %s refusé',async payment_status=>{
   await expect(guard({query:jest.fn()},{...nominal,payment_status})).rejects.toMatchObject({status:409,code:'ORDER_PAYMENT_NOT_CONFIRMED'});
 });
 test('LOCAL_STOCK et commande annulée refusés même payés',async()=>{
   await expect(guard({}, {...nominal,fulfillment_source:'LOCAL_STOCK'})).rejects.toMatchObject({code:'ORDER_ITEM_LOCAL_STOCK'});
   await expect(guard({}, {...nominal,order_status:'cancelled'})).rejects.toMatchObject({code:'ORDER_CANCELLED'});
 });
 test('SAV : ni mode seul ni paiement artificiel ne remplacent les preuves',async()=>{
   const row={...nominal,payment_status:'pending',payment_mode:'sav_replacement',commercial_order_id:'replacement',commercial_item_id:'item'};
   const q={query:jest.fn().mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{id:'compensation'}]})};
   await expect(guard(q,row)).rejects.toMatchObject({code:'PURCHASE_SAV_PROOF_REQUIRED'});
   await expect(guard(q,row)).resolves.toBeUndefined();
   expect(q.query).toHaveBeenLastCalledWith(expect.stringContaining("replacement.replacement_source_item_id=origin.id"),['replacement','item']);
 });
});
