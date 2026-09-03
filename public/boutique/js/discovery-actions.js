/**
 * @komerce-arch-lite
 * @role          catalog-discovery-actions
 * @domain        catalog
 * @layer         ui-controller
 * @owner         public/boutique/js/discovery-actions.js
 * @purpose       Posséder l'unique émission de la commande discovery:request depuis la fiche Komerce contextualisée.
 * @impact-areas  product-discovery, discovery-rail, modal-layout
 * @version       2026-09
 */
'use strict';

import { bus } from './b-bus.js';

const INQUIRY_ACTIONS = Object.freeze(['request', 'callback']);

export function requestDiscovery(
  kind,
  ref,
  source,
  requestedWindow = null,
  action = 'request',
  requesterNote = null,
) {
  if ((kind !== 'service' && kind !== 'physical_offer') || !ref) return false;
  const normalizedAction = String(action || 'request').trim().toLowerCase();
  if (!INQUIRY_ACTIONS.includes(normalizedAction)) return false;

  const normalizedWindow = typeof requestedWindow === 'string'
    ? (requestedWindow.trim() || null)
    : null;
  const normalizedNote = typeof requesterNote === 'string'
    ? (requesterNote.trim() || null)
    : null;

  const payload = {
    kind,
    ref: String(ref),
    source,
    requestedWindow: normalizedWindow,
    requesterNote: normalizedNote,
  };
  if (normalizedAction !== 'request') payload.action = normalizedAction;
  bus.emit('discovery:request', payload);
  return true;
}
