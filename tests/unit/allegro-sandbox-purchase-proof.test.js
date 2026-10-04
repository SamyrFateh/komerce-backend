'use strict';

jest.mock('../../db', () => ({ query: jest.fn(), pool: { end: jest.fn() } }));
jest.mock('../../services/purchasing-admin-service', () => ({ confirmPurchaseOrder: jest.fn() }));

const { purchaseOrderId, run } = require('../../scripts/allegro-sandbox-purchase-proof');

const poId = '11111111-1111-4111-8111-111111111111';
const orderId = '22222222-2222-4222-8222-222222222222';
const checkoutId = '29738e61-7f6a-11e8-ac45-09db60ede9d6';
const identity = { provider: 'allegro', version: 1, payload: { environment: 'sandbox', offer_id: '123' } };

function po(overrides = {}) {
  return {
    id: poId,
    order_id: orderId,
    status: 'notified',
    supplier_order_id: null,
    supplier_sku: 'allegro-sandbox:123',
    supplier_unit_ref: '123',
    supplier_order_identity: identity,
    qty: 1,
    product_sku_id: '33333333-3333-4333-8333-333333333333',
    supplier_unit_price: '10.00',
    supplier_currency: 'PLN',
    created_at: '2026-09-17T22:34:00.000Z',
    ...overrides,
  };
}

function scopeRow(overrides = {}) {
  return {
    purchase_line_id: '44444444-4444-4444-8444-444444444444',
    order_item_id: '55555555-5555-4555-8555-555555555555',
    order_id: orderId,
    market_id: '66666666-6666-4666-8666-666666666666',
    product_sku_id: '33333333-3333-4333-8333-333333333333',
    supplier_id: '77777777-7777-4777-8777-777777777777',
    supplier_unit_ref: '123',
    supplier_order_identity: identity,
    confirmed_quantity: 1,
    confirmed_unit_price: '10.00',
    supplier_currency: 'PLN',
    ...overrides,
  };
}

function deps(row = po(), scope = scopeRow()) {
  const query = jest.fn(async (sql) => {
    if (/FROM purchase_orders/.test(sql)) return { rows: row ? [row] : [] };
    if (/FROM purchase_lines/.test(sql)) return { rows: scope ? [scope] : [] };
    throw new Error(`SQL inattendu: ${sql}`);
  });
  return {
    dbImpl: { query },
    discover: jest.fn().mockResolvedValue({
      checkoutFormId: checkoutId,
      provider_status: 'READY_FOR_PROCESSING',
      bought_at: '2026-09-17T22:50:00.000Z',
    }),
    reconcile: jest.fn().mockResolvedValue({
      verified: true,
      provider: 'allegro',
      environment: 'sandbox',
      supplier_order_id: checkoutId,
      supplier_unit_ref: '123',
      supplier_sku: 'allegro-sandbox:123',
      quantity: 1,
      provider_status: 'READY_FOR_PROCESSING',
      unit_price: 10,
      currency: 'PLN',
    }),
    confirm: jest.fn().mockResolvedValue({ purchase_order: { id: poId, status: 'confirmed' } }),
  };
}

test('one-argument runner discovers the exact paid Allegro order then confirms the PO', async () => {
  const d = deps();
  const out = await run([poId], d);
  expect(d.discover).toHaveBeenCalledWith({
    identity,
    supplierUnitRef: '123',
    supplierSku: 'allegro-sandbox:123',
    quantity: 1,
    expectedUnitPrice: '10.00',
    expectedCurrency: 'PLN',
    boughtAtGte: '2026-09-17T22:34:00.000Z',
  });
  expect(d.reconcile).toHaveBeenCalledWith({
    checkoutFormId: checkoutId,
    identity,
    supplierUnitRef: '123',
    supplierSku: 'allegro-sandbox:123',
    quantity: 1,
  });
  expect(d.confirm).toHaveBeenCalledWith(poId, orderId, { supplier_order_id: checkoutId });
  expect(out).toMatchObject({
    purchase_confirmed: true,
    discovered_checkout_form: true,
    proof: { supplier_order_id: checkoutId },
    scope: {
      order_id: orderId,
      market_id: '66666666-6666-4666-8666-666666666666',
      confirmed_quantity: 1,
      confirmed_unit_price: '10.00',
      supplier_currency: 'PLN',
    },
  });
});

