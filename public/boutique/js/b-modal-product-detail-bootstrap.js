/**
 * @komerce-arch
 * @role          product-detail-modal-orchestrator
 * @domain        catalog
 * @layer         ui-controller
 * @criticality   high
 * @inputs        modal_lifecycle, product_id, product_detail_v1, responsive_breakpoint
 * @outputs       shared_modal_selection_state, responsive_product_modal_render
 * @depends       b-bus.js, b-store.js, b-modal-mobile-product.js, b-modal-desktop-product.js, view-models/modal-selection-model.js
 * @used-by       main.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md, docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md
 * @impact-areas  product-modal, mobile, desktop, product-detail, sku-selection
 * @version       2026-07
 */

'use strict';

import { bus } from './b-bus.js';
import { state, dom } from './b-store.js';
import { createModalSelection } from './view-models/modal-selection-model.js';
import {
  clearMobileProductDetailState,
  renderMobileProductDetail,
} from './b-modal-mobile-product.js';
import {
  clearDesktopProductDetailState,
  renderDesktopProductDetail,
} from './b-modal-desktop-product.js';

let _installed = false;
let _generation = 0;
let _viewportMode = null;
let _resizeTimer = null;

function isMobileViewport() {
  return window.matchMedia('(max-width: 899px)').matches;
}

function viewportMode() {
  return isMobileViewport() ? 'mobile' : 'desktop';
}

function currentProductId() {
  return state.modalProduct ? String(state.modalProduct.id) : null;
}

function clearProductDetailState() {
  clearDesktopProductDetailState();
  clearMobileProductDetailState();
}

// PDC-6 : le chemin transactionnel (ajout panier, achat direct, stepper) ne
// doit jamais rester actif sur la seule foi du paint legacy produit liste.
// Il est donc verrouillé avant même de tenter le fetch /detail, et seul le
// renderer PDC (renderActions, sur la base du contrat reçu) est habilité à
// le déverrouiller en cas de succès.
function transactionalControls() {
  const buyNow = document.getElementById('k-buy-now-btn');
  return [dom.addCartBtn, buyNow, dom.qtyMinus, dom.qtyPlus].filter(Boolean);
}

function lockTransactionalPath() {
  transactionalControls().forEach((control) => { control.disabled = true; });
}

function clearLegacyVariantsPaint() {
  const container = dom.modalVariants || document.getElementById('k-modal-variants');
  if (container) container.innerHTML = '';
}

function renderResponsiveProductDetail(detail, selection, forceMedia) {
  _viewportMode = viewportMode();
  if (_viewportMode === 'mobile') {
    renderMobileProductDetail(detail, selection, { forceMedia });
  } else {
    renderDesktopProductDetail(detail, selection, { forceMedia });
  }
}

function syncResponsiveComposition() {
  if (!state.modalOpen || !state.modalProductDetail || !state.modalSelection) return;
  const nextMode = viewportMode();
  if (nextMode === _viewportMode) return;

  renderResponsiveProductDetail(
    state.modalProductDetail,
    state.modalSelection,
    false
  );
}

function onViewportResize() {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(syncResponsiveComposition, 120);
}

async function loadProductDetail(product) {
  if (!product) return;

  const productId = String(product.id);
  const generation = ++_generation;
  clearProductDetailState();
  _viewportMode = null;

  // Verrouillage AVANT le fetch : tant que le contrat détail n'a pas résolu
  // avec succès, aucune mutation panier SKU n'est permise.
  lockTransactionalPath();

  try {
    const response = await fetch(`/api/products/${productId}/detail`, {
      credentials: 'include',
    });
    if (!response.ok) {
      throw new Error(`Product detail HTTP ${response.status}`);
    }

    const detail = await response.json();
    if (generation !== _generation) return;
    if (!state.modalOpen) return;
    if (currentProductId() !== productId) return;

    const selection = createModalSelection(detail);
    state.modalProductDetail = detail;
    state.modalSelection = selection;
    // Succès : c'est désormais le renderer PDC (renderActions, à partir du
    // contrat détail) qui décide de l'état des CTA — jamais le paint legacy.
    renderResponsiveProductDetail(detail, selection, true);
  } catch (error) {
    // Échec : fail closed. Le contrat détail n'a pas pu être vérifié, donc
    // aucune mutation panier SKU ne doit rester possible : on purge le paint
    // legacy (#k-modal-variants) au lieu de le laisser en place, et le
    // chemin transactionnel reste verrouillé (jamais déverrouillé ici).
    if (generation === _generation && state.modalOpen && currentProductId() === productId) {
      clearLegacyVariantsPaint();
      lockTransactionalPath();
    }
    console.warn('[Product Detail] contrat modal indisponible:', error?.message || error);
  }
}

export function setupProductDetailModal() {
  if (_installed) return;
  _installed = true;

  bus.on('modal:opened', (product) => {
    loadProductDetail(product);
  });

  bus.on('modal:closed', () => {
    _generation += 1;
    clearTimeout(_resizeTimer);
    _viewportMode = null;
    clearProductDetailState();
  });

  window.addEventListener('resize', onViewportResize, { passive: true });
}

export const _productDetailBootstrapTestApi = Object.freeze({
  renderResponsiveProductDetail,
  syncResponsiveComposition,
});
