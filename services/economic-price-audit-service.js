/**
 * @komerce-arch
 * @role          economic-engine-product-price-audit
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, utils/logger.js
 * @used-by       services/apply-pricing-updates.js, services/product-price-audit.js
 * @db-write      price_history
 * @db-txn        caller_managed
 * @doctrine      writer_not_owner_campaign_2026_08
 * @impact-areas  economic-engine, catalog, pricing
 * @version       2026-08
 */

'use strict';

/**
 * Autorité d'écriture de l'historique de prix.
 *
 * LOT2 WRITER-NOT-OWNER : price_history appartient à economic-engine. Les
 * consommateurs cross-feature déclenchent cette capacité et ne portent plus
 * de SQL direct sur la table propriétaire.
 *
 * Contrat historique conservé : l'audit reste tolérant et ne bloque jamais la
 * mutation métier si la table ou les colonnes enrichies sont indisponibles.
 */

const db = require('../db');
const log = require('../utils/logger').child({ module: 'economic-price-audit' });

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
      log.warn('[economic-price-audit] price_history skipped:', fallbackErr.message);
      return { skipped: true, reason: fallbackErr.message };
    }
  }
}

module.exports = { recordProductPriceChange };
