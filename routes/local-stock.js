/**
 * @komerce-arch
 * @role          local-stock-routes
 * @domain        local-stock
 * @layer         route
 * @criticality   medium
 * @inputs        product_id, market_id (query)
 * @outputs       availability_projection, exposable_flag
 * @depends       services/local-stock-service.js
 * @used-by       (aucun — Vague 2 D4, shadow : jamais monté dans bootstrap/api-routes.js)
 * @db-read       local_stock, local_stock_allocations (via le service)
 * @db-write      none
 * @db-txn        single_statement_sufficient
 * @doctrine      RECHALLENGE_DOCTRINE_DISCOVERY_LOCALE_V2.md §G (contrat de
 *                lecture minimal, jamais une vérité métier exposée en détail)
 * @impact-areas  local-stock
 * @version       2026-08
 */

'use strict';

/**
 * KOMERCE — Vague 2 D4 : route GET read-only shadow.
 *
 * Aucune mutation. Jamais montée dans bootstrap/api-routes.js à ce stade —
 * le frontend peut techniquement lire (route fonctionnelle, testable), mais
 * rien n'est encore branché (D6/D7). La route ne renvoie jamais le POURQUOI
 * d'une indisponibilité (allocations actives, exposure DISABLED, etc.) —
 * uniquement le résultat binaire, jamais une vérité métier détaillée.
 */

const express = require('express');
const router  = express.Router();
const { getAvailability, isStockExposable } = require('../services/local-stock-service');

// ── GET /api/local-stock/availability?product_id=X&market_id=Y ──────────
router.get('/availability', async (req, res, next) => {
  try {
    const { product_id, market_id } = req.query;
    if (!product_id || !market_id) {
      return res.status(400).json({ error: 'product_id et market_id sont requis' });
    }

    const [availability, exposable] = await Promise.all([
      getAvailability(product_id, market_id),
      isStockExposable(product_id, market_id),
    ]);

    res.json({ availability, exposable });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
