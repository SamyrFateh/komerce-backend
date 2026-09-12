/**
 * @komerce-arch
 * @role          catalog-promotion-sku-reconciliation
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        product_skus_existing_rows, normalized_source_contract.sellable_units[]
 * @outputs       sku_reconciliation_plan (toCreate/toUpdate/toReactivate/toDeactivate)
 * @depends       services/suppliers/supplier-order-identity.js
 * @used-by       services/catalog-promotion.js (Lot 6)
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      PDC-8 §SKU — IDENTITÉ SOURCE STABLE, §STOCK, §DOCTRINE ZÉRO HEURISTIQUE; docs/doctrine/DOCTRINE_SUPPLIER_ORDER_IDENTITY.md
 * @impact-areas  catalog,purchasing
 * @version       2026-09 — persistance Supplier Order Identity fail-closed
 */

/**
 * KOMERCE — plan de réconciliation SKU par identité source stable
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Fonction pure : ne touche jamais la DB. Produit un PLAN que
 * services/catalog-promotion.js exécute dans une transaction réelle.
 *
 * Deux identités restent volontairement distinctes :
 *   - supplier_sku : identité de RECONCILIATION catalogue ;
 *   - supplier_unit_ref + supplier_order_identity : identité de COMMANDE.
 *
 * Un supplier_sku rejoué conserve le même product_skus.id. Une identité de
 * commande native absente peut être complétée par une re-promotion ultérieure,
 * mais une identité déjà persistée ne peut jamais être remplacée silencieusement.
 * Toute divergence bloque avec BLOCKED_SUPPLIER_IDENTITY.
 *
 * Les SKU manuels (source = 'MANUAL', supplier_sku NULL) ne sont JAMAIS
 * touchés par ce plan.
 *
 * Prix : ne copie jamais sellable_unit.purchase_price dans price_kmf.
 *
 * Stock : stock_available absent ne fabrique jamais une quantité. Le plan
 * reporte stockKnown=false et stock=0 ; sur update l'appelant préserve la
 * valeur existante.
 */

'use strict';

const { isDeepStrictEqual } = require('node:util');
const {
  blockedSupplierIdentity,
  normalizeIdentity,
} = require('../suppliers/supplier-order-identity');

function normalizeSupplierUnitRef(value, supplierSku) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw blockedSupplierIdentity(
      `supplier_unit_ref invalide pour ${supplierSku}`,
      { supplier_sku: supplierSku }
    );
  }
  return value.trim();
}

function canonicalIdentityFromUnit(unit, supplierSku) {
  const supplierUnitRef = normalizeSupplierUnitRef(unit.supplier_unit_ref, supplierSku);
  const supplierOrderIdentity = unit.supplier_order_identity == null
    ? null
    : normalizeIdentity(unit.supplier_order_identity, supplierUnitRef);

  return {
    supplier_unit_ref: supplierUnitRef,
    supplier_order_identity: supplierOrderIdentity,
  };
}

function canonicalIdentityFromExisting(row, supplierSku) {
  const supplierUnitRef = normalizeSupplierUnitRef(row.supplier_unit_ref, supplierSku);
  const supplierOrderIdentity = row.supplier_order_identity == null
    ? null
    : normalizeIdentity(row.supplier_order_identity, supplierUnitRef);

  return {
    supplier_unit_ref: supplierUnitRef,
    supplier_order_identity: supplierOrderIdentity,
  };
}

function reconcileOrderIdentity(existing, incoming, supplierSku) {
  if (!existing) return incoming;

  const persisted = canonicalIdentityFromExisting(existing, supplierSku);

  if (
    persisted.supplier_unit_ref
    && incoming.supplier_unit_ref
    && persisted.supplier_unit_ref !== incoming.supplier_unit_ref
  ) {
    throw blockedSupplierIdentity(
      `supplier_unit_ref divergent pour ${supplierSku}`,
      {
        supplier_sku: supplierSku,
        persisted_supplier_unit_ref: persisted.supplier_unit_ref,
        incoming_supplier_unit_ref: incoming.supplier_unit_ref,
      }
    );
  }

  if (
    persisted.supplier_order_identity
    && incoming.supplier_order_identity
    && !isDeepStrictEqual(persisted.supplier_order_identity, incoming.supplier_order_identity)
  ) {
    throw blockedSupplierIdentity(
      `supplier_order_identity divergente pour ${supplierSku}`,
      {
        supplier_sku: supplierSku,
        supplier_unit_ref: persisted.supplier_unit_ref || incoming.supplier_unit_ref,
      }
    );
  }

  return {
    supplier_unit_ref: persisted.supplier_unit_ref || incoming.supplier_unit_ref || null,
    supplier_order_identity: persisted.supplier_order_identity || incoming.supplier_order_identity || null,
  };
}

function identityPlanFields(identity) {
  if (!identity.supplier_unit_ref && !identity.supplier_order_identity) return {};
  return {
    supplier_unit_ref: identity.supplier_unit_ref,
    supplier_order_identity: identity.supplier_order_identity,
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
      if (bySupplierSku.has(row.supplier_sku)) {
        throw blockedSupplierIdentity(
          `plusieurs product_skus portent le même supplier_sku: ${row.supplier_sku}`,
          { supplier_sku: row.supplier_sku }
        );
      }
      bySupplierSku.set(row.supplier_sku, row);
    }
  }

  const toCreate = [];
  const toUpdate = [];
  const toReactivate = [];
  const seenSupplierSkus = new Set();
  const seenSupplierUnitRefs = new Map();

  for (const unit of sellableUnits) {
    if (!unit || typeof unit.supplier_sku !== 'string' || unit.supplier_sku.trim().length === 0) {
      const e = new Error('sellable_unit.supplier_sku requis et non vide'); e.status = 422; throw e;
    }
    const supplierSku = unit.supplier_sku.trim();
    seenSupplierSkus.add(supplierSku);

    const incomingIdentity = canonicalIdentityFromUnit(unit, supplierSku);
    if (incomingIdentity.supplier_unit_ref) {
      const previousSku = seenSupplierUnitRefs.get(incomingIdentity.supplier_unit_ref);
      if (previousSku && previousSku !== supplierSku) {
        throw blockedSupplierIdentity(
          `supplier_unit_ref résout plusieurs supplier_sku: ${incomingIdentity.supplier_unit_ref}`,
          {
            supplier_unit_ref: incomingIdentity.supplier_unit_ref,
            supplier_skus: [previousSku, supplierSku],
          }
        );
      }
      seenSupplierUnitRefs.set(incomingIdentity.supplier_unit_ref, supplierSku);
    }

    const stockKnown = typeof unit.stock_available === 'number' && Number.isInteger(unit.stock_available);
    const stock = stockKnown ? unit.stock_available : 0;
    const existing = bySupplierSku.get(supplierSku);
    const orderIdentity = reconcileOrderIdentity(existing, incomingIdentity, supplierSku);

    if (!existing) {
      toCreate.push({
        supplier_sku: supplierSku,
        ...identityPlanFields(orderIdentity),
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
      ...identityPlanFields(orderIdentity),
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
