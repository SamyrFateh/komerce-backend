/**
 * @komerce-arch
 * @role          local-stock-decision-projection
 * @domain        local-stock
 * @layer         service
 * @criticality   high
 * @inputs        product_id, market_id, location
 * @outputs       market_local_availability_evidence
 * @depends       db
 * @used-by       services/dashboard-commerce.js
 * @db-read       local_stock, local_stock_allocations
 * @db-write      none
 * @db-txn        none
 * @doctrine      local_stock_is_physical_availability_authority, decision_projection_never_reads_products_stock
 * @impact-areas  local-stock, admin-dashboard, commerce, decision-signals
 * @version       2026-09
 */

'use strict';

const db = require('../db');
const { AVAILABILITY, DEFAULT_LOCATION } = require('./local-stock-service');

/**
 * Projection read-only volontairement minimale pour les consommateurs de
 * décision. Elle conserve dans local-stock le calcul de disponibilité nette
 * (quantité physique - allocations actives) et n'expose ni quantité brute,
 * ni allocation, ni identifiant interne.
 *
 * L'absence de ligne locale reste distincte d'une ligne suivie à zéro :
 * `tracked=false` signifie « pas de lane locale suivie », jamais « rupture ».
 * Une ligne DISABLED n'est pas davantage une rupture : elle n'est simplement
 * pas proposée comme disponibilité locale immédiate.
 */
async function getDecisionAvailabilityEvidence(productId, marketId, location = DEFAULT_LOCATION) {
  if (!productId || !marketId) {
    throw new Error('getDecisionAvailabilityEvidence: product_id et market_id sont requis');
  }

  const { rows } = await db.query(
    `SELECT
       ls.commercial_exposure,
       GREATEST(
         ls.qty_physical - COALESCE((
           SELECT SUM(a.quantity)
             FROM local_stock_allocations a
            WHERE a.local_stock_id = ls.id
              AND a.consumed_at IS NULL
              AND a.released_at IS NULL
         ), 0),
         0
       )::int AS available_quantity
       FROM local_stock ls
      WHERE ls.product_id = $1
        AND ls.market_id = $2
        AND ls.location = $3
      LIMIT 1`,
    [productId, marketId, location]
  );

  const row = rows[0] || null;
  if (!row) {
    return Object.freeze({
      tracked: false,
      commercial_exposure: null,
      availability: AVAILABILITY.UNAVAILABLE,
      exposable: false,
      authority: 'LOCAL_STOCK',
      basis: 'physical_minus_active_allocations',
    });
  }

  const available = Number(row.available_quantity) || 0;
  const availability = available > 0 ? AVAILABILITY.AVAILABLE_NOW : AVAILABILITY.UNAVAILABLE;
  const exposure = row.commercial_exposure || null;

  return Object.freeze({
    tracked: true,
    commercial_exposure: exposure,
    availability,
    exposable: exposure === 'ENABLED' && availability === AVAILABILITY.AVAILABLE_NOW,
    authority: 'LOCAL_STOCK',
    basis: 'physical_minus_active_allocations',
  });
}

module.exports = {
  getDecisionAvailabilityEvidence,
};