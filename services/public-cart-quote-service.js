/**
 * @komerce-arch
 * @role          public-cart-quotation
 * @domain        boutique
 * @layer         service
 * @criticality   high
 * @inputs        explicit_market_code, personal_cart_lines
 * @outputs       server_priced_informational_quote
 * @depends       db.js, services/catalog-public-view.js, services/order-checkout-item-resolution.js, services/market-local-price-resolution-service.js
 * @db-read       markets, products, product_skus, product_variants, product_market_price_drafts, product_market_exposure, catalog_product_sale_holds
 * @db-write      none
 * @db-txn        rollback_only
 * @doctrine      public_quote_without_identity_or_relay, only_LOCAL_ACTIVE_is_buyer_effective
 * @impact-areas  boutique, checkout, documents, pricing
 * @version       2026-11
 */
'use strict';

// Devis informatif, jamais une commande. Réutilise les frontières officielles
// de vendabilité SKU/stock et de prix LOCAL_ACTIVE ; refuse tout prix local client.
const db = require('../db');
const { getRule } = require('../utils/rules');
const { publicCatalogVisibilitySql } = require('./catalog-public-view');
const { resolveCheckoutItems } = require('./order-checkout-item-resolution');
const { applyActiveMarketPricesToCheckoutItems } = require('./market-local-price-resolution-service');
const { resolveOrderItemTransportRail } = require('./transport-pricing');

class PublicQuoteError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MARKET = /^[A-Z]{2}$/;

function validatePublicCartQuote(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new PublicQuoteError(400, 'quote_payload_invalid', 'Panier de devis invalide.');
  }
  const marketCode = String(body.market_code || '').trim().toUpperCase();
  if (!MARKET.test(marketCode)) {
    throw new PublicQuoteError(400, 'quote_market_required', 'Choisissez un marché pour afficher ses prix.');
  }
  const original = body.items;
  if (!Array.isArray(original) || !original.length || original.length > 30) {
    throw new PublicQuoteError(400, 'quote_items_invalid', 'Le devis doit contenir 1 à 30 lignes.');
  }
  const items = original.map(row => {
    if (!row || !UUID.test(String(row.product_id || '')) ||
        !Number.isSafeInteger(row.quantity) || row.quantity < 1 ||
        (row.variant_combo != null && (
          typeof row.variant_combo !== 'object' || Array.isArray(row.variant_combo) ||
          Object.keys(row.variant_combo).length > 12 ||
          Object.entries(row.variant_combo).some(([key, value]) =>
            key.length > 80 || typeof value !== 'string' || value.length > 120)
        )) ||
        (row.requested_transport_rail != null &&
          !['SEA_STANDARD', 'AIR_EXPRESS'].includes(row.requested_transport_rail)) ||
        row.shared_cart_item_id != null) {
      throw new PublicQuoteError(400, 'quote_line_invalid', 'Une ligne du devis est invalide.');
    }
    return {
      product_id: String(row.product_id),
      quantity: row.quantity,
      variant_combo: row.variant_combo || null,
      requested_transport_rail: row.requested_transport_rail || null,
    };
  });
  return { marketCode, items };
}

async function quotePublicCart(body) {
  const { marketCode, items } = validatePublicCartQuote(body);
  // Le rail aérien ne peut jamais être activé par le seul devis.
  for (const item of items) {
    if (item.requested_transport_rail) resolveOrderItemTransportRail(item.requested_transport_rail);
  }
  const client = await db.getClient();
  let begun = false;
  try {
    await client.query('BEGIN');
    begun = true;
    const { rows: [market] } = await client.query(
      "SELECT id, code, currency, lifecycle_status FROM markets WHERE code=$1 AND is_active=TRUE LIMIT 1",
      [marketCode]
    );
    if (!market || market.lifecycle_status !== 'ACTIVE') {
      throw new PublicQuoteError(409, 'quote_market_not_active', 'Ce marché n’est pas ouvert aux commandes.');
    }
    const ids = [...new Set(items.map(item => item.product_id))];
    const { rows: visible } = await client.query(
      `SELECT p.id FROM products p
        WHERE p.id = ANY($1::uuid[])
          AND ${publicCatalogVisibilitySql('p', { marketCodeParamIndex: 2 })}`,
      [ids, marketCode]
    );
    if (visible.length !== ids.length) {
      throw new PublicQuoteError(409, 'quote_product_unavailable', 'Un article du panier n’est plus vendable sur ce marché.');
    }
    const maxQty = await getRule('MAX_QUANTITY_PER_ITEM', 100);
    const resolved = await resolveCheckoutItems({
      client, items, maxQty, fretPerKg: 0, aedKmf: null, customsPct: 0,
      pickupCodeRecipient: 'buyer', userId: null,
    });
    if (!resolved.ok) {
      throw new PublicQuoteError(resolved.status, resolved.body.code || 'quote_item_unavailable', resolved.body.error);
    }
    const priced = await applyActiveMarketPricesToCheckoutItems(client, {
      marketId: market.id, items, productMap: resolved.productMap,
    });
    const previewItems = items.map(item => {
      const product = resolved.productMap[item.product_id];
      const unit = Number(item._effective_unit_price_kmf);
      return {
        product_id: item.product_id,
        product_name: product.name_fr || product.name || 'Produit',
        quantity: item.quantity,
        variant_combo: item.variant_combo || null,
        unit_price_kmf: unit,
        line_total_kmf: unit * item.quantity,
      };
    });
    const total = previewItems.reduce((sum, item) => sum + item.line_total_kmf, 0);
    if (!Number.isSafeInteger(total) || total <= 0 ||
        Math.round(total) !== Math.round(Number(priced.total_kmf))) {
      throw new PublicQuoteError(409, 'quote_total_mismatch', 'Le prix du panier doit être actualisé.');
    }
    if (body.expected_total_kmf != null && Number(body.expected_total_kmf) !== total) {
      throw new PublicQuoteError(409, 'quote_price_changed', 'Le prix a changé. Rouvrez le devis pour le mettre à jour.');
    }
    return {
      market_code: marketCode,
      items: previewItems,
      items_total_kmf: total,
      transport_price_kmf: 0,
      discount_kmf: 0,
      total_kmf: total,
      // Ne correspond à aucune commande, aucun compte et aucun relais.
    };
  } finally {
    try { if (begun) await client.query('ROLLBACK'); } finally { client.release(); }
  }
}

module.exports = { quotePublicCart, validatePublicCartQuote, PublicQuoteError };
