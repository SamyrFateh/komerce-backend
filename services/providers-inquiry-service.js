/**
 * @komerce-arch-lite
 * @role          providers-services-contextual-inquiry
 * @domain        providers-services
 * @layer         service
 * @owner         services/providers-service.js
 * @purpose       Créer une Inquiry contextualisée par une cible canonique, une intention request|callback et une précision facultative.
 * @impact-areas  providers-services, discovery-modal
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const { getService, getPhysicalOffer } = require('./providers-service');

async function createContextualInquiry({
  serviceId = null,
  physicalOfferId = null,
  requesterPhone,
  requestedWindow = null,
  intent = 'request',
  requesterNote = null,
}) {
  if (!requesterPhone) throw new Error('createContextualInquiry: requester_phone est requis');
  if (!['request', 'callback'].includes(intent)) {
    throw new Error(`createContextualInquiry: intent invalide (${intent})`);
  }

  const targetCount = [serviceId, physicalOfferId].filter(Boolean).length;
  if (targetCount !== 1) {
    throw new Error('createContextualInquiry: exactement une cible requise (service_id XOR physical_offer_id)');
  }

  // Le propos du rappel n'est jamais libre ou implicite : la cible canonique
  // existe avant l'INSERT et reste la source de vérité de ce dont on parle.
  if (serviceId) {
    const service = await getService(serviceId);
    if (!service) throw new Error(`createContextualInquiry: service introuvable (${serviceId})`);
  } else {
    const offer = await getPhysicalOffer(physicalOfferId);
    if (!offer) throw new Error(`createContextualInquiry: offre physique introuvable (${physicalOfferId})`);
  }

  const { rows } = await db.query(
    `INSERT INTO inquiries
       (service_id, physical_offer_id, requester_phone, requested_window, intent, requester_note, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'sent')
     RETURNING id, service_id, physical_offer_id, requester_phone, requested_window,
               intent, requester_note, proposed_window, status, sent_at, answered_at, created_at, updated_at`,
    [serviceId, physicalOfferId, requesterPhone, requestedWindow, intent, requesterNote]
  );
  return rows[0];
}

module.exports = { createContextualInquiry };
