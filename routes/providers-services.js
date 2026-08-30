/**
 * @komerce-arch
 * @role          providers-services-routes
 * @domain        providers-services
 * @layer         route
 * @criticality   medium
 * @inputs        id (params), market (query — code KM|YT|CM|CG, résolu serveur), inquiry target
 * @outputs       service_public_fields, physical_offer_public_fields, inquiry_public_result
 * @depends       services/providers-service.js, middleware/auth-guest.js, db (résolution code marché)
 * @used-by       bootstrap/api-routes.js, public/boutique/js/discovery-api.js
 * @db-read       markets
 * @db-write      none
 * @db-write-via:providers-service inquiries
 * @db-txn        delegated_to_service
 * @doctrine      RECHALLENGE_DOCTRINE_DISCOVERY_LOCALE_V2.md §G (contrat de
 *                lecture minimal, demande explicite, jamais une réservation)
 * @impact-areas  providers-services, boutique, discovery-rail
 * @version       2026-08
 */

'use strict';

/**
 * KOMERCE — Vague 2 : lecture publique minimale + création d'Inquiry.
 *
 * GET : champs publics minimaux uniquement — JAMAIS téléphone/provider_id.
 * POST /inquiries : identité Komerce obligatoire. Le téléphone demandeur est
 * dérivé de la session canonique côté serveur ; il n'est jamais accepté depuis
 * le payload client. Une demande ne peut viser qu'un objet encore exposable
 * sur le marché courant et porte sur exactement une cible : service_id XOR
 * physical_offer_id. Cela reste une Inquiry, jamais un paiement/réservation.
 *
 * market est un CODE (KM/YT/CM/CG), jamais un UUID — voir routes/local-stock.js.
 */

const express = require('express');
const router  = express.Router();
const db = require('../db');
const { authenticateOrCreateGuest } = require('../middleware/auth-guest');
const {
  createInquiry,
  getService, isServiceExposable,
  getPhysicalOffer, isPhysicalOfferExposable,
} = require('../services/providers-service');

/**
 * Résout un code marché de navigation vers l'UUID markets.id réel.
 * Le client ne fournit jamais directement l'autorité market_id.
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

function readInquiryTarget(body = {}) {
  const serviceId = body.service_id || null;
  const physicalOfferId = body.physical_offer_id || null;
  const targetCount = [serviceId, physicalOfferId].filter(Boolean).length;
  if (targetCount !== 1) return null;
  return { serviceId, physicalOfferId };
}

function readRequestedWindow(value) {
  if (value == null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, value: null };
  const normalized = value.trim();
  if (!normalized || normalized.length > 160) return { ok: false, value: null };
  return { ok: true, value: normalized };
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

// ── POST /api/providers-services/inquiries?market=KM ─────────────────────
router.post('/inquiries', authenticateOrCreateGuest, async (req, res, next) => {
  try {
    const { market } = req.query;
    if (!market) {
      return res.status(400).json({ error: 'market est requis' });
    }

    const marketId = await resolveMarketId(market);
    if (!marketId) {
      return res.status(400).json({ error: 'market inconnu ou inactif' });
    }

    const target = readInquiryTarget(req.body);
    if (!target) {
      return res.status(400).json({
        error: 'exactement une cible est requise (service_id XOR physical_offer_id)',
      });
    }

    const requestedWindow = readRequestedWindow(req.body?.requested_window);
    if (!requestedWindow.ok) {
      return res.status(400).json({ error: 'requested_window invalide' });
    }

    const requesterPhone = String(req.user?.phone || '').trim();
    if (!requesterPhone) {
      return res.status(401).json({ error: 'Identité requise', code: 'identity_required' });
    }

    const exposable = target.serviceId
      ? await isServiceExposable(target.serviceId, marketId)
      : await isPhysicalOfferExposable(target.physicalOfferId, marketId);

    if (!exposable) {
      return res.status(404).json({ error: 'Offre introuvable' });
    }

    const inquiry = await createInquiry({
      serviceId: target.serviceId,
      physicalOfferId: target.physicalOfferId,
      requesterPhone,
      requestedWindow: requestedWindow.value,
    });

    return res.status(201).json({
      inquiry: {
        id: inquiry.id,
        status: inquiry.status,
        target_kind: target.serviceId ? 'service' : 'physical_offer',
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
