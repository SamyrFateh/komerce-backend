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

function deps(row = po()) {
  return {
    dbImpl: { query: jest.fn().mockResolvedValue({ rows: row ? [row] : [] }) },
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

test('bad args and missing PO fail before reconciliation', async () => {
  expect(() => purchaseOrderId('bad')).toThrow('PURCHASE_ORDER_ID_INVALID');
  await expect(run([], deps())).rejects.toThrow('Usage');
  await expect(run([poId, checkoutId, checkoutId], deps())).rejects.toThrow('Usage');
  const d = deps(null);
  await expect(run([poId, checkoutId], d)).rejects.toThrow('PURCHASE_ORDER_NOT_FOUND');
  expect(d.reconcile).not.toHaveBeenCalled();
});
