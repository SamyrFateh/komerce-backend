/**
 * @komerce-arch-lite
 * @role          boutique-b-modal
 * @domain        boutique
 * @layer         ui-component
 * @owner         public/boutique/js/b-modal-core.js
 * @purpose       supports public/boutique/js/b-modal-core.js
 * @impact-areas  boutique
 * @version       2026-07
 */
'use strict';

/**
 * b-modal.js — Façade.
 *
 * La surface publique reste inchangée. PDC-4 charge l'adaptateur mobile détail
 * comme side-effect : il écoute `modal:opened`/`modal:closed` sans devenir un
 * second owner du lifecycle, qui reste dans b-modal-core.js.
 */

import './b-modal-product-detail-mobile.js';

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
