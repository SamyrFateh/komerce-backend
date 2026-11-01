'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const grouped = require('../../services/purchasing-grouped-service');

describe('purchasing-grouped-service — dossiers mono-marché', () => {
  const prior = process.env.KOMERCE_GROUPED_PURCHASING;
  afterAll(() => {
    if (prior === undefined) delete process.env.KOMERCE_GROUPED_PURCHASING;
    else process.env.KOMERCE_GROUPED_PURCHASING = prior;
  });

  test('exports the grouped purchasing orchestration surface', () => {
    expect(grouped).toBeTruthy();
    expect(typeof grouped.preparePurchaseOrder).toBe('function');
    expect(typeof grouped.attachDraftLines).toBe('function');
    expect(typeof grouped.detachLines).toBe('function');
  });

  test('sépare les besoins par fournisseur, hub ET marché sans renommer un marché au navigateur', async () => {
    process.env.KOMERCE_GROUPED_PURCHASING = '1';
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
