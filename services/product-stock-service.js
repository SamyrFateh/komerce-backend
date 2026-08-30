/**
 * @komerce-arch
 * @role          catalog-product-stock-service
 * @domain        catalog
 * @layer         service
 * @criticality   critical
 * @inputs        dbClient, items[], direction
 * @outputs       side_effects (stock rows updated)
 * @depends       none
 * @used-by       services/product-admin-service.js (réexport), services/order-payment-confirmation.js (via product-admin-service.js),
 *                services/order-status-machine.js (via product-admin-service.js), services/parcel-operations.js (via product-admin-service.js)
 * @db-read       none
 * @db-write      product_skus, product_variants, products
 * @db-txn        participant (reçoit le dbClient transactionnel de l'appelant, ne BEGIN/COMMIT/ROLLBACK jamais lui-même)
 * @doctrine      docs/specs/DECISION_MODELE_STOCK_SKU.md §A, §6 (PDC-7)
 * @impact-areas  catalog, orders, logistics
 * @version       2026-08 (extrait de product-admin-service.js, LOT 3B — nettoyage architectural)
 */

'use strict';

/**
 * product-stock-service.js
 *
 * Extrait de services/product-admin-service.js (LOT 3B, nettoyage
 * architectural). Porte adjustStock/adjustSkuStock/adjustLegacyStock —
 * SEUL chemin d'écriture autorisé sur `products.stock`,
 * `product_variants.stock` et `product_skus.stock` pour les features
 * externes (orders, logistics). Feature catalog = owner.
 *
 * Copie exacte du comportement d'origine : même règle de routage par
 * item.inventory_model (jamais par la seule présence de sku_id), même
 * refus bruyant sans fallback silencieux, mêmes requêtes SQL.
 *
 * ⚠️ Ce module ne possède AUCUNE transaction : il reçoit le `dbClient`
 * déjà ouvert par l'appelant et ne fait jamais de BEGIN/COMMIT/ROLLBACK
 * lui-même — comportement inchangé par rapport à product-admin-service.js.
 *
 * product-admin-service.js réexporte adjustStock() pour API publique
 * inchangée : order-payment-confirmation.js, order-status-machine.js et
 * parcel-operations.js (hors périmètre de ce lot, contrat protégé)
 * continuent d'importer adjustStock depuis product-admin-service.js sans
 * aucun changement.
 *
 * Exports :
 *   adjustStock(dbClient, items, direction)
 *     items: [{ product_id, quantity, inventory_model?, sku_id?, has_variants?, variant_combo? }]
 *     direction: 'increment' | 'decrement'
 *     ✗ throws (err.status = 500) si un item SKU n'a pas de sku_id, ou si le
 *       SKU ciblé est introuvable — jamais de fallback silencieux vers
 *       products.stock/product_variants.stock
 */

/**
 * Ajuste le stock de produits (et de leurs variantes) en une seule opération.
 * SEUL chemin d'écriture autorisé sur `products.stock`, `product_variants.stock`
 * et `product_skus.stock` pour les features externes (orders, logistics).
 * Feature catalog = owner.
 *
 * Lot 7 (PDC-7, cf. docs/specs/DECISION_MODELE_STOCK_SKU.md) : le moteur choisi
 * PAR ITEM est gouverné EXCLUSIVEMENT par `item.inventory_model`
 * ('SKU' | 'LEGACY_VARIANTS'), jamais par la seule présence de `item.sku_id`.
 * Un produit `inventory_model = 'SKU'` sans `sku_id` renseigné n'est PAS un
 * item legacy déguisé — c'est un bug de l'appelant (résolution SKU manquée
 * en amont), et adjustStock() échoue bruyamment plutôt que de retomber sur
 * `products.stock` / `product_variants.stock`. Aucun fallback silencieux.
 *
 * @param {object}  dbClient    Client de transaction actif
 * @param {Array}   items       Articles à ajuster :
 *   [{ product_id, quantity, inventory_model?, sku_id?, has_variants?, variant_combo? }]
 *   inventory_model === 'SKU'  → chemin SKU (UPDATE product_skus uniquement),
 *                                sku_id obligatoire, erreur bloquante sinon.
 *   inventory_model === autre chose (ou absent, compat appelants historiques)
 *                              → chemin legacy (products.stock + product_variants.stock).
 * @param {'increment'|'decrement'} direction
 *   'decrement' → stock - quantity  (paiement confirmé)
 *   'increment' → stock + quantity  (annulation, restauration backorder)
 */
async function adjustStock(dbClient, items, direction) {
  const op = direction === 'decrement' ? '-' : '+';

  for (const item of items) {
    if (item.inventory_model === 'SKU') {
      await adjustSkuStock(dbClient, item, op);
      continue;
    }
    await adjustLegacyStock(dbClient, item, op);
  }
}

/**
 * Chemin SKU (Lot 7) : un seul UPDATE, une seule table, jamais de lecture ni
 * d'écriture sur products.stock / product_variants.stock pour cet item.
 * Le CHECK stock >= 0 (migration 104) transforme tout dépassement en erreur
 * bloquante plutôt qu'un silence — comportement voulu (§6 decision doc).
 */
async function adjustSkuStock(dbClient, item, op) {
  if (!item.sku_id) {
    const e = new Error(
      `[adjustStock] Produit ${item.product_id} déclaré inventory_model='SKU' sans sku_id — ` +
      `refus explicite, aucun fallback vers products.stock/product_variants.stock`
    );
    e.status = 500;
    throw e;
  }

  const { rows: [row] } = await dbClient.query(
    `UPDATE product_skus SET stock = stock ${op} $1
      WHERE id = $2 AND product_id = $3
      RETURNING id`,
    [item.quantity, item.sku_id, item.product_id]
  );

  if (!row) {
    const e = new Error(
      `[adjustStock] SKU introuvable pour cet ajustement (sku_id=${item.sku_id}, product_id=${item.product_id})`
    );
    e.status = 500;
    throw e;
  }
}

/**
 * Chemin legacy (deux axes indépendants — cf. DECISION_MODELE_STOCK_SKU.md §A).
 */
async function adjustLegacyStock(dbClient, item, op) {
  await dbClient.query(
    `UPDATE products SET stock = stock ${op} $1 WHERE id = $2`,
    [item.quantity, item.product_id]
  );

  if (item.has_variants && item.variant_combo) {
    for (const [vType, vValue] of Object.entries(item.variant_combo)) {
      await dbClient.query(
        `UPDATE product_variants
            SET stock = stock ${op} $1
          WHERE product_id = $2
            AND variant_type = $3
            AND variant_value = $4
            AND stock IS NOT NULL`,
        [item.quantity, item.product_id, vType, vValue]
      );
    }
  }
}

module.exports = {
  adjustStock,
};
