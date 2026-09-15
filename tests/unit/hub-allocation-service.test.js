'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const {
  resolvePurchaseAllocation,
  assertParcelCompatible,
  assertParcelPhysicalReadiness,
} = require('../../services/hub-allocation-service');

function scripted(results) {
  const query = jest.fn();
  for (const result of results) query.mockResolvedValueOnce(result);
  return { query };
}

const item = {
  order_item_id: 'oi-1', order_id: 'ord-1', product_id: 'prod-1', sku_id: 'sku-1',
  ordered_quantity: 2, fulfillment_source: 'IMPORT', market_id: 'm-1', relais_id: 'r-1',
};
const po = {
  purchase_order_id: 'po-1', purchase_order_order_id: 'ord-1', purchase_order_item_id: 'oi-1',
  product_sku_id: 'sku-1', supplier_id: 'sup-1', product_supplier_id: 'ps-1',
  supplier_sku: 'S-1', supplier_unit_ref: 'U-1',
  supplier_order_identity: { provider: 'cj', version: 1, payload: { pid: 'p', vid: 'v' } },
  purchase_quantity: 2, purchase_status: 'confirmed',
};

describe('resolvePurchaseAllocation', () => {
  test('résout exactement une PO et conserve la vérité amont', async () => {
    const db = scripted([
      { rows: [item] },
      { rows: [po] },
      { rows: [{ received_quantity: 0 }] },
    ]);
    const result = await resolvePurchaseAllocation(db, { orderItemId: 'oi-1', quantity: 1 });
    expect(result).toMatchObject({
      order_item_id: 'oi-1', order_id: 'ord-1', purchase_order_id: 'po-1',
      market_id: 'm-1', relais_id: 'r-1', identity_strength: 'EXACT_SUPPLIER_UNIT',
    });
    expect(db.query.mock.calls[1][0]).toContain('FOR UPDATE');
  });

  test('0 PO active => fail-closed', async () => {
    const db = scripted([{ rows: [item] }, { rows: [] }]);
    await expect(resolvePurchaseAllocation(db, { orderItemId: 'oi-1' }))
      .rejects.toMatchObject({ code: 'HUB_PURCHASE_ALLOCATION_NOT_FOUND' });
  });

  test('>1 PO sans purchase_order_id explicite => ambigu', async () => {
    const db = scripted([{ rows: [item] }, { rows: [po, { ...po, purchase_order_id: 'po-2' }] }]);
    await expect(resolvePurchaseAllocation(db, { orderItemId: 'oi-1' }))
      .rejects.toMatchObject({ code: 'HUB_PURCHASE_ALLOCATION_AMBIGUOUS' });
  });

  test('SKU vendu sans SOI exacte sur la PO => bloqué', async () => {
    const db = scripted([
      { rows: [item] },
      { rows: [{ ...po, supplier_order_identity: null }] },
    ]);
    await expect(resolvePurchaseAllocation(db, { orderItemId: 'oi-1' }))
      .rejects.toMatchObject({ code: 'HUB_SUPPLIER_IDENTITY_UNPROVEN' });
  });

  test('réception au-delà de la quantité achetée => bloquée', async () => {
    const db = scripted([
      { rows: [item] },
      { rows: [po] },
      { rows: [{ received_quantity: 2 }] },
    ]);
    await expect(resolvePurchaseAllocation(db, { orderItemId: 'oi-1', quantity: 1 }))
      .rejects.toMatchObject({ code: 'HUB_RECEIPT_OVER_PURCHASE_QUANTITY' });
  });
});

describe('assertParcelCompatible', () => {
  test('même Relais/Market accepte le merge physique de commandes compatibles', async () => {
    const db = scripted([
      { rows: [{ id: 'p-1', reference: 'P1', status: 'preparation', anchor_order_id: 'other-order', relais_id: 'r-1', parcel_market_id: 'm-1' }] },
      { rows: [{ market_count: 1, relais_count: 1, all_same_market: true, all_same_relais: true }] },
    ]);
    await expect(assertParcelCompatible(db, { parcelId: 'p-1', allocation: item }))
      .resolves.toMatchObject({ id: 'p-1' });
  });

  test('autre Relais => aucune réassignation silencieuse', async () => {
    const db = scripted([
      { rows: [{ id: 'p-2', reference: 'P2', status: 'preparation', relais_id: 'r-2', parcel_market_id: 'm-1' }] },
    ]);
    await expect(assertParcelCompatible(db, { parcelId: 'p-2', allocation: item }))
      .rejects.toMatchObject({ code: 'HUB_DESTINATION_REASSIGNMENT_FORBIDDEN' });
  });

  test('autre Market => bloqué', async () => {
    const db = scripted([
      { rows: [{ id: 'p-3', reference: 'P3', status: 'preparation', relais_id: 'r-1', parcel_market_id: 'm-2' }] },
    ]);
    await expect(assertParcelCompatible(db, { parcelId: 'p-3', allocation: item }))
      .rejects.toMatchObject({ code: 'HUB_MARKET_REASSIGNMENT_FORBIDDEN' });
  });
});

describe('assertParcelPhysicalReadiness', () => {
  test('Market Parcel homogène + IMPORT totalement prouvé => ready', async () => {
    const db = scripted([
      { rows: [{ id: 'p-1', reference: 'P1', relais_id: 'r-1', parcel_market_id: 'm-1' }] },
      { rows: [{ market_count: 1, relais_count: 1, all_same_market: true, all_same_relais: true }] },
      { rows: [{ order_item_id: 'oi-1', fulfillment_source: 'IMPORT', parcel_quantity: 2, proven_physical_quantity: 2 }] },
    ]);
    await expect(assertParcelPhysicalReadiness(db, 'p-1')).resolves.toEqual({
      ready: true, parcel_id: 'p-1', market_id: 'm-1', relais_id: 'r-1',
    });
  });

  test('IMPORT non couvert physiquement => seal bloqué', async () => {
    const db = scripted([
      { rows: [{ id: 'p-1', reference: 'P1', relais_id: 'r-1', parcel_market_id: 'm-1' }] },
      { rows: [{ market_count: 1, relais_count: 1, all_same_market: true, all_same_relais: true }] },
      { rows: [{ order_item_id: 'oi-1', fulfillment_source: 'IMPORT', parcel_quantity: 2, proven_physical_quantity: 1 }] },
    ]);
    await expect(assertParcelPhysicalReadiness(db, 'p-1'))
      .rejects.toMatchObject({ code: 'HUB_PHYSICAL_ALLOCATION_INCOMPLETE' });
  });

  test('colis à plusieurs Markets => bloqué avant expédition', async () => {
    const db = scripted([
      { rows: [{ id: 'p-x', reference: 'PX', relais_id: 'r-1', parcel_market_id: 'm-1' }] },
      { rows: [{ market_count: 2, relais_count: 2, all_same_market: false, all_same_relais: false }] },
    ]);
    await expect(assertParcelPhysicalReadiness(db, 'p-x'))
      .rejects.toMatchObject({ code: 'HUB_PARCEL_MARKET_CONFLICT' });
  });
});
