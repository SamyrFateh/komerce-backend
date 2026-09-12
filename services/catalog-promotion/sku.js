/**
 * @komerce-arch
 * @role          catalog-promotion-sku-reconciliation
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        product_skus_existing_rows, normalized_source_contract.sellable_units[]
 * @outputs       sku_reconciliation_plan (toCreate/toUpdate/toReactivate/toDeactivate)
 * @depends       @none
 * @used-by       services/catalog-promotion.js (Lot 6)
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      PDC-8 §SKU — IDENTITÉ SOURCE STABLE, §STOCK, §DOCTRINE ZÉRO HEURISTIQUE, docs/doctrine/DOCTRINE_SUPPLIER_ORDER_IDENTITY.md
 * @impact-areas  catalog
 * @version       2026-09
 */

/**
 * KOMERCE — plan de réconciliation SKU par identité source stable.
 *
 * `supplier_sku` reste la clé de re-promotion historique. La Supplier Order
 * Identity est un fait supplémentaire : elle décrit comment commander
 * exactement cette même unité chez le fournisseur et n'influence jamais la
 * décision prix/stock.
 */

'use strict';

function identityFields(unit) {
  return {
    supplier_unit_ref: unit.supplier_unit_ref || null,
    supplier_order_identity: unit.supplier_order_identity || null,
  };
}

function planSkuReconciliation(existingSkus, sellableUnits) {
  if (!Array.isArray(existingSkus)) {
    const e = new Error('existingSkus doit être un tableau'); e.status = 422; throw e;
  }
  if (!Array.isArray(sellableUnits)) {
    const e = new Error('sellableUnits doit être un tableau'); e.status = 422; throw e;
  }

  const bySupplierSku = new Map();
  for (const row of existingSkus) {
    if (row.source === 'SUPPLIER' && row.supplier_sku) {
      bySupplierSku.set(row.supplier_sku, row);
    }
  }

  const toCreate = [];
  const toUpdate = [];
  const toReactivate = [];
  const seenSupplierSkus = new Set();

  for (const unit of sellableUnits) {
    if (!unit || typeof unit.supplier_sku !== 'string' || unit.supplier_sku.trim().length === 0) {
      const e = new Error('sellable_unit.supplier_sku requis et non vide'); e.status = 422; throw e;
    }
    const supplierSku = unit.supplier_sku.trim();
    seenSupplierSkus.add(supplierSku);

    const stockKnown = typeof unit.stock_available === 'number' && Number.isInteger(unit.stock_available);
    const stock = stockKnown ? unit.stock_available : 0;
    const orderIdentity = identityFields(unit);
    const existing = bySupplierSku.get(supplierSku);

    if (!existing) {
      toCreate.push({
        supplier_sku: supplierSku,
        ...orderIdentity,
        variant_combo: unit.option_values || null,
        stock,
        stockKnown,
        source: 'SUPPLIER',
        media_refs: unit.media_refs || null,
      });
      continue;
    }

    const target = existing.is_active ? toUpdate : toReactivate;
    target.push({
      id: existing.id,
      supplier_sku: supplierSku,
      ...orderIdentity,
      variant_combo: unit.option_values || null,
      stock,
      stockKnown,
      media_refs: unit.media_refs || null,
    });
  }

  const toDeactivate = [];
  for (const row of existingSkus) {
    if (row.source === 'SUPPLIER' && row.supplier_sku && row.is_active && !seenSupplierSkus.has(row.supplier_sku)) {
      toDeactivate.push({ id: row.id, supplier_sku: row.supplier_sku });
    }
  }

  return { toCreate, toUpdate, toReactivate, toDeactivate };
}

module.exports = {
  planSkuReconciliation,
};
