/**
 * @komerce-arch
 * @role          local-stock-routes
 * @domain        local-stock
 * @layer         route
 * @criticality   medium
 * @inputs        product_id, market (query — code KM|YT|CM|CG, résolu serveur),
 *                relais_id, quantity
 * @outputs       availability_projection, exposable_flag, checkout_fulfillment_preview
 * @depends       services/local-stock-service.js, services/local-stock-checkout-preview.js,
 *                db.js
 * @used-by       bootstrap/api-routes.js, public/boutique/js/b-checkout.js
 * @db-read       markets, relais
 * @db-write      none
 * @db-txn        single_statement_sufficient
 * @doctrine      docs/doctrine/DOCTRINE_FULFILLMENT_MIXTE.md ;
 *                RECHALLENGE_DOCTRINE_DISCOVERY_LOCALE_V2.md §G
 * @impact-areas  local-stock, checkout
 * @version       2026-09
 */

'use strict';

/**
 * KOMERCE — projections publiques read-only du stock local.
 *
 * - /availability sert la promesse Discovery produit-level.
 * - /checkout-preview sert une projection quantité + relais pour expliquer
 *   le checkout mixte. Elle ne réserve rien et n'est jamais l'autorité finale :
 *   POST /api/orders résout à nouveau LOCAL_STOCK/IMPORT sous verrou.
 *
 * Aucune route ne renvoie le pourquoi opérationnel détaillé d'une
 * indisponibilité (allocation précise, exposure brut, quantité physique).
 */

const express = require('express');
const router  = express.Router();
const db = require('../db');
const { getAvailability, isStockExposable } = require('../services/local-stock-service');
const { previewCheckoutFulfillmentSources } = require('../services/local-stock-checkout-preview');

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Résout un code marché (KM/YT/CM/CG) vers l'UUID markets.id réel.
 * Le client ne fournit jamais directement un market_id d'autorité.
 */
async function resolveMarketId(marketCode) {
  if (!marketCode) return null;
  const { rows } = await db.query(
    'SELECT id FROM markets WHERE code = $1 AND is_active = true',
    [String(marketCode).toUpperCase()]
  );
  return rows[0]?.id || null;
}

// ── GET /api/local-stock/availability?product_id=X&market=KM ────────────
router.get('/availability', async (req, res, next) => {
  try {
    const { product_id, market } = req.query;
    if (!product_id || !market) {
      return res.status(400).json({ error: 'product_id et market sont requis' });
    }

    const marketId = await resolveMarketId(market);
    if (!marketId) {
      return res.status(400).json({ error: 'market inconnu ou inactif' });
    }

    const [availability, exposable] = await Promise.all([
      getAvailability(product_id, marketId),
      isStockExposable(product_id, marketId),
    ]);

    res.json({ availability, exposable });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/local-stock/checkout-preview ────────────────────────────────
// Exemple :
//   ?relais_id=R&product_id=P1&quantity=2&product_id=P2&quantity=1
//
// Les paires product_id/quantity restent alignées par ordre d'apparition.
// Le serveur résout relais.market_id : aucun market_id brut n'est accepté.
router.get('/checkout-preview', async (req, res, next) => {
  try {
    const relaisId = String(req.query.relais_id || '').trim();
    const productIds = asArray(req.query.product_id).map(v => String(v || '').trim());
    const quantities = asArray(req.query.quantity);

    if (!relaisId || !productIds.length) {
      return res.status(400).json({ error: 'relais_id et product_id sont requis' });
    }
    if (productIds.length > 50) {
      return res.status(400).json({ error: '50 lignes maximum pour la prévisualisation' });
    }
    if (quantities.length && quantities.length !== productIds.length) {
      return res.status(400).json({ error: 'quantity doit correspondre à chaque product_id' });
    }

    const demands = productIds.map((productId, index) => {
      const quantity = Number(quantities[index] ?? 1);
      if (!productId || !Number.isInteger(quantity) || quantity <= 0 || quantity > 100) {
        return null;
      }
      return { productId, quantity };
    });
    if (demands.some(v => !v)) {
      return res.status(400).json({ error: 'product_id/quantity invalide' });
    }

    const { rows } = await db.query(
      `SELECT market_id
         FROM relais
        WHERE id = $1 AND is_active = TRUE`,
      [relaisId]
    );
    const marketId = rows[0]?.market_id || null;
    if (!marketId) {
      return res.status(400).json({ error: 'relais inconnu, inactif ou sans marché' });
    }

    const projection = await previewCheckoutFulfillmentSources({ marketId, demands });
    const items = Object.entries(projection).map(([product_id, state]) => ({
      product_id,
      state,
    }));

    return res.json({
      preview: true,
      relais_id: relaisId,
      items,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;