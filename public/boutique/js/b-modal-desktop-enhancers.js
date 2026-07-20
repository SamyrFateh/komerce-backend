/**
 * @komerce-arch
 * @role          desktop-product-modal-enhancer
 * @domain        boutique
 * @layer         ui-enhancer
 * @criticality   medium
 * @inputs        modal_state, desktop_viewport, bus_events
 * @outputs       none
 * @depends       b-bus.js
 * @used-by       main.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md, docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md
 * @impact-areas  modal-desktop, responsive-layout
 * @version       2026-07 — D-P1 (T-016)
 */

'use strict';

/**
 * PDC-5 — Enhancer desktop de COMPOSITION uniquement.
 *
 * Ce module ne calcule plus :
 *   - prix / ancien prix / économie ;
 *   - stock ou rareté ;
 *   - livraison ;
 *   - sous-total ;
 *   - paiement produit.
 *
 * Ces vérités appartiennent au Product Detail Contract, au reducer SKU et au
 * renderer `b-modal-desktop-product.js`.
 *
 * D-P1 (T-016) : le panneau commercial desktop de la PDP n'affiche plus
 * aucun enrichissement éditorial (fil d'Ariane, réassurance, partage,
 * vu récemment). Ce module ne conserve donc plus que les abonnements bus,
 * gardés idempotents (cf. MDP-3) au cas où un enrichissement reviendrait
 * sur un périmètre distinct du panneau commercial PDP.
 */

import { bus } from './b-bus.js';

let _enhancersInstalled = false;

function onModalOpened() {}

export function setupModalDesktopEnhancers() {
  if (_enhancersInstalled) return;
  _enhancersInstalled = true;
  bus.on('modal:opened', onModalOpened);
  // MDP-3 : réconciliation resize. Un modal ouvert en mobile puis basculé en
  // desktop ne rejoue jamais modal:opened. onModalOpened() est un no-op
  // volontaire depuis D-P1 ; cet abonnement est conservé pour que
  // setupModalDesktopEnhancers reste l'unique point d'entrée attendu par
  // main.js si un enrichissement de composition distinct devait revenir.
  bus.on('modal:composition-synced', onModalOpened);
}
