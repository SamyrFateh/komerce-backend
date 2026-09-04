/**
 * @komerce-arch
 * @role          local-stock-checkout-preview
 * @domain        local-stock
 * @layer         service
 * @criticality   high
 * @inputs        market_id, checkout_demands, location
 * @outputs       checkout_fulfillment_preview
 * @depends       db.js, services/local-stock-service.js
 * @used-by       routes/local-stock.js
 * @db-read       local_stock, local_stock_allocations
 * @db-write      none
 * @db-txn        read_only_projection_no_lock
 * @doctrine      docs/doctrine/DOCTRINE_FULFILLMENT_MIXTE.md
 * @impact-areas  local-stock, checkout
 * @version       2026-09
 */
'use strict';

/**
 * Projection READ-ONLY du fulfillment pour le checkout.
 *
 * Cette projection n'est jamais une réservation et n'est jamais l'autorité
 * finale. Elle sert uniquement à expliquer au client, pour le relais choisi,
 * quelles lignes sont actuellement visibles comme stock local vs import.
 * POST /api/orders refait ensuite la résolution transactionnelle canonique
 * sous FOR UPDATE via resolveCheckoutFulfillmentSources().
 *
 * REVIEW_REQUIRED n'est pas une troisième provenance durable : il signifie
 * simplement qu'une lane locale exposée existe mais ne couvre déjà plus la
 * quantité demandée au moment de la lecture. Le checkout doit inviter à
 * ajuster/rafraîchir ; il ne doit jamais transformer silencieusement cette
 * situation en IMPORT.
 */

const db = require('../db');
const {
  DEFAULT_LOCATION,
  FULFILLMENT_SOURCE,
} = require('./local-stock-service');

const PREVIEW_STATE = Object.freeze({
  LOCAL_STOCK: FULFILLMENT_SOURCE.LOCAL_STOCK,
  IMPORT: FULFILLMENT_SOURCE.IMPORT,
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
});

function groupDemands(demands) {
  if (!Array.isArray(demands)) {
    throw new Error('previewCheckoutFulfillmentSources: demands doit être un tableau');
  }

  const grouped = new Map();
  for (const demand of demands) {
    const productId = String(demand?.productId || '').trim();
    const quantity = Number(demand?.quantity);
    if (!productId) {
      throw new Error('previewCheckoutFulfillmentSources: productId requis');
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error('previewCheckoutFulfillmentSources: quantity doit être un entier positif');
    }
    grouped.set(productId, (grouped.get(productId) || 0) + quantity);
  }
  return grouped;
}

async function previewCheckoutFulfillmentSources({
  marketId = null,
  demands = [],
  location = DEFAULT_LOCATION,
} = {}) {
  const grouped = groupDemands(demands);
  const productIds = [...grouped.keys()].sort();
  const preview = {};

  if (!marketId) {
    for (const productId of productIds) preview[productId] = PREVIEW_STATE.IMPORT;
    return preview;
  }

  for (const productId of productIds) {
    const quantity = grouped.get(productId);
    const { rows } = await db.query(
      `SELECT ls.id,
              ls.qty_physical,
              ls.commercial_exposure,
              COALESCE(SUM(lsa.quantity) FILTER (
                WHERE lsa.consumed_at IS NULL AND lsa.released_at IS NULL
              ), 0)::int AS active_allocated
         FROM local_stock ls
         LEFT JOIN local_stock_allocations lsa ON lsa.local_stock_id = ls.id
        WHERE ls.product_id = $1
          AND ls.market_id = $2
          AND ls.location = $3
        GROUP BY ls.id, ls.qty_physical, ls.commercial_exposure`,
      [productId, marketId, location]
    );

    const localStock = rows[0] || null;
    if (!localStock || localStock.commercial_exposure !== 'ENABLED') {
      preview[productId] = PREVIEW_STATE.IMPORT;
      continue;
    }

    const available = Number(localStock.qty_physical) - Number(localStock.active_allocated || 0);
    preview[productId] = available >= quantity
      ? PREVIEW_STATE.LOCAL_STOCK
      : PREVIEW_STATE.REVIEW_REQUIRED;
  }

  return preview;
}

module.exports = {
  PREVIEW_STATE,
  previewCheckoutFulfillmentSources,
};