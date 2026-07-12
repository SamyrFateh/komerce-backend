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
let _variantGuard = null;
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

function expectedRootSelector() {
  return isMobileViewport() ? '[data-pdc4-root]' : '[data-pdc5-root]';
}

function disconnectVariantGuard() {
  if (_variantGuard) _variantGuard.disconnect();
  _variantGuard = null;
}

function clearProductDetailState() {
  clearDesktopProductDetailState();
  clearMobileProductDetailState();
}

function renderResponsiveProductDetail(detail, selection, forceMedia) {
  _viewportMode = viewportMode();
  if (_viewportMode === 'mobile') {
    renderMobileProductDetail(detail, selection, { forceMedia });
  } else {
    renderDesktopProductDetail(detail, selection, { forceMedia });
  }
}

/**
 * Transition PDC-4/PDC-5 : le fetch legacy de b-modal-core.js peut encore
 * repeindre #k-modal-variants après le contrat détail. Le guard rétablit la
 * composition responsive depuis l'état PDC-3 ; il ne calcule aucune vérité.
 * PDC-6 supprime le fetch legacy et ce guard avec lui.
 */
function installVariantGuard(detail) {
  disconnectVariantGuard();
  const container = dom.modalVariants || document.getElementById('k-modal-variants');
  if (!container || typeof MutationObserver === 'undefined') return;

  _variantGuard = new MutationObserver(() => {
    if (!state.modalOpen) return;
    if (currentProductId() !== String(detail.product.id)) return;
    if (!state.modalSelection || !state.modalProductDetail) return;
    if (container.querySelector(expectedRootSelector())) return;

    renderResponsiveProductDetail(detail, state.modalSelection, false);
  });

  _variantGuard.observe(container, { childList: true, subtree: true });
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
  installVariantGuard(state.modalProductDetail);
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
  disconnectVariantGuard();
  _viewportMode = null;

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
    renderResponsiveProductDetail(detail, selection, true);
    installVariantGuard(detail);
  } catch (error) {
    // Transition PDC : le chemin legacy reste visible si le nouveau contrat est
    // indisponible. PDC-6 retirera ce fallback avec l'ancien fetch modal.
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
    disconnectVariantGuard();
    _viewportMode = null;
    clearProductDetailState();
  });

  window.addEventListener('resize', onViewportResize, { passive: true });
}

export const _productDetailBootstrapTestApi = Object.freeze({
  renderResponsiveProductDetail,
  expectedRootSelector,
  syncResponsiveComposition,
});
