/**
 * @komerce-arch-lite
 * @role          providers-services-interaction-policy
 * @domain        providers-services
 * @layer         service-policy
 * @owner         services/providers-service.js
 * @purpose       Normaliser les capacités historiques d'une offre vers les deux interactions publiques Komerce : demander ou être rappelé.
 * @impact-areas  providers-services, discovery-modal, boutique
 * @version       2026-09
 */
'use strict';

// Le stockage garde les valeurs historiques afin de pouvoir relire les offres
// déjà publiées. La projection publique, elle, est volontairement plus étroite :
// le client reste dans Komerce et choisit soit une demande contextualisée,
// soit un rappel contextualisé. Aucun numéro provider n'est publié par cette
// politique, même si un ancien dataset avait activé call/whatsapp.
const STORED_ACTIONS = Object.freeze(['request', 'quote', 'callback', 'call', 'whatsapp']);
const PUBLIC_ACTIONS = Object.freeze(['request', 'callback']);
const INQUIRY_ACTIONS = Object.freeze(['request', 'callback']);

function publicActionForStoredAction(value) {
  const key = String(value || '').trim().toLowerCase();
  if (!STORED_ACTIONS.includes(key)) return null;
  if (key === 'request' || key === 'quote') return 'request';
  if (key === 'callback' || key === 'call' || key === 'whatsapp') return 'callback';
  return null;
}

function normalizeActions(value, { legacyFallback = true } = {}) {
  if (!Array.isArray(value)) return legacyFallback ? ['request'] : [];
  const seen = new Set();
  const normalized = [];
  for (const raw of value) {
    const action = publicActionForStoredAction(raw);
    if (!action || seen.has(action)) continue;
    seen.add(action);
    normalized.push(action);
  }
  return normalized;
}

function buildPublicInteraction({ actionsEnabled } = {}) {
  return {
    actions: normalizeActions(actionsEnabled),
    public_contact: null,
  };
}

function isInquiryAction(action) {
  return INQUIRY_ACTIONS.includes(String(action || '').trim().toLowerCase());
}

module.exports = {
  STORED_ACTIONS,
  PUBLIC_ACTIONS,
  INQUIRY_ACTIONS,
  publicActionForStoredAction,
  normalizeActions,
  buildPublicInteraction,
  isInquiryAction,
};
