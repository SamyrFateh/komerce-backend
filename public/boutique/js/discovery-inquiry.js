/**
 * @komerce-arch-lite
 * @role          providers-services-discovery-inquiry
 * @domain        providers-services
 * @layer         ui-service
 * @owner         public/boutique/js/discovery-inquiry.js
 * @purpose       Consommer demander/rappel/WhatsApp depuis le détail Discovery et créer l'Inquiry canonique après identité Komerce.
 * @impact-areas  boutique, discovery-rail, providers-services, auth
 * @version       2026-09
 */
'use strict';

import { bus } from './b-bus.js';
import { requireIdentity } from './b-identity.js';
import { showToast } from './b-utils.js';
import { createProviderInquiry } from './providers-services-api.js';

let _installed = false;
const _pending = new Set();

function successMessage(kind, action = 'request', handoff = null) {
  if (handoff === 'whatsapp') return 'Demande créée · ouverture de WhatsApp';
  if (action === 'callback') return 'Demande de rappel envoyée';
  return kind === 'physical_offer'
    ? 'Demande envoyée pour cette offre'
    : 'Demande envoyée';
}

function failureMessage(result) {
  if (result?.status === 404) return 'Cette offre n’est plus disponible.';
  if (result?.code === 'whatsapp_unavailable') return 'WhatsApp n’est pas disponible pour ce prestataire pour le moment.';
  if (result?.status === 401 || result?.code === 'identity_required') {
    return 'Votre identification a expiré. Réessayez.';
  }
  if (result?.code === 'network_error') return 'Connexion impossible. Réessayez.';
  return 'Impossible d’envoyer la demande. Réessayez.';
}

function setSourcePending(source, pending) {
  if (!(source instanceof HTMLElement)) return;
  source.disabled = pending;
  if (pending) source.setAttribute('aria-busy', 'true');
  else source.removeAttribute('aria-busy');
}

function openWhatsappHandoff(handoff) {
  if (!handoff?.url || handoff.channel !== 'whatsapp') return false;
  window.location.assign(handoff.url);
  return true;
}

async function handleDiscoveryRequest(payload = {}) {
  const {
    kind,
    ref,
    source = null,
    requestedWindow = null,
    requesterNote = null,
    action = 'request',
    handoff = null,
  } = payload;
  if (!ref || !['service', 'physical_offer'].includes(kind)) return false;
  if (!['request', 'callback'].includes(action)) return false;
  if (handoff && handoff !== 'whatsapp') return false;
  if (handoff === 'whatsapp' && kind !== 'service') return false;

  const key = `${kind}:${ref}:${action}:${handoff || 'komerce'}`;
  if (_pending.has(key)) return false;
  _pending.add(key);
  setSourcePending(source, true);

  try {
    const identity = await requireIdentity({
      reason: handoff === 'whatsapp'
        ? 'discuter avec ce prestataire sur WhatsApp'
        : (action === 'callback' ? 'demander à être rappelé' : 'envoyer votre demande'),
      title: 'Confirmer votre WhatsApp',
      returnFocusTo: source instanceof HTMLElement ? source : null,
    });
    if (!identity) return false;

    const result = await createProviderInquiry(
      kind,
      ref,
      requestedWindow,
      action,
      requesterNote,
      handoff,
    );
    if (!result?.ok) {
      showToast(failureMessage(result), 'error', 3200);
      return false;
    }

    showToast(successMessage(kind, action, handoff), 'success', 3200);
    if (handoff === 'whatsapp') return openWhatsappHandoff(result.handoff);
    return true;
  } finally {
    setSourcePending(source, false);
    _pending.delete(key);
  }
}

export function setupDiscoveryInquiry() {
  if (_installed) return;
  _installed = true;
  bus.on('discovery:request', handleDiscoveryRequest);
}

export { handleDiscoveryRequest, openWhatsappHandoff };
