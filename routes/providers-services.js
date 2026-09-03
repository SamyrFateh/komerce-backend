/**
 * @komerce-arch
 * @role          providers-services-routes
 * @domain        providers-services
 * @layer         route
 * @criticality   medium
 * @inputs        id (params), market (query — code KM|YT|CM|CG, résolu serveur), inquiry target, intent, requester_note
 * @outputs       service_public_fields, physical_offer_public_fields, inquiry_public_result
 * @depends       services/providers-service.js, services/providers-interaction-policy.js, middleware/auth-guest.js, db (résolution code marché)
 * @used-by       bootstrap/api-routes.js, public/boutique/js/discovery-api.js
 * @db-read       markets
 * @db-write      none
 * @db-write-via:providers-service inquiries
 * @db-txn        delegated_to_service
 * @doctrine      docs/doctrine/DOCTRINE_DISCOVERY_LOCALE_UNIFIEE.md
 * @impact-areas  providers-services, boutique, discovery-rail
 * @version       2026-09
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db = require('../db');
const { authenticateOrCreateGuest } = require('../middleware/auth-guest');
const {
  createInquiry,
  getService, isServiceExposable,
  getPhysicalOffer, isPhysicalOfferExposable,
} = require('../services/providers-service');
const {
  buildPublicInteraction,
} = require('../services/providers-interaction-policy');

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

function readInquiryIntent(value) {
  if (value == null || value === '') return { ok: true, value: 'request' };
  if (typeof value !== 'string') return { ok: false, value: null };
  const normalized = value.trim().toLowerCase();
  // `quote` a été exposé brièvement avant la convergence V2. Il reste accepté
  // comme alias de request afin qu'un ancien client ne casse pas au déploiement.
  if (normalized === 'quote') return { ok: true, value: 'request' };
  if (!['request', 'callback'].includes(normalized)) return { ok: false, value: null };
  return { ok: true, value: normalized };
}

function readRequesterNote(value) {
  if (value == null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, value: null };
  const normalized = value.trim();
  if (!normalized || normalized.length > 600) return { ok: false, value: null };
  return { ok: true, value: normalized };
}

function resolvePublicInteraction(row) {
  return buildPublicInteraction({ actionsEnabled: row?.actions_enabled });
}

router.get('/services/:id', async (req, res, next) => {
  try {
    const { market } = req.query;
    if (!market) return res.status(400).json({ error: 'market est requis' });
    const marketId = await resolveMarketId(market);
    if (!marketId) return res.status(400).json({ error: 'market inconnu ou inactif' });

    const exposable = await isServiceExposable(req.params.id, marketId);
    if (!exposable) return res.status(404).json({ error: 'Service introuvable' });

    const service = await getService(req.params.id);
    const interaction = resolvePublicInteraction(service);
    res.json({
      id: service.id,
      title: service.title,
      description: service.description,
      zone: service.zone,
      market_id: service.market_id,
      image_ref: service.image_ref || null,
      provider_name: service.provider_name || null,
      actions: interaction.actions,
      public_contact: null,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/physical-offers/:id', async (req, res, next) => {
  try {
    const { market } = req.query;
    if (!market) return res.status(400).json({ error: 'market est requis' });
    const marketId = await resolveMarketId(market);
    if (!marketId) return res.status(400).json({ error: 'market inconnu ou inactif' });

    const exposable = await isPhysicalOfferExposable(req.params.id, marketId);
    if (!exposable) return res.status(404).json({ error: 'Offre introuvable' });

    const offer = await getPhysicalOffer(req.params.id);
    const interaction = resolvePublicInteraction(offer);
    res.json({
      id: offer.id,
      title: offer.title,
      description: offer.description,
      zone: offer.zone,
      market_id: offer.market_id,
      image_ref: offer.image_ref || null,
      provider_name: offer.provider_name || null,
      actions: interaction.actions,
      public_contact: null,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/inquiries', authenticateOrCreateGuest, async (req, res, next) => {
  try {
    const { market } = req.query;
    if (!market) return res.status(400).json({ error: 'market est requis' });

    const marketId = await resolveMarketId(market);
    if (!marketId) return res.status(400).json({ error: 'market inconnu ou inactif' });

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

    const intent = readInquiryIntent(req.body?.intent);
    if (!intent.ok) {
      return res.status(400).json({ error: 'intent invalide' });
    }

    const requesterNote = readRequesterNote(req.body?.requester_note);
    if (!requesterNote.ok) {
      return res.status(400).json({ error: 'requester_note invalide' });
    }

    const requesterPhone = String(req.user?.phone || '').trim();
    if (!requesterPhone) {
      return res.status(401).json({ error: 'Identité requise', code: 'identity_required' });
    }

    const exposable = target.serviceId
      ? await isServiceExposable(target.serviceId, marketId)
      : await isPhysicalOfferExposable(target.physicalOfferId, marketId);

    if (!exposable) return res.status(404).json({ error: 'Offre introuvable' });

    const inquiry = await createInquiry({
      serviceId: target.serviceId,
      physicalOfferId: target.physicalOfferId,
      requesterPhone,
      requestedWindow: requestedWindow.value,
      intent: intent.value,
      requesterNote: requesterNote.value,
    });

    return res.status(201).json({
      inquiry: {
        id: inquiry.id,
        status: inquiry.status,
        intent: inquiry.intent,
        target_kind: target.serviceId ? 'service' : 'physical_offer',
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
