/**
 * @komerce-arch
 * @role          providers-services-routes
 * @domain        providers-services
 * @layer         route
 * @criticality   medium
 * @inputs        id (params), market_id (query)
 * @outputs       service_public_fields, physical_offer_public_fields
 * @depends       services/providers-service.js
 * @used-by       (aucun — Vague 2 D4, shadow : jamais monté dans bootstrap/api-routes.js)
 * @db-read       none
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
 */

const express = require('express');
const router  = express.Router();
const {
  getService, isServiceExposable,
  getPhysicalOffer, isPhysicalOfferExposable,
} = require('../services/providers-service');

// ── GET /api/providers-services/services/:id?market_id=X ────────────────
router.get('/services/:id', async (req, res, next) => {
  try {
    const { market_id } = req.query;
    if (!market_id) {
      return res.status(400).json({ error: 'market_id est requis' });
    }

    const exposable = await isServiceExposable(req.params.id, market_id);
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

// ── GET /api/providers-services/physical-offers/:id?market_id=X ─────────
router.get('/physical-offers/:id', async (req, res, next) => {
  try {
    const { market_id } = req.query;
    if (!market_id) {
      return res.status(400).json({ error: 'market_id est requis' });
    }

    const exposable = await isPhysicalOfferExposable(req.params.id, market_id);
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
