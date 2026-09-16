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
const HANDOFFS = Object.freeze(['whatsapp']);

export function requestDiscovery(
  kind,
  ref,
  source,
  requestedWindow = null,
  action = 'request',
  requesterNote = null,
  handoff = null,
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
  const normalizedHandoff = handoff == null || handoff === ''
    ? null
    : String(handoff).trim().toLowerCase();
  if (normalizedHandoff && !HANDOFFS.includes(normalizedHandoff)) return false;
  if (normalizedHandoff === 'whatsapp' && kind !== 'service') return false;

  const payload = {
    kind,
    ref: String(ref),
    source,
    requestedWindow: normalizedWindow,
    requesterNote: normalizedNote,
  };
  if (normalizedAction !== 'request') payload.action = normalizedAction;
  if (normalizedHandoff) payload.handoff = normalizedHandoff;
  bus.emit('discovery:request', payload);
  return true;
}
