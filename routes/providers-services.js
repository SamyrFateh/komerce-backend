/**
 * @komerce-arch
 * @role          providers-services-routes
 * @domain        providers-services
 * @layer         route
 * @criticality   medium
 * @inputs        id (params), market (query — code KM|YT|CM|CG, résolu serveur)
 * @outputs       service_public_fields, physical_offer_public_fields
 * @depends       services/providers-service.js, db (résolution code marché)
 * @used-by       (aucun — Vague 2 D4, shadow : jamais monté dans bootstrap/api-routes.js)
 * @db-read       markets
 * @db-write      none
 * @db-txn        single_statement_sufficient
 * @doctrine      RECHALLENGE_DOCTRINE_DISCOVERY_LOCALE_V2.md §G (contrat de
 *                lecture minimal, jamais une vérité métier exposée en détail)
 * @impact-areas  providers-services
 * @version       2026-08
 */

'use strict';

/**
 * KOMERCE — Vague 2 D4 : routes GET read-only shadow.
 *
 * Aucune mutation. Jamais montées dans bootstrap/api-routes.js à ce stade.
 * Champs publics minimaux uniquement — JAMAIS le téléphone ou tout autre
 * champ interne du provider : le contact réel se fait via une Inquiry
 * (écriture, hors périmètre de ce lot GET-only), pas par lecture directe
 * ici. Un objet non exposable renvoie 404, jamais le pourquoi (statut,
 * exposure, marché) — même discipline que local-stock/availability.
 *
 * market est un CODE (KM/YT/CM/CG), jamais un UUID — voir routes/local-
 * stock.js pour la justification complète (window.KomerceMarket,
 * KOMERCE_MARKET_LAYER_FREEZE.md §3, resolveMarketId()).
 */

const express = require('express');
const router  = express.Router();
const db = require('../db');
const {
  getService, isServiceExposable,
  getPhysicalOffer, isPhysicalOfferExposable,
} = require('../services/providers-service');

/**
 * Résout un code marché (KM/YT/CM/CG — window.KomerceMarket.get().code côté
 * client, KOMERCE_MARKET_LAYER_FREEZE.md §3 : "navigation — contextuel,
 * client, commutable, NON autorisant") vers l'UUID markets.id réel. Ne fait
 * JAMAIS confiance à un UUID brut fourni par le client.
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

// ── GET /api/providers-services/services/:id?market=KM ───────────────────
router.get('/services/:id', async (req, res, next) => {
  try {
    const { market } = req.query;
    if (!market) {
      return res.status(400).json({ error: 'market est requis' });
    }
    const marketId = await resolveMarketId(market);
    if (!marketId) {
      return res.status(400).json({ error: 'market inconnu ou inactif' });
    }

    const exposable = await isServiceExposable(req.params.id, marketId);
    if (!exposable) {
      return res.status(404).json({ error: 'Service introuvable' });
    }

    const service = await getService(req.params.id);
    res.json({
      id: service.id,
      title: service.title,
      description: service.description,
      zone: service.zone,
      market_id: service.market_id,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/providers-services/physical-offers/:id?market=KM ────────────
router.get('/physical-offers/:id', async (req, res, next) => {
  try {
    const { market } = req.query;
    if (!market) {
      return res.status(400).json({ error: 'market est requis' });
    }
    const marketId = await resolveMarketId(market);
    if (!marketId) {
      return res.status(400).json({ error: 'market inconnu ou inactif' });
    }

    const exposable = await isPhysicalOfferExposable(req.params.id, marketId);
    if (!exposable) {
      return res.status(404).json({ error: 'Offre introuvable' });
    }

    const offer = await getPhysicalOffer(req.params.id);
    res.json({
      id: offer.id,
      title: offer.title,
      description: offer.description,
      zone: offer.zone,
      market_id: offer.market_id,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
