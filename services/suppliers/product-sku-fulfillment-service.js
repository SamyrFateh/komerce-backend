/**
 * @komerce-arch
 * @role          product-sku-fulfillment-service
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        product_sku_id, quantity, destination, optional explicit price policy
 * @outputs       deterministic supplier fulfillment readiness verdict
 * @depends       services/suppliers/supplier-fulfillment-readiness.js, services/suppliers/adapters/aliexpress-fulfillment-adapter.js
 * @used-by       future purchasing hard gate, staging fulfillment audits
 * @db-read       product_skus
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_SUPPLIER_ORDER_IDENTITY.md
 * @impact-areas  purchasing,catalog,supplier-integration
 * @version       2026-09-v1
 */
'use strict';

const core = require('./supplier-fulfillment-readiness');
const { adapter: aliExpressAdapter } = require('./adapters/aliexpress-fulfillment-adapter');

const DEFAULT_ADAPTERS = Object.freeze({
  aliexpress: aliExpressAdapter,
});

function clean(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

function adapterFromRegistry(sku, adapters = DEFAULT_ADAPTERS) {
  const provider = clean(sku?.supplier_order_identity?.provider);
  if (!provider) return null;
  if (adapters instanceof Map) return adapters.get(provider) || null;
  return adapters?.[provider] || null;
}

async function loadProductSku(db, productSkuId) {
  if (!db || typeof db.query !== 'function') throw new Error('db.query requis');
  const id = String(productSkuId || '').trim();
  if (!id) throw new Error('productSkuId requis');

  const { rows: [row] } = await db.query(
    `SELECT id,
            product_id,
            source,
            is_active,
            supplier_sku,
            supplier_product_ref,
            supplier_unit_ref,
            supplier_order_identity
       FROM product_skus
      WHERE id = $1`,
    [id]
  );

  if (!row) {
    const error = new Error('product_sku introuvable');
    error.status = 404;
    throw error;
  }
  return row;
}

async function assessProductSkuFulfillment(db, {
  productSkuId,
  quantity = 1,
  destination,
  pricePolicy = null,
  adapterOptions = {},
} = {}, dependencies = {}) {
  const sku = await loadProductSku(db, productSkuId);
  const adapters = dependencies.adapters || DEFAULT_ADAPTERS;
  const adapter = adapterFromRegistry(sku, adapters);

  return core.assessSupplierFulfillment({
    sku,
    quantity,
    destination,
    adapter,
    pricePolicy,
    adapterOptions,
  });
}

module.exports = {
  DEFAULT_ADAPTERS,
  adapterFromRegistry,
  loadProductSku,
  assessProductSkuFulfillment,
};
