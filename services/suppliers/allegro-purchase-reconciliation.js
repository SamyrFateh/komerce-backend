/**
 * @komerce-arch
 * @role          allegro-sandbox-purchase-reconciliation
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        checkoutForm id, expected Supplier Order Identity, quantity
 * @outputs       sanitized verified supplier purchase evidence
 * @depends       services/suppliers/allegro-sandbox-client.js
 * @used-by       scripts/allegro-sandbox-purchase-proof.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_PROCUREMENT_FULFILLMENT.md
 * @impact-areas  purchasing, supplier-integration
 */
'use strict';

const sandboxClient = require('./allegro-sandbox-client');

const READY_STATUS = 'READY_FOR_PROCESSING';

function expectedOfferId(identity, { supplierUnitRef, supplierSku } = {}) {
  const id = identity?.payload?.offer_id;
  if (identity?.provider !== 'allegro' || identity?.version !== 1
    || identity?.payload?.environment !== 'sandbox'
    || typeof id !== 'string' || !/^[0-9]{1,30}$/.test(id)) {
    throw new Error('ALLEGRO_RECONCILIATION_IDENTITY_MISMATCH');
  }
  if (supplierUnitRef != null && String(supplierUnitRef) !== id) {
    throw new Error('ALLEGRO_RECONCILIATION_UNIT_REF_MISMATCH');
  }
  if (supplierSku != null && String(supplierSku) !== `allegro-sandbox:${id}`) {
    throw new Error('ALLEGRO_RECONCILIATION_SKU_MISMATCH');
  }
  return id;
}

function verifyCheckoutForm(payload, options = {}) {
  const expectedId = String(options.checkoutFormId || '').trim().toLowerCase();
  const offerId = expectedOfferId(options.identity, options);
  const quantity = options.quantity;

  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new Error('ALLEGRO_RECONCILIATION_QUANTITY_INVALID');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('ALLEGRO_RECONCILIATION_RESPONSE_INVALID');
  }
  if (String(payload.id || '').trim().toLowerCase() !== expectedId) {
    throw new Error('ALLEGRO_RECONCILIATION_CHECKOUT_ID_MISMATCH');
  }
  // Allegro defines READY_FOR_PROCESSING as payment completed and the purchase
  // ready for seller processing. BOUGHT/FILLED_IN are intentionally insufficient.
  if (payload.status !== READY_STATUS) {
    throw new Error(`ALLEGRO_RECONCILIATION_NOT_READY:${String(payload.status || 'UNKNOWN')}`);
  }
  if (!Array.isArray(payload.lineItems) || payload.lineItems.length !== 1) {
    throw new Error(`ALLEGRO_RECONCILIATION_LINE_ITEMS_UNSUPPORTED:${Array.isArray(payload.lineItems) ? payload.lineItems.length : 'INVALID'}`);
  }

  const line = payload.lineItems[0];
  if (String(line?.offer?.id || '') !== offerId) {
    throw new Error('ALLEGRO_RECONCILIATION_OFFER_MISMATCH');
  }
  if (!Number.isSafeInteger(line?.quantity) || line.quantity !== quantity) {
    throw new Error('ALLEGRO_RECONCILIATION_QUANTITY_MISMATCH');
  }

  const amountRaw = line?.price?.amount;
  const currency = String(line?.price?.currency || '').trim().toUpperCase();
  const amount = typeof amountRaw === 'string' && /^[0-9]+(?:\.[0-9]{1,2})?$/.test(amountRaw)
    ? Number(amountRaw)
    : null;
  if (!(amount > 0) || currency !== 'PLN') {
    throw new Error('ALLEGRO_RECONCILIATION_PRICE_INVALID');
  }

  return {
    verified: true,
    provider: 'allegro',
    environment: 'sandbox',
    supplier_order_id: expectedId,
    supplier_unit_ref: offerId,
    supplier_sku: `allegro-sandbox:${offerId}`,
    quantity,
    provider_status: READY_STATUS,
    unit_price: amount,
    currency,
    line_item_id: typeof line.id === 'string' ? line.id : null,
    bought_at: typeof line.boughtAt === 'string' ? line.boughtAt : null,
    checkout_revision: typeof payload?.revision === 'string' ? payload.revision : null,
  };
}

function expectedDiscoveryMoney(options = {}) {
  const amount = options.expectedUnitPrice == null ? null : Number(options.expectedUnitPrice);
  const currency = options.expectedCurrency == null
    ? null
    : String(options.expectedCurrency).trim().toUpperCase();
  if (amount != null && (!Number.isFinite(amount) || amount <= 0)) {
    throw new Error('ALLEGRO_RECONCILIATION_EXPECTED_PRICE_INVALID');
  }
  if (currency != null && currency !== 'PLN') {
    throw new Error('ALLEGRO_RECONCILIATION_EXPECTED_CURRENCY_INVALID');
  }
  return { amount, currency };
}

function discoveryMatch(payload, options = {}) {
  try {
    const proof = verifyCheckoutForm(payload, {
      ...options,
      checkoutFormId: payload?.id,
    });
    const expected = expectedDiscoveryMoney(options);
    if (expected.amount != null && proof.unit_price.toFixed(2) !== expected.amount.toFixed(2)) return null;
    if (expected.currency != null && proof.currency !== expected.currency) return null;
    return proof;
  } catch {
    return null;
  }
}

async function discoverCheckoutForm(options = {}) {
  const api = options.client || sandboxClient;
  if (!api || typeof api.listSellerOrders !== 'function') {
    throw new Error('ALLEGRO_RECONCILIATION_DISCOVERY_CLIENT_INVALID');
  }
  expectedOfferId(options.identity, options);
  if (!Number.isSafeInteger(options.quantity) || options.quantity < 1) {
    throw new Error('ALLEGRO_RECONCILIATION_QUANTITY_INVALID');
  }
  expectedDiscoveryMoney(options);

  const listed = await api.listSellerOrders({
    status: READY_STATUS,
    limit: 20,
    boughtAtGte: options.boughtAtGte || null,
  });
  if (!listed || !Array.isArray(listed.checkoutForms)) {
    throw new Error('ALLEGRO_RECONCILIATION_DISCOVERY_RESPONSE_INVALID');
  }
  const matches = listed.checkoutForms
    .map(row => discoveryMatch(row, options))
    .filter(Boolean);

  if (matches.length === 0) throw new Error('ALLEGRO_RECONCILIATION_ORDER_NOT_FOUND');
  if (matches.length > 1) throw new Error('ALLEGRO_RECONCILIATION_ORDER_AMBIGUOUS');

  return {
    checkoutFormId: matches[0].supplier_order_id,
    provider_status: matches[0].provider_status,
    bought_at: matches[0].bought_at,
  };
}

async function reconcile(options = {}) {
  const api = options.client || sandboxClient;
  if (!api || typeof api.getSellerOrder !== 'function') {
    throw new Error('ALLEGRO_RECONCILIATION_CLIENT_INVALID');
  }
  const payload = await api.getSellerOrder(options.checkoutFormId);
  return verifyCheckoutForm(payload, options);
}

module.exports = {
  READY_STATUS,
  expectedOfferId,
  verifyCheckoutForm,
  expectedDiscoveryMoney,
  discoveryMatch,
  discoverCheckoutForm,
  reconcile,
};
