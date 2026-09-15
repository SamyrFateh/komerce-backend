/**
 * @komerce-arch
 * @role          market-active-local-price-buyer-boundary
 * @domain        market-autonomy
 * @layer         service
 * @criticality   critical
 * @inputs        server_market_id_or_code, canonical_product_rows, checkout_items
 * @outputs       effective_kmf_price, local_price_metadata, repriced_checkout_total
 * @depends       db.js, utils/currency.js, services/product-sellable-service.js
 * @used-by       routes/products.js, routes/catalog-product-detail.js, services/order-checkout-service.js, services/shared-cart-creation.js, services/market-local-price-activation-service.js
 * @db-read       markets, products, product_market_price_drafts, product_skus, product_variants
 * @db-write      none
 * @db-txn        participates_in_caller_transaction_when_executor_is_provided
 * @doctrine      only_LOCAL_ACTIVE_is_buyer_effective, market_from_server_context, granular_sku_prices_fail_closed
 * @impact-areas  market, catalog, checkout, shared-cart, pricing
 * @version       2026-09
 */

'use strict';

const db = require('../db');
const { projectAmount } = require('../utils/currency');
const { applyCanonicalPromotion } = require('./product-sellable-service');
const { PRICE_STATUSES, MarketCommercialPriceError } = require('./market-commercial-price-service');

const MARKET_CODE = /^[A-Z]{2}$/;

function normalizeMarketCode(value) {
  if (value == null || value === '') return null;
  const code = String(value).trim().toUpperCase();
  if (!MARKET_CODE.test(code)) {
    throw new MarketCommercialPriceError(400, 'market_price_invalid_market_code', 'Code marché invalide.');
  }
  return code;
}

async function resolveMarketByCode(executor = db, codeValue) {
  const code = normalizeMarketCode(codeValue);
  if (!code) return null;
  const { rows } = await executor.query(
    `SELECT id, code, name, currency, minor_unit
       FROM markets
      WHERE code = $1 AND is_active = TRUE
      LIMIT 1`,
    [code]
  );
  if (!rows.length) {
    throw new MarketCommercialPriceError(404, 'market_price_market_not_found', 'Marché introuvable ou inactif.');
  }
  return rows[0];
}

async function assertProductPriceShapeCompatible(executor = db, productId) {
  const { rows: [shape] } = await executor.query(
    `SELECT
       EXISTS (
         SELECT 1 FROM product_skus
          WHERE product_id = $1 AND is_active = TRUE AND price_kmf IS NOT NULL
       ) AS has_explicit_sku_price,
       EXISTS (
         SELECT 1 FROM product_variants
          WHERE product_id = $1 AND price_kmf IS NOT NULL
       ) AS has_explicit_variant_price`,
    [productId]
  );

  if (shape?.has_explicit_sku_price || shape?.has_explicit_variant_price) {
    throw new MarketCommercialPriceError(
      409,
      'market_local_price_granular_price_conflict',
      'Ce produit possède déjà un prix de variante/SKU explicite. Un prix pays produit ne peut pas l’écraser silencieusement.'
    );
  }
  return true;
}

async function projectLocalToKmf(amount, currency) {
  const projected = await projectAmount(Number(amount), String(currency), 'KMF');
  const rounded = Math.round(Number(projected));
  if (!Number.isFinite(rounded) || rounded <= 0) {
    throw new MarketCommercialPriceError(409, 'market_local_price_projection_invalid', 'Projection du prix local vers KMF invalide.');
  }
  return rounded;
}

async function resolveActiveProductMarketPricing(executor = db, { marketId, product }) {
  if (!marketId || !product?.id) return null;

  const { rows } = await executor.query(
    `SELECT d.amount, d.currency, d.status, d.active_at, m.currency AS market_currency
       FROM product_market_price_drafts d
       JOIN markets m ON m.id = d.market_id AND m.is_active = TRUE
      WHERE d.market_id = $1::uuid
        AND d.product_id = $2::uuid
        AND d.status = 'LOCAL_ACTIVE'
      LIMIT 1`,
    [marketId, product.id]
  );
  const decision = rows[0];
  if (!decision) return null;

  if (decision.status !== PRICE_STATUSES.ACTIVE || decision.currency !== decision.market_currency) {
    throw new MarketCommercialPriceError(409, 'market_local_price_currency_mismatch', 'Décision locale active incohérente avec la devise du marché.');
  }

  await assertProductPriceShapeCompatible(executor, product.id);
  const baseUnitPriceKmf = await projectLocalToKmf(decision.amount, decision.currency);
  const effectiveUnitPriceKmf = applyCanonicalPromotion(baseUnitPriceKmf, product);

  return {
    source: PRICE_STATUSES.ACTIVE,
    buyer_effective: true,
    market_id: marketId,
    local_amount: Number(decision.amount),
    local_currency: decision.currency,
    base_unit_price_kmf: baseUnitPriceKmf,
    effective_unit_price_kmf: effectiveUnitPriceKmf,
    promo_applied: effectiveUnitPriceKmf < baseUnitPriceKmf,
    active_at: decision.active_at || null,
  };
}

async function resolveActiveProductMarketPricingById(executor = db, { marketId, productId }) {
  if (!marketId || !productId) return null;
  const { rows: [product] } = await executor.query(
    `SELECT id, price_kmf, promo_pct, is_promo, promo_until
       FROM products
      WHERE id = $1::uuid AND is_active = TRUE
      LIMIT 1`,
    [productId]
  );
  if (!product) return null;
  return resolveActiveProductMarketPricing(executor, { marketId, product });
}

