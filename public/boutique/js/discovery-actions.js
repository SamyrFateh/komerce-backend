/**
 * @komerce-arch-lite
 * @role          catalog-discovery-actions
 * @domain        catalog
 * @layer         ui-controller
 * @owner         public/boutique/js/discovery-actions.js
 * @purpose       Posséder l'unique émission de la commande discovery:request, quel que soit le point d'entrée Boutique.
 * @impact-areas  product-discovery, discovery-rail, modal-layout
 * @version       2026-09
 */
'use strict';

import { bus } from './b-bus.js';

const INQUIRY_ACTIONS = Object.freeze(['request', 'quote', 'callback']);

export function requestDiscovery(kind, ref, source, requestedWindow = null, action = 'request') {
  if ((kind !== 'service' && kind !== 'physical_offer') || !ref) return false;
  const normalizedAction = String(action || 'request').trim().toLowerCase();
  if (!INQUIRY_ACTIONS.includes(normalizedAction)) return false;

  const normalizedWindow = typeof requestedWindow === 'string'
    ? (requestedWindow.trim() || null)
    : null;
  const payload = {
    kind,
    ref: String(ref),
    source,
    requestedWindow: normalizedWindow,
  };
  // Compatibilité du contrat historique : l'action request par défaut ne
  // rajoute aucun champ au signal existant. quote/callback sont additifs.
  if (normalizedAction !== 'request') payload.action = normalizedAction;
  bus.emit('discovery:request', payload);
  return true;
}