test('verified Allegro order confirms exactly the persisted Komerce PO', async () => {
  const d = deps();
  const out = await run([poId, checkoutId], d);
  expect(d.reconcile).toHaveBeenCalledWith({
    checkoutFormId: checkoutId,
    identity,
    supplierUnitRef: '123',
    supplierSku: 'allegro-sandbox:123',
    quantity: 1,
  });
  expect(d.confirm).toHaveBeenCalledWith(poId, orderId, { supplier_order_id: checkoutId });
  expect(out).toMatchObject({
    purchase_order_id: poId,
    order_id: orderId,
    purchase_confirmed: true,
    already_confirmed: false,
    discovered_checkout_form: false,
    purchase_order_status: 'confirmed',
    proof: { verified: true, supplier_order_id: checkoutId },
    scope: {
      purchase_line_id: '44444444-4444-4444-8444-444444444444',
      order_id: orderId,
      market_id: '66666666-6666-4666-8666-666666666666',
      product_sku_id: '33333333-3333-4333-8333-333333333333',
      confirmed_quantity: 1,
      confirmed_unit_price: '10.00',
      supplier_currency: 'PLN',
    },
  });
});

test('replay is idempotent when the same verified supplier order is already attached', async () => {
  const d = deps(po({ status: 'confirmed', supplier_order_id: checkoutId }));
  const out = await run([poId, checkoutId], d);
  expect(out).toMatchObject({ purchase_confirmed: true, already_confirmed: true, discovered_checkout_form: false });
  expect(d.reconcile).toHaveBeenCalledTimes(1);
  expect(d.confirm).not.toHaveBeenCalled();
});

test('confirmed PO cannot be rebound to a different Allegro order', async () => {
  const d = deps(po({ status: 'confirmed', supplier_order_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }));
  await expect(run([poId, checkoutId], d)).rejects.toThrow('ALREADY_CONFIRMED_WITH_DIFFERENT_SUPPLIER_ORDER');
  expect(d.confirm).not.toHaveBeenCalled();
});

test('non-reconcilable statuses and incomplete historical POs fail closed', async () => {
  await expect(run([poId, checkoutId], deps(po({ status: 'cancelled' })))).rejects.toThrow('STATUS_NOT_RECONCILABLE');
  await expect(run([poId, checkoutId], deps(po({ product_sku_id: null })))).rejects.toThrow('EXACT_IDENTITY_REQUIRED');
});


test.each([
  ['aucune ligne active', null, 'PURCHASE_SCOPE_NOT_EXACT_0'],
  ['mauvais order', scopeRow({ order_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }), 'PURCHASE_SCOPE_ORDER_MISMATCH'],
  ['mauvais SKU', scopeRow({ product_sku_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }), 'PURCHASE_SCOPE_SKU_MISMATCH'],
  ['mauvaise unité', scopeRow({ supplier_unit_ref: '999' }), 'PURCHASE_SCOPE_UNIT_MISMATCH'],
  ['marché absent', scopeRow({ market_id: null }), 'PURCHASE_SCOPE_MARKET_MISSING'],
  ['quantité confirmée incohérente', scopeRow({ confirmed_quantity: 2 }), 'PURCHASE_SCOPE_QUANTITY_MISMATCH'],
  ['prix confirmé incohérent', scopeRow({ confirmed_unit_price: '11.00' }), 'PURCHASE_SCOPE_CONFIRMED_PRICE_MISMATCH'],
  ['devise incohérente', scopeRow({ supplier_currency: 'EUR' }), 'PURCHASE_SCOPE_CURRENCY_MISMATCH'],
])('scope confirmé fail-closed — %s', async (_label, scope, code) => {
  const d = deps(po(), scope);
  await expect(run([poId, checkoutId], d)).rejects.toThrow(code);
});

test('bad args and missing PO fail before reconciliation', async () => {
  expect(() => purchaseOrderId('bad')).toThrow('PURCHASE_ORDER_ID_INVALID');
  await expect(run([], deps())).rejects.toThrow('Usage');
  await expect(run([poId, checkoutId, checkoutId], deps())).rejects.toThrow('Usage');
  const d = deps(null);
  await expect(run([poId, checkoutId], d)).rejects.toThrow('PURCHASE_ORDER_NOT_FOUND');
  expect(d.reconcile).not.toHaveBeenCalled();
});
