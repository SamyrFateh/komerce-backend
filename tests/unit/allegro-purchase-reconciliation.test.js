'use strict';

const reconciliation = require('../../services/suppliers/allegro-purchase-reconciliation');

const checkoutId = '29738e61-7f6a-11e8-ac45-09db60ede9d6';
const identity = { provider: 'allegro', version: 1, payload: { environment: 'sandbox', offer_id: '123' } };

function payload(overrides = {}) {
  return {
    id: checkoutId,
    status: 'READY_FOR_PROCESSING',
    revision: '819b5836',
    lineItems: [{
      id: '62ae358b-8f65-4fc4-9c77-bedf604a2e2b',
      offer: { id: '123', name: 'Sandbox product' },
      quantity: 1,
      price: { amount: '10.00', currency: 'PLN' },
      boughtAt: '2026-09-16T10:00:00.000Z',
    }],
    ...overrides,
  };
}

function options(overrides = {}) {
  return {
    checkoutFormId: checkoutId,
    identity,
    supplierUnitRef: '123',
    supplierSku: 'allegro-sandbox:123',
    quantity: 1,
    ...overrides,
  };
}

test('READY_FOR_PROCESSING exact one-line purchase produces sanitized proof', () => {
  expect(reconciliation.verifyCheckoutForm(payload(), options())).toEqual({
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
    line_item_id: '62ae358b-8f65-4fc4-9c77-bedf604a2e2b',
    bought_at: '2026-09-16T10:00:00.000Z',
    checkout_revision: '819b5836',
  });
});

test.each(['BOUGHT', 'FILLED_IN', 'CANCELLED', undefined])('status %s is not accepted as a paid supplier purchase', status => {
  expect(() => reconciliation.verifyCheckoutForm(payload({ status }), options())).toThrow('RECONCILIATION_NOT_READY');
});

test('identity, unit ref and supplier SKU must all refer to the exact Allegro offer', () => {
  expect(() => reconciliation.expectedOfferId(null)).toThrow('IDENTITY_MISMATCH');
  expect(() => reconciliation.expectedOfferId({ ...identity, version: 2 })).toThrow('IDENTITY_MISMATCH');
  expect(() => reconciliation.expectedOfferId({ provider: 'allegro', version: 1, payload: { environment: 'production', offer_id: '123' } })).toThrow('IDENTITY_MISMATCH');
  expect(() => reconciliation.expectedOfferId(identity, { supplierUnitRef: '999' })).toThrow('UNIT_REF_MISMATCH');
  expect(() => reconciliation.expectedOfferId(identity, { supplierSku: 'wrong' })).toThrow('SKU_MISMATCH');
});

test('checkout id, offer id, quantity and price mismatches fail closed', () => {
  expect(() => reconciliation.verifyCheckoutForm(payload({ id: '11111111-1111-4111-8111-111111111111' }), options())).toThrow('CHECKOUT_ID_MISMATCH');
  expect(() => reconciliation.verifyCheckoutForm(payload({ lineItems: [{ ...payload().lineItems[0], offer: { id: '999' } }] }), options())).toThrow('OFFER_MISMATCH');
  expect(() => reconciliation.verifyCheckoutForm(payload({ lineItems: [{ ...payload().lineItems[0], quantity: 2 }] }), options())).toThrow('QUANTITY_MISMATCH');
  expect(() => reconciliation.verifyCheckoutForm(payload({ lineItems: [{ ...payload().lineItems[0], price: { amount: '0.00', currency: 'PLN' } }] }), options())).toThrow('PRICE_INVALID');
  expect(() => reconciliation.verifyCheckoutForm(payload({ lineItems: [{ ...payload().lineItems[0], price: { amount: '10.00', currency: 'EUR' } }] }), options())).toThrow('PRICE_INVALID');
});

test('multi-line or malformed supplier order cannot certify the one-product Golden purchase', () => {
  expect(() => reconciliation.verifyCheckoutForm(payload({ lineItems: [] }), options())).toThrow('LINE_ITEMS_UNSUPPORTED');
  expect(() => reconciliation.verifyCheckoutForm(payload({ lineItems: [payload().lineItems[0], payload().lineItems[0]] }), options())).toThrow('LINE_ITEMS_UNSUPPORTED');
  expect(() => reconciliation.verifyCheckoutForm(null, options())).toThrow('RESPONSE_INVALID');
  expect(() => reconciliation.verifyCheckoutForm(payload(), options({ quantity: 0 }))).toThrow('QUANTITY_INVALID');
});

test('reconcile delegates only the checkout id to the sandbox client then validates locally', async () => {
  const client = { getSellerOrder: jest.fn().mockResolvedValue(payload()) };
  await expect(reconciliation.reconcile({ ...options(), client })).resolves.toMatchObject({ verified: true, supplier_order_id: checkoutId });
  expect(client.getSellerOrder).toHaveBeenCalledWith(checkoutId);
});
