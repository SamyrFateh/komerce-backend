/**
 * @komerce-arch
 * @role          providers-services-routes
 * @domain        providers-services
 * @layer         route
 * @criticality   medium
 * @inputs        id (params), market (query — code KM|YT|CM|CG, résolu serveur), inquiry target, intent, requester_note, handoff
 * @outputs       service_public_fields, physical_offer_public_fields, inquiry_public_result, optional_whatsapp_handoff
 * @depends       services/providers-service.js, services/providers-inquiry-service.js, services/providers-interaction-policy.js, middleware/auth-guest.js, db (résolution code marché + handoff WhatsApp)
 * @used-by       bootstrap/api-routes.js, public/boutique/js/discovery-api.js
 * @db-read       markets, services, providers
 * @db-write      none
 * @db-write-via:providers-inquiry-service inquiries
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
  getService, isServiceExposable,
  getPhysicalOffer, isPhysicalOfferExposable,
} = require('../services/providers-service');
const { createContextualInquiry } = require('../services/providers-inquiry-service');
const { buildPublicInteraction } = require('../services/providers-interaction-policy');

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
  // Compat déploiement : `quote` a brièvement existé côté UI ; il converge
  // vers la demande contextualisée sans créer une troisième interaction.
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

function readHandoff(value) {
  if (value == null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, value: null };
  const normalized = value.trim().toLowerCase();
  if (normalized !== 'whatsapp') return { ok: false, value: null };
  return { ok: true, value: normalized };
}

function resolvePublicInteraction(row) {
  return buildPublicInteraction({ actionsEnabled: row?.actions_enabled });
}

function hasWhatsappCapability(row) {
  return Array.isArray(row?.actions_enabled)
    && row.actions_enabled.some(action => String(action || '').trim().toLowerCase() === 'whatsapp');
}

function normalizeWhatsappNumber(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length < 7 || digits.length > 15 || digits.startsWith('0')) return null;
  return digits;
}

async function resolveServiceWhatsappTarget(serviceId, marketId) {
  const { rows } = await db.query(
    `SELECT p.public_whatsapp, p.name AS provider_name, s.title
       FROM services s
       JOIN providers p ON p.id = s.provider_id
      WHERE s.id = $1
        AND s.market_id = $2
        AND s.status = 'active'
        AND s.commercial_exposure = 'ENABLED'
        AND p.status = 'active'
        AND 'whatsapp' = ANY(COALESCE(s.actions_enabled, ARRAY[]::text[]))
        AND p.public_whatsapp IS NOT NULL
        AND btrim(p.public_whatsapp) <> ''`,
    [serviceId, marketId]
  );
  const target = rows[0] || null;
  if (!target) return null;
  const digits = normalizeWhatsappNumber(target.public_whatsapp);
  if (!digits) return null;
  return {
    digits,
    title: target.title || 'ce service',
    providerName: target.provider_name || null,
  };
}

function buildWhatsappHandoff(target, inquiryId) {
  const reference = `SR-${String(inquiryId).split('-')[0].toUpperCase()}`;
  const provider = target.providerName ? ` auprès de ${target.providerName}` : '';
  const message = `Bonjour, je vous contacte via Komerce${provider} pour le service « ${target.title} ». Référence Komerce : ${reference}.`;
  return {
    channel: 'whatsapp',
    reference,
    url: `https://wa.me/${target.digits}?text=${encodeURIComponent(message)}`,
  };
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
      whatsapp_available: hasWhatsappCapability(service),
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
    if (!requestedWindow.ok) return res.status(400).json({ error: 'requested_window invalide' });

    const intent = readInquiryIntent(req.body?.intent);
    if (!intent.ok) return res.status(400).json({ error: 'intent invalide' });

    const requesterNote = readRequesterNote(req.body?.requester_note);
    if (!requesterNote.ok) return res.status(400).json({ error: 'requester_note invalide' });

    const handoff = readHandoff(req.body?.handoff);
    if (!handoff.ok) return res.status(400).json({ error: 'handoff invalide' });
    if (handoff.value === 'whatsapp' && !target.serviceId) {
      return res.status(400).json({ error: 'handoff WhatsApp réservé aux services', code: 'invalid_handoff_target' });
    }

    const requesterPhone = String(req.user?.phone || '').trim();
    if (!requesterPhone) {
      return res.status(401).json({ error: 'Identité requise', code: 'identity_required' });
    }

    const exposable = target.serviceId
      ? await isServiceExposable(target.serviceId, marketId)
      : await isPhysicalOfferExposable(target.physicalOfferId, marketId);
    if (!exposable) return res.status(404).json({ error: 'Offre introuvable' });

    let whatsappTarget = null;
    if (handoff.value === 'whatsapp') {
      whatsappTarget = await resolveServiceWhatsappTarget(target.serviceId, marketId);
      if (!whatsappTarget) {
        return res.status(409).json({
          error: 'WhatsApp indisponible pour ce service',
          code: 'whatsapp_unavailable',
        });
      }
    }

    const inquiry = await createContextualInquiry({
      serviceId: target.serviceId,
      physicalOfferId: target.physicalOfferId,
      requesterPhone,
      requestedWindow: requestedWindow.value,
      intent: intent.value,
      requesterNote: requesterNote.value,
    });

    const payload = {
      inquiry: {
        id: inquiry.id,
        status: inquiry.status,
        intent: inquiry.intent,
        target_kind: target.serviceId ? 'service' : 'physical_offer',
      },
    };
    if (whatsappTarget) payload.handoff = buildWhatsappHandoff(whatsappTarget, inquiry.id);

    return res.status(201).json(payload);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
