/**
 * @komerce-arch-lite
 * @role          boutique-local-stock-badge-mount
 * @domain        catalog
 * @layer         ui-controller
 * @owner         public/boutique/js/local-stock-badge-mount.js
 * @purpose       Branche local-stock-badge.js dans le DOM réel de la PDP —
 *                Vague 2 D6, point d'intégration laissé en suspens en
 *                premier lot (badge construit autonome, jamais monté).
 * @impact-areas  boutique, pdp, product-modal
 * @version       2026-08
 */
'use strict';

/**
 * @module local-stock-badge-mount
 * @brief Écoute le cycle de vie de la modale produit, jamais son propre.
 *
 * N'invente aucun nouveau signal : s'accroche à bus:modal:detail-ready
 * (b-modal-product-detail-bootstrap.js), déjà émis systématiquement après
 * CHAQUE rendu du détail produit — ouverture initiale ET resize mobile<->
 * desktop (renderResponsiveProductDetail émet ce signal dans les deux
 * chemins). "Le module panier reste propriétaire de sa projection UI et
 * écoute ce signal" (commentaire du fichier source) — ce module suit
 * exactement le même patron déjà établi, pas un nouveau mécanisme.
 *
 * Ne modifie JAMAIS b-modal-buybox-shared.js ni les compositions mobile/
 * desktop elles-mêmes ("high criticality", flux d'achat) — uniquement le
 * slot HTML statique #k-local-stock-badge-slot (index.html), déjà présent
 * dans le squelette de modale au même titre que #k-modal-stock, #k-modal-
 * cat, etc.
 */

import { bus } from './b-bus.js';
import { state } from './b-store.js';
import { renderLocalStockBadge } from './local-stock-badge.js';

const SLOT_ID = 'k-local-stock-badge-slot';

function slotElement() {
  return document.getElementById(SLOT_ID);
}

function currentProductId() {
  return state.modalProduct ? String(state.modalProduct.id) : null;
}

/**
 * Installe les écouteurs. Idempotent — un second appel est un no-op, même
 * patron que setupProductDetailModal() (b-modal-product-detail-bootstrap.js).
 */
let _installed = false;
export function setupLocalStockBadgeMount() {
  if (_installed) return;
  _installed = true;

  bus.on('modal:detail-ready', () => {
    const container = slotElement();
    const productId = currentProductId();
    if (!container || !productId) return;
    renderLocalStockBadge(container, productId);
  });

  bus.on('modal:closed', () => {
    const container = slotElement();
    if (container) container.innerHTML = '';
  });
}

export const _localStockBadgeMountTestApi = Object.freeze({
  SLOT_ID,
  _resetForTests() { _installed = false; },
});
