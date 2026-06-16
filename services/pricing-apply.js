/**
 * @komerce-arch
 * @role          economic-engine-pricing-apply
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @used-by       @unknown
 * @db-read       products
 * @db-write      price_history, products
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  economic-engine
 * @version       2026-06
 */

'use strict';

/**
 * KOMERCE — Service application de prix produit (REFACTO-R1)
 *
 * Extraction iso-comportement depuis routes/pricing.js :
 *   PUT /api/pricing/apply-price/:id → applyPrice(productId, body, userId)
 *   PUT /api/pricing/apply-all       → applyAll(items)
 *
 * Doctrine I-08 : le seuil de survie utilisé ici est celui transmis par le
 * client (survival_price_kmf, calculé côté front via pricing-engine).
 *
 * NB — dette connue : services/apply-pricing-updates.js (I-SWEEP-6B) existe
 * déjà et calcule un seuil de survie SERVEUR + un audit dédié
 * (recordProductPriceChange), mais n'est câblé sur aucune route. Cette
 * extraction R1 est volontairement iso-comportement avec la route d'origine
 * et NE bascule PAS sur ce service (cf. docs/chantier/STATUS.md — à arbitrer
 * dans un lot dédié, pas dans REFACTO-R1).
 */

const db = require('../db');
const {
  isPriceInvalid,
  isBatchEmpty,
  isBatchOversize,
  getSurvivalViolation,
} = require('./pricing-guards');

const MAX_BATCH_ITEMS = 500;

/**
 * Applique un nouveau prix à un produit, avec garde de survie (client) et
 * audit price_history (fallback gracieux si colonnes scenario_* absentes).
 *
 * @returns {Promise<{ status: number, body: object }>}
 */
async function applyPrice(productId, body, userId) {
  const { price_kmf, source, scenario_id, scenario_label, levier, survival_price_kmf } = body || {};

  if (isPriceInvalid(price_kmf)) {
    return { status: 400, body: { error: 'price_kmf invalide' } };
  }

  const { rows: [product] } = await db.query(
    'SELECT id, name, price_kmf FROM products WHERE id = $1', [productId]
  );
  if (!product) return { status: 404, body: { error: 'Produit introuvable' } };

  const survivalViolation = getSurvivalViolation(price_kmf, survival_price_kmf);
  if (survivalViolation !== null) {
    return {
      status: 400,
      body: {
        error: 'Prix sous le seuil de survie : refusé par doctrine.',
        code: 'below_survival',
        survival_price_kmf: survivalViolation,
        attempted_price_kmf: price_kmf,
      },
    };
  }

  const oldPrice = Number(product.price_kmf) || 0;
  const { rows: [updated] } = await db.query(
    `UPDATE products SET price_kmf = $1, updated_at = NOW() WHERE id = $2 RETURNING id, name, price_kmf`,
    [price_kmf, productId]
  );

  // Audit price_history (colonnes scenario_* optionnelles — fallback gracieux)
  try {
    await db.query(
      `INSERT INTO price_history
         (product_id, old_price_kmf, new_price_kmf, source, applied_by, applied_at, scenario_id, scenario_label, levier)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8)`,
      [productId, oldPrice, price_kmf, source || 'manual', userId || null, scenario_id || null, scenario_label || null, levier || null]
    );
  } catch (_) {
    try {
      await db.query(
        `INSERT INTO price_history (product_id, old_price_kmf, new_price_kmf, source, applied_by, applied_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [productId, oldPrice, price_kmf, source || 'manual', userId || null]
      );
    } catch (_) { /* table optionnelle */ }
  }

  return {
    status: 200,
    body: {
      ok: true,
      product: updated,
      old_price_kmf: oldPrice,
      new_price_kmf: price_kmf,
      scenario_id: scenario_id || null,
      levier: levier || null,
    },
  };
}

/**
 * Applique un batch de prix produits dans une transaction unique.
 * Items invalides (product_id/price_kmf manquants ou <= 0) sont
 * silencieusement ignorés — pas de rejet, pas d'entrée price_history
 * (iso-comportement avec la route d'origine).
 *
 * @param {Array<{ product_id: string, price_kmf: number }>} items
 * @returns {Promise<{ status: number, body: object }>}
 */
async function applyAll(items) {
  if (isBatchEmpty(items)) return { status: 400, body: { error: 'items array requis' } };
  if (isBatchOversize(items, MAX_BATCH_ITEMS)) return { status: 400, body: { error: 'max 500 items par batch' } };

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const applied = [];
    for (const it of items) {
      if (!it.product_id || isPriceInvalid(it.price_kmf)) continue;
      const { rows: [updated] } = await client.query(
        `UPDATE products SET price_kmf = $1, updated_at = NOW()
          WHERE id = $2 RETURNING id, name, price_kmf`,
        [it.price_kmf, it.product_id]
      );
      if (updated) applied.push(updated);
    }
    await client.query('COMMIT');
    return { status: 200, body: { ok: true, count: applied.length, products: applied } };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { applyPrice, applyAll };
