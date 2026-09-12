'use strict';

const supplierIdentity = require('./supplier-order-identity');
const aliexpressAdapter = require('./aliexpress-fulfillment-adapter');

const VERDICT = Object.freeze({
  READY: 'FULFILLMENT_READY',
  BLOCKED_IDENTITY: 'BLOCKED_SUPPLIER_IDENTITY',
  SKU_INACTIVE: 'SKU_INACTIVE',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  SUPPLIER_UNAVAILABLE: 'SUPPLIER_UNAVAILABLE',
  PRICE_DRIFT_BLOCKED: 'PRICE_DRIFT_BLOCKED',
  NOT_SHIPPABLE: 'NOT_SHIPPABLE',
  FREIGHT_UNAVAILABLE: 'FREIGHT_UNAVAILABLE',
  PREFLIGHT_FAILED: 'PREFLIGHT_FAILED',
});

const DEFAULT_ADAPTERS = Object.freeze({ aliexpress: aliexpressAdapter });

function result(status, evidence = {}, reason = null) {
  return { ready: status === VERDICT.READY, status, reason, evidence };
}

async function loadPersistedSku(db, productSkuId) {
  const { rows: [row] } = await db.query(
    `SELECT id, product_id, supplier_sku, supplier_unit_ref,
            supplier_order_identity, stock, is_active, source
       FROM product_skus
      WHERE id = $1`,
    [productSkuId]
  );
  if (!row) {
    const error = new Error('product_sku introuvable');
    error.status = 404;
    throw error;
  }
  return row;
}

function canonicalIdentity(row) {
  if (!row.supplier_unit_ref || !row.supplier_order_identity) {
    throw supplierIdentity.blockedSupplierIdentity(
      'Supplier Order Identity persistée requise avant fulfillment preflight',
      { product_sku_id: row.id }
    );
  }
  return supplierIdentity.normalizeIdentity(row.supplier_order_identity, row.supplier_unit_ref);
}

async function evaluateSupplierFulfillmentReadiness(options = {}) {
  const { db, productSkuId, destination = {}, context = {} } = options;
  const adapters = { ...DEFAULT_ADAPTERS, ...(options.adapters || {}) };
  if (!db || typeof db.query !== 'function') throw new Error('db.query requis');
  if (!productSkuId) throw new Error('productSkuId requis');
  const quantity = supplierIdentity.positiveInt(options.quantity ?? 1, 'quantity');
  const row = await loadPersistedSku(db, productSkuId);

  if (!row.is_active) return result(VERDICT.SKU_INACTIVE, { product_sku_id: row.id });
  if (row.source !== 'SUPPLIER') {
    return result(VERDICT.BLOCKED_IDENTITY, { product_sku_id: row.id }, 'SKU non fournisseur');
  }

  let identity;
  try {
    identity = canonicalIdentity(row);
  } catch (error) {
    return result(VERDICT.BLOCKED_IDENTITY, { product_sku_id: row.id }, String(error.message || error));
  }

  const adapter = adapters[identity.provider];
  if (!adapter || typeof adapter.evaluate !== 'function') {
    return result(
      VERDICT.SUPPLIER_UNAVAILABLE,
      { product_sku_id: row.id, provider: identity.provider },
      `Aucun adapter fulfillment pour ${identity.provider}`
    );
  }

  const verdict = await adapter.evaluate({ db, row, identity, quantity, destination, context, VERDICT, result });
  if (!verdict || typeof verdict.status !== 'string' || typeof verdict.ready !== 'boolean') {
    return result(VERDICT.PREFLIGHT_FAILED, { product_sku_id: row.id, provider: identity.provider }, 'Adapter fulfillment invalide');
  }
  return verdict;
}

module.exports = {
  VERDICT,
  DEFAULT_ADAPTERS,
  result,
  loadPersistedSku,
  canonicalIdentity,
  evaluateSupplierFulfillmentReadiness,
};
