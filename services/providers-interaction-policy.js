/**
 * @komerce-arch-lite
 * @role          providers-services-interaction-policy
 * @domain        providers-services
 * @layer         service-policy
 * @owner         services/providers-service.js
 * @purpose       Normaliser les actions cumulatives d'une offre et n'exposer que les coordonnées explicitement publiques nécessaires à ces actions.
 * @impact-areas  providers-services, discovery-modal, boutique
 * @version       2026-09
 */
'use strict';

const ALLOWED_ACTIONS = Object.freeze(['request', 'quote', 'callback', 'call', 'whatsapp']);
const INQUIRY_ACTIONS = Object.freeze(['request', 'quote', 'callback']);

function normalizeActions(value, { legacyFallback = true } = {}) {
  if (!Array.isArray(value)) return legacyFallback ? ['request'] : [];
  const seen = new Set();
  const normalized = [];
  for (const raw of value) {
    const key = String(raw || '').trim().toLowerCase();
    if (!ALLOWED_ACTIONS.includes(key) || seen.has(key)) continue;
    seen.add(key);
    normalized.push(key);
  }
  return normalized;
}

function cleanPublicContact(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function buildPublicInteraction({ actionsEnabled, publicPhone = null, publicWhatsapp = null } = {}) {
  const actions = normalizeActions(actionsEnabled);
  const phone = cleanPublicContact(publicPhone);
  const whatsapp = cleanPublicContact(publicWhatsapp);

  // Une action de contact direct n'est publiable que si sa coordonnée publique
  // explicite existe. On ne retombe jamais sur providers.phone.
  const filteredActions = actions.filter(action => {
    if (action === 'call') return Boolean(phone);
    if (action === 'whatsapp') return Boolean(whatsapp);
    return true;
  });

  const publicContact = {};
  if (filteredActions.includes('call')) publicContact.phone = phone;
  if (filteredActions.includes('whatsapp')) publicContact.whatsapp = whatsapp;

  return {
    actions: filteredActions,
    public_contact: Object.keys(publicContact).length ? publicContact : null,
  };
}

function isInquiryAction(action) {
  return INQUIRY_ACTIONS.includes(String(action || '').trim().toLowerCase());
}

module.exports = {
  ALLOWED_ACTIONS,
  INQUIRY_ACTIONS,
  normalizeActions,
  buildPublicInteraction,
  isInquiryAction,
};
