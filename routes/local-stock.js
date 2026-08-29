/**
 * @komerce-arch
 * @role          local-stock-routes
 * @domain        local-stock
 * @layer         route
 * @criticality   medium
 * @inputs        product_id, market (query — code KM|YT|CM|CG, résolu serveur)
 * @outputs       availability_projection, exposable_flag
 * @depends       services/local-stock-service.js, db (résolution code marché)
 * @used-by       (aucun — Vague 2 D4, shadow : jamais monté dans bootstrap/api-routes.js)
 * @db-read       markets (résolution code -> id, jamais un UUID brut du client)
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
 *
 * market est un CODE (KM/YT/CM/CG), jamais un UUID — exactement ce que le
 * frontend a déjà via window.KomerceMarket.get().code
 * (public/boutique/js/market-context.js), une valeur de navigation
 * (KOMERCE_MARKET_LAYER_FREEZE.md §3 : "contextuel, client, commutable, NON
 * autorisant"), jamais une preuve d'autorisation. resolveMarketId() la
 * traduit en UUID réel côté serveur avant tout usage — la route ne fait
 * JAMAIS confiance à un market_id brut fourni par le client.
 */

const express = require('express');
const router  = express.Router();
const db = require('../db');
const { getAvailability, isStockExposable } = require('../services/local-stock-service');

/**
 * Résout un code marché (KM/YT/CM/CG — window.KomerceMarket.get().code côté
 * client, KOMERCE_MARKET_LAYER_FREEZE.md §3 : "navigation — contextuel,
 * client, commutable, NON autorisant") vers l'UUID markets.id réel. Ne fait
 * JAMAIS confiance à un UUID brut fourni par le client — seul un code de
 * navigation déjà légitimé par le freeze est accepté, résolu et validé
 * serveur avant tout usage dans isStockExposable/getAvailability.
 * @param {string} marketCode
 * @returns {Promise<string|null>}
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

module.exports = router;
