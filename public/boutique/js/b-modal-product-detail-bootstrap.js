/**
 * @komerce-arch
 * @role          product-detail-modal-orchestrator
 * @domain        catalog
 * @layer         ui-controller
 * @criticality   high
 * @inputs        modal_lifecycle, product_id, product_detail_v1, responsive_breakpoint, market_context
 * @outputs       shared_modal_selection_state, responsive_product_modal_render
 * @depends       b-bus.js, b-store.js, b-modal-mobile-product.js, b-modal-desktop-product.js, view-models/modal-selection-model.js, market-context.js
 * @used-by       main.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md, docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md, market_display_matches_buyer_price
 * @impact-areas  product-modal, mobile, desktop, product-detail, sku-selection, market-autonomy
 * @version       2026-09
 */

'use strict';

import { bus } from './b-bus.js';
import { state, dom } from './b-store.js';
import { createModalSelection } from './view-models/modal-selection-model.js';
import { isDesktop } from './b-scroll-owner.js';
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

function viewportMode() {
  return isDesktop() ? 'desktop' : 'mobile';
}

function currentProductId() {
  return state.modalProduct ? String(state.modalProduct.id) : null;
}

function currentMarketCode() {
  const api = typeof window !== 'undefined' ? window.KomerceMarket : null;
  if (!api) return null;
  return (api.getPreviewOverride && api.getPreviewOverride()) || api.DEFAULT || null;
}

function clearProductDetailState() {
  clearDesktopProductDetailState();
  clearMobileProductDetailState();
  state.modalDeliverySelection = { requested_transport_rail: null };
}

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

function renderDetailSkeleton() {
  const container = dom.modalVariants || document.getElementById('k-modal-variants');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'k-mdm-skeleton';
  el.setAttribute('aria-hidden', 'true');
  el.dataset.mdmSkeleton = '1';
  el.innerHTML =
    '<div class="k-mdm-skeleton-row k-mdm-skeleton-row--short"></div>' +
    '<div class="k-mdm-skeleton-row k-mdm-skeleton-row--chip"></div>' +
    '<div class="k-mdm-skeleton-row k-mdm-skeleton-row--full"></div>';
  container.innerHTML = '';
  container.appendChild(el);
}

function renderDetailUnavailable() {
  const container = dom.modalVariants || document.getElementById('k-modal-variants');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'k-mdm-detail-error';
  el.dataset.mdmDetailError = '1';
  el.textContent = 'Options et livraison indisponibles — vérifiez votre connexion.';
  container.innerHTML = '';
  container.appendChild(el);
}

function renderResponsiveProductDetail(detail, selection, forceMedia) {
  _viewportMode = viewportMode();
  if (_viewportMode === 'mobile') {
    renderMobileProductDetail(detail, selection, { forceMedia });
  } else {
    renderDesktopProductDetail(detail, selection, { forceMedia });
  }
  bus.emit('modal:detail-ready');
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
  bus.emit('modal:composition-synced');
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
  lockTransactionalPath();
  renderDetailSkeleton();

  try {
    const marketCode = currentMarketCode();
    const marketQuery = marketCode ? `?market=${encodeURIComponent(marketCode)}` : '';
    const response = await fetch(`/api/products/${productId}/detail${marketQuery}`, {
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
  } catch (error) {
    if (generation === _generation && state.modalOpen && currentProductId() === productId) {
      clearLegacyVariantsPaint();
      renderDetailUnavailable();
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

  if (state.modalOpen && state.modalProduct && !state.modalProductDetail) {
    loadProductDetail(state.modalProduct);
  }

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