/**
 * @komerce-arch-lite
 * @role          boutique-b-modal
 * @domain        shared-cart-modal
 * @layer         ui-component
 * @owner         public/boutique/js/b-modal-core.js
 * @purpose       supports public/boutique/js/b-modal-core.js
 * @impact-areas  boutique
 * @version       2026-06
 */
'use strict';

/**
 * b-modal.js — Façade (ARCH-2 complet, PR5).
 *
 * Ce fichier est désormais une façade pure : il ré-exporte la surface publique
 * de la modal sans contenir de logique. Tous les consommateurs existants
 * (b-catalog, b-favs, b-subcat, b-product-open-contract, boutique.js) continuent
 * d'importer depuis ce chemin — aucun changement côté consommateurs.
 *
 * Implémentation → b-modal-core.js (cycle open/close, state, overlay, body-lock,
 * historique, setupModal) + les 4 sous-modules ARCH-2.
 */

import {
  openModal, closeModal, modalGoBack, setupModal,
  setupImageZoneTouch,
}                          from './b-modal-core.js';
import {
  buildCarouselSlides, goToSlide, openSizeGuide, closeSizeGuide,
}                          from './b-modal-product.js';
import { renderSuggestions } from './b-modal-suggestions.js';
import { navigateModal }     from './b-modal-nav.js';

export {
  openModal, closeModal, modalGoBack, setupModal,
  buildCarouselSlides, goToSlide,
  renderSuggestions, setupImageZoneTouch, navigateModal,
  openSizeGuide, closeSizeGuide,
};
