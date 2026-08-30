/**
 * @komerce-arch-lite
 * @role          providers-services-discovery-inquiry
 * @domain        providers-services
 * @layer         ui-service
 * @owner         public/boutique/js/discovery-inquiry.js
 * @purpose       Consommer l'intention Commander/Demander du rail Discovery et créer l'Inquiry canonique après identité Komerce.
 * @impact-areas  boutique, discovery-rail, providers-services, auth
 * @version       2026-08
 */
'use strict';

import { bus } from './b-bus.js';
import { requireIdentity } from './b-identity.js';
import { showToast } from './b-utils.js';
import { createProviderInquiry } from './providers-services-api.js';

let _installed = false;
const _pending = new Set();

function successMessage(kind) {
  return kind === 'physical_offer'
    ? 'Demande de commande envoyée'
    : 'Demande envoyée';
}

function failureMessage(result) {
  if (result?.status === 404) return 'Cette offre n’est plus disponible.';
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

async function handleDiscoveryRequest(payload = {}) {
  const { kind, ref, source = null } = payload;
  if (!ref || !['service', 'physical_offer'].includes(kind)) return false;

  const key = `${kind}:${ref}`;
  if (_pending.has(key)) return false;
  _pending.add(key);
  setSourcePending(source, true);

  try {
    const identity = await requireIdentity({
      reason: 'envoyer votre demande',
      title: 'Confirmer votre WhatsApp',
      returnFocusTo: source instanceof HTMLElement ? source : null,
    });
    if (!identity) return false;

    const result = await createProviderInquiry(kind, ref);
    if (!result?.ok) {
      showToast(failureMessage(result), 'error', 3200);
      return false;
    }

    showToast(successMessage(kind), 'success', 3200);
    bus.emit('discovery:inquiry-created', {
      id: result.inquiry.id,
      status: result.inquiry.status,
      kind,
      ref,
    });
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

export { handleDiscoveryRequest };
