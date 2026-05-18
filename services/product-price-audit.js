'use strict';

/**
 * I-SWEEP-6A — Audit transverse des changements de prix produit.
 *
 * Objectif : éviter les modifications de price_kmf sans trace.
 * Le helper est tolérant : si price_history ou les colonnes enrichies
 * n'existent pas, il ne bloque pas l'opération métier.
 */

const db = require('../db');

async function recordProductPriceChange(q = db, {
  productId,
  oldPriceKmf,
  newPriceKmf,
  source = 'manual',
  appliedBy = null,
  scenarioId = null,
  scenarioLabel = null,
  levier = null,
  note = null,
} = {}) {
  if (!productId) return { skipped: true, reason: 'missing_product_id' };

  const oldPrice = Number(oldPriceKmf || 0);
  const newPrice = Number(newPriceKmf || 0);

  if (!Number.isFinite(newPrice) || newPrice <= 0) {
    return { skipped: true, reason: 'invalid_new_price' };
  }
  if (oldPrice === newPrice) {
    return { skipped: true, reason: 'unchanged' };
  }

  try {
    await q.query(
      `INSERT INTO price_history (
         product_id, old_price_kmf, new_price_kmf, source, applied_by, applied_at,
         scenario_id, scenario_label, levier
       ) VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8)`,
      [
        productId,
        oldPrice,
        newPrice,
        source,
        appliedBy,
        scenarioId,
        scenarioLabel || note,
        levier,
      ]
    );
    return { inserted: true, enriched: true };
  } catch (err) {
    try {
      await q.query(
        `INSERT INTO price_history (product_id, old_price_kmf, new_price_kmf, source, applied_by, applied_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [productId, oldPrice, newPrice, source, appliedBy]
      );
      return { inserted: true, enriched: false };
    } catch (fallbackErr) {
      console.warn('[product-price-audit] price_history skipped:', fallbackErr.message);
      return { skipped: true, reason: fallbackErr.message };
    }
  }
}

module.exports = { recordProductPriceChange };
