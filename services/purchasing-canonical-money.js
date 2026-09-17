/**
 * @komerce-arch
 * @role          purchasing-canonical-supplier-money
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        exact sold product_sku
 * @outputs       supplier native unit price + currency snapshot
 * @depends       services/sourcing-canonical-unit-product-sku-resolution.js, services/suppliers/supplier-order-identity.js
 * @used-by       services/purchasing-trigger-service.js, routes/purchasing.js
 * @db-read       product_skus, delegated_to_sourcing_resolver
 * @db-write      none
 * @db-txn        participates_in_caller_transaction
 * @doctrine      docs/doctrine/DOCTRINE_CANONICAL_UNIT_PURCHASING.md
 * @impact-areas  purchasing, sourcing, finance
 * @version       2026-09
 */
'use strict';

const resolver = require('./sourcing-canonical-unit-product-sku-resolution');
const { blockedSupplierIdentity, normalizeIdentity } = require('./suppliers/supplier-order-identity');

function normalizeCurrency(value) {
  const currency = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : null;
}

async function resolveCanonicalSupplierMoney(client, exactSku) {
  if (!exactSku?.id) return null;

  const resolution = await resolver.resolveCanonicalUnitForProductSku(
    exactSku.id,
    client.query.bind(client)
  );
  if (resolution.status !== resolver.STATUS.RESOLVED) {
    throw blockedSupplierIdentity(
      `Canonical Unit non résolue pour le SKU vendu (${resolution.status})`,
      { product_sku_id: exactSku.id, canonical_resolution: resolution.status }
    );
  }

  const state = resolution.canonical_unit?.current_state || {};
  const amount = Number(state.purchase_price);
  const currency = normalizeCurrency(state.currency);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw blockedSupplierIdentity('prix fournisseur canonique absent ou invalide', {
      product_sku_id: exactSku.id,
      canonical_unit_id: resolution.canonical_unit_id,
    });
  }
  if (!currency) {
    throw blockedSupplierIdentity('devise fournisseur canonique absente ou invalide', {
      product_sku_id: exactSku.id,
      canonical_unit_id: resolution.canonical_unit_id,
    });
  }

  const canonicalIdentity = normalizeIdentity(
    resolution.supplier_order_identity,
    resolution.supplier_unit_ref
  );
  const soldIdentity = normalizeIdentity(
    exactSku.supplier_order_identity,
    exactSku.supplier_unit_ref
  );
  if (
    canonicalIdentity.provider !== soldIdentity.provider
    || canonicalIdentity.version !== soldIdentity.version
    || JSON.stringify(canonicalIdentity.payload) !== JSON.stringify(soldIdentity.payload)
  ) {
    throw blockedSupplierIdentity('Supplier Order Identity canonique divergente du SKU vendu', {
      product_sku_id: exactSku.id,
      canonical_unit_id: resolution.canonical_unit_id,
    });
  }

  return {
    unit_price: amount,
    currency,
    canonical_unit_id: resolution.canonical_unit_id,
    supplier_unit_ref: resolution.supplier_unit_ref,
    supplier_order_identity: canonicalIdentity,
  };
}

async function resolveCanonicalMappingMoney(client, productId, supplierSku) {
  const productIdValue = String(productId || '').trim();
  const supplierSkuValue = String(supplierSku || '').trim();
  if (!productIdValue || !supplierSkuValue) return null;

  const result = await client.query(`
    SELECT id, product_id, supplier_sku, supplier_unit_ref, supplier_order_identity
    FROM product_skus
    WHERE product_id = $1 AND supplier_sku = $2
    ORDER BY created_at ASC
    LIMIT 2
  `, [productIdValue, supplierSkuValue]);
  const rows = result?.rows || [];
  if (rows.length === 0) return null;
  if (rows.length > 1) {
    throw blockedSupplierIdentity('plusieurs product_skus correspondent au mapping fournisseur', {
      product_id: productIdValue,
      supplier_sku: supplierSkuValue,
      matches: rows.length,
    });
  }

  return resolveCanonicalSupplierMoney(client, rows[0]);
}

module.exports = { normalizeCurrency, resolveCanonicalSupplierMoney, resolveCanonicalMappingMoney };