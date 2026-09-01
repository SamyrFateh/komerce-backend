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

export function requestDiscovery(kind, ref, source) {
  if ((kind !== 'service' && kind !== 'physical_offer') || !ref) return false;
  bus.emit('discovery:request', { kind, ref: String(ref), source });
  return true;
}
