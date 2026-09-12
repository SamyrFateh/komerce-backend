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
 * @doctrine      PDC-8 §SKU — IDENTITÉ SOURCE STABLE, §STOCK, §DOCTRINE ZÉRO HEURISTIQUE
 * @impact-areas  catalog
 * @version       2026-07
 */

/**
 * KOMERCE — PDC-8 Lot 4 : plan de réconciliation SKU par identité source stable
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Fonction pure : ne touche jamais la DB. Produit un PLAN que le Lot 6
 * (services/catalog-promotion.js) exécutera dans une transaction réelle.
 *
 * Règle centrale (PDC-8 §SKU) : l'identité de re-promotion est
 * `supplier_sku`, jamais `variant_combo`. Un supplier_sku rejoué doit
 * conserver le même `product_skus.id` même si son variant_combo est corrigé
 * par la source (ex. "Rouge/M" → "Rouge foncé/M").
 *
 * Les SKU manuels (source = 'MANUAL', supplier_sku NULL) ne sont JAMAIS
 * touchés par ce plan — ils n'existent pas du point de vue d'une
 * re-promotion fournisseur.
 *
 * Prix (PDC-8 §MAPPING V2 → CANONIQUE §SKU) : ne copie jamais
 * sellable_unit.purchase_price dans price_kmf. Le plan ne fixe jamais
 * price_kmf — la colonne reste intouchée (create : null ; update : absent
 * du patch) tant qu'aucun moteur pricing commercial explicite n'est
 * branché (hors scope Lot 4/6).
 *
 * Stock (PDC-8 §STOCK) : stock_available absent ne fabrique jamais une
 * quantité. Le plan reporte stockKnown=false et stock=0 dans ce cas —
 * 0 est ici une PROJECTION TECHNIQUE d'absence non vendable, jamais un
 * stock fournisseur connu. Charge à l'appelant (Lot 6 / audit) de ne
 * jamais présenter ce 0 comme une donnée fournisseur.
 */

'use strict';

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
    const existing = bySupplierSku.get(supplierSku);

    if (!existing) {
      toCreate.push({
        supplier_sku: supplierSku,
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
