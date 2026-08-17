/**
 * @komerce-arch
 * @role          sourcing-mutations
 * @domain        economic-engine
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, services/sourcing-analysis.js, services/catalog-product-mutation-service.js
 * @used-by       routes/sourcing.js
 * @db-read       order_items, orders, product_variants, products
 * @db-write-via:catalog-product-mutation-service products, product_variants
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  unknown
 * @version       2026-08 (campagne WRITER-NOT-OWNER — wrapper de compatibilité)
 */

'use strict';

/**
 * KOMERCE — Service mutations sourcing (REFACTO-R2, puis WNO-2026-08)
 *
 * Expose toujours :
 *   PUT /api/admin/sourcing/products/:id          → updateProduct(id, body)
 *   POST /api/admin/sourcing/bulk-rail            → bulkAssignRail(productIds, rail)
 *   PUT /api/admin/sourcing/products/:id/variants → replaceVariants(id, variants)
 *
 * Campagne WRITER-NOT-OWNER (2026-08) : ce fichier ne porte plus aucun SQL.
 * `products` et `product_variants` sont owner catalog ; le SQL a été déplacé
 * dans services/catalog-product-mutation-service.js (updateSourcingFields,
 * bulkAssignSourcingRail, replaceVariantsForSourcing). Ce module reste en
 * wrapper de compatibilité pour routes/sourcing.js et ne change aucun
 * comportement (mêmes validations, mêmes retours, même transaction pour
 * replaceVariants).
 *
 * Invariant I-08 : pas de coefficient dur ici. La config sourcing est toujours
 * lue via sourcing-analysis.js (loadSourcingConfig).
 *
 * Pattern de retour : { status: number, body: object }
 */

const db = require('../db');
const sourcingAnalysis = require('./sourcing-analysis');
const catalogProductMutationService = require('./catalog-product-mutation-service');

const VALID_RAILS = ['A', 'B', 'C', 'D'];

// ── updateProduct ───────────────────────────────────────────────────────────

/**
 * Met à jour les métadonnées sourcing d'un produit.
 * Retourne une analyse fraîche du produit via sourcing-analysis.
 *
 * @param {string} productId
 * @param {object} body
 * @returns {Promise<{ status: number, body: object }>}
 */
async function updateProduct(productId, body) {
  let updated;
  try {
    updated = await catalogProductMutationService.updateSourcingFields(db, productId, body);
  } catch (err) {
    if (err.status) return { status: err.status, body: { error: err.message } };
    throw err;
  }

  if (!updated) {
    return { status: 404, body: { error: 'Produit introuvable' } };
  }

  const cfg      = await sourcingAnalysis.loadSourcingConfig();
  const salesMap = await sourcingAnalysis.getSales30d();
  const analysis = sourcingAnalysis.analyzeProduct(updated, cfg, salesMap);

  return { status: 200, body: { success: true, product: analysis } };
}

// ── bulkAssignRail ──────────────────────────────────────────────────────────

/**
 * Assigne un rail sourcing (A/B/C/D) à plusieurs produits en une seule query.
 *
 * @param {string[]} productIds
 * @param {string}   rail
 * @returns {Promise<{ status: number, body: object }>}
 */
async function bulkAssignRail(productIds, rail) {
  if (!productIds || !Array.isArray(productIds) || !rail) {
    return { status: 400, body: { error: 'product_ids (array) et rail (A/B/C/D) requis' } };
  }
  if (!VALID_RAILS.includes(rail.toUpperCase())) {
    return { status: 400, body: { error: 'Rail invalide — A, B, C ou D' } };
  }

  const updated = await catalogProductMutationService.bulkAssignSourcingRail(db, productIds, rail.toUpperCase());

  return { status: 200, body: { success: true, updated } };
}

// ── replaceVariants ─────────────────────────────────────────────────────────

/**
 * Remplace ATOMIQUEMENT toutes les variantes d'un produit.
 * - Tableau vide → supprime tout + has_variants = false
 * - Tableau non vide → wipe + recréation + has_variants = true
 *
 * Garde-fou : refuse si une variante en cours de suppression est référencée
 * dans une commande `pending` ou `pending_group_payment`.
 *
 * @param {string} productId
 * @param {object[]} variants
 * @returns {Promise<{ status: number, body: object }>}
 */
async function replaceVariants(productId, variants) {
  return catalogProductMutationService.replaceVariantsForSourcing(db, productId, variants);
}

module.exports = { updateProduct, bulkAssignRail, replaceVariants };