/**
 * Doctrine (2026-09, décision L1) : `products.price_kmf` reste une référence
 * globale / legacy / atelier (Pipeline A), mais elle ne devient JAMAIS
 * silencieusement le prix acheteur d'un marché. Dès qu'un `marketId` est
 * résolu côté serveur, seul un `LOCAL_ACTIVE` pour ce marché rend le produit
 * achetable. Absence de `LOCAL_ACTIVE` → NOT_DECISIONAL → le checkout refuse
 * explicitement, il ne retombe jamais sur le prix global.
 *
 * Si `marketId` est null (relais/flux non encore rattaché à un marché —
 * transition en cours, cf. `domaine_minimal_boutique_first`), aucun gate
 * marché ne s'applique : ce n'est pas un contexte marché, donc pas un
 * fallback silencieux au sens de cette doctrine.
 */
async function applyActiveMarketPricesToCheckoutItems(executor = db, { marketId, items, productMap }) {
  let totalKmf = 0;
  const cache = new Map();

  for (const item of items || []) {
    const product = productMap?.[item.product_id];
    if (!product) continue;

    let pricing = cache.get(product.id);
    if (pricing === undefined) {
      pricing = await resolveActiveProductMarketPricing(executor, { marketId, product });
      cache.set(product.id, pricing || null);
    }

    if (pricing) {
      item._effective_unit_price_kmf = pricing.effective_unit_price_kmf;
      item._market_price_snapshot = {
        source: pricing.source,
        market_id: pricing.market_id,
        local_amount: pricing.local_amount,
        local_currency: pricing.local_currency,
        base_unit_price_kmf: pricing.base_unit_price_kmf,
        effective_unit_price_kmf: pricing.effective_unit_price_kmf,
        active_at: pricing.active_at,
      };
    } else if (marketId) {
      // Marché résolu mais aucun LOCAL_ACTIVE : NOT_DECISIONAL. Jamais de
      // fallback silencieux vers products.price_kmf pour un achat réel.
      throw new MarketCommercialPriceError(
        409,
        'market_price_not_purchasable',
        `Produit ${product.id} non achetable sur ce marché (aucun prix local actif).`
      );
    }

    const qty = parseInt(item.quantity, 10) || 1;
    totalKmf += (Number(item._effective_unit_price_kmf) || 0) * qty;
  }

  return { total_kmf: totalKmf };
}

async function applyActiveMarketPricesToCatalogRows(executor = db, { marketCode, products }) {
  const market = await resolveMarketByCode(executor, marketCode);
  if (!market || !Array.isArray(products) || products.length === 0) return products || [];

  const productIds = [...new Set(products.map(product => product.id).filter(Boolean))];
  const { rows: decisions } = await executor.query(
    `SELECT product_id, amount, currency, active_at
       FROM product_market_price_drafts
      WHERE market_id = $1::uuid
        AND product_id = ANY($2::uuid[])
        AND status = 'LOCAL_ACTIVE'`,
    [market.id, productIds]
  );
  const markNotDecisional = (product) => ({
    ...product,
    purchasable: false,
    market_price_source: 'NOT_DECISIONAL',
    market_price_reason: 'NO_LOCAL_ACTIVE_PRICE_FOR_MARKET',
  });
  if (!decisions.length) return products.map(markNotDecisional);

  const decisionMap = new Map(decisions.map(row => [String(row.product_id), row]));
  const decisionIds = [...decisionMap.keys()];
  const { rows: conflicts } = await executor.query(
    `SELECT DISTINCT product_id::text AS product_id
       FROM (
         SELECT product_id FROM product_skus
          WHERE product_id = ANY($1::uuid[]) AND is_active = TRUE AND price_kmf IS NOT NULL
         UNION ALL
         SELECT product_id FROM product_variants
          WHERE product_id = ANY($1::uuid[]) AND price_kmf IS NOT NULL
       ) granular`,
    [decisionIds]
  );
  if (conflicts.length) {
    throw new MarketCommercialPriceError(
      409,
      'market_local_price_granular_price_conflict',
      'Un prix pays actif entre en conflit avec un prix SKU/variante explicite.'
    );
  }

  const output = [];
  for (const product of products) {
    const decision = decisionMap.get(String(product.id));
    if (!decision) {
      // Marché résolu, aucun LOCAL_ACTIVE : NOT_DECISIONAL. Le produit reste
      // affichable (métadonnées) mais n'est jamais marqué achetable sur ce
      // marché — jamais de fallback silencieux vers products.price_kmf.
      output.push(markNotDecisional(product));
      continue;
    }
    if (decision.currency !== market.currency) {
      throw new MarketCommercialPriceError(409, 'market_local_price_currency_mismatch', 'Décision locale active incohérente avec la devise du marché.');
    }
    const baseUnitPriceKmf = await projectLocalToKmf(decision.amount, decision.currency);
    const effectiveUnitPriceKmf = applyCanonicalPromotion(baseUnitPriceKmf, product);
    const promoApplied = effectiveUnitPriceKmf < baseUnitPriceKmf;
    output.push({
      ...product,
      price_kmf: effectiveUnitPriceKmf,
      purchasable: true,
      market_price_source: PRICE_STATUSES.ACTIVE,
      market_price_amount: Number(decision.amount),
      market_price_currency: decision.currency,
      market_price_base_kmf: baseUnitPriceKmf,
      market_price_promo_applied: promoApplied,
      market_price_active_at: decision.active_at || null,
    });
  }
  return output;
}

module.exports = {
  normalizeMarketCode,
  resolveMarketByCode,
  assertProductPriceShapeCompatible,
  projectLocalToKmf,
  resolveActiveProductMarketPricing,
  resolveActiveProductMarketPricingById,
  applyActiveMarketPricesToCheckoutItems,
  applyActiveMarketPricesToCatalogRows,
};
