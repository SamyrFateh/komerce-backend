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

// §4 — Unification viewport sur isDesktop() (b-scroll-owner.js, innerWidth>=900).
// Remplace matchMedia('max-width:899px') qui créait un self-abort [899,900)
// et obligeait les tests à mocker window.matchMedia.
function viewportMode() {
  return isDesktop() ? 'desktop' : 'mobile';
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

// MDM-8 phase 2 : entre le paint legacy (openModal) et la résolution du
// fetch /detail, #k-modal-variants restait vide — indiscernable d'une
// modale cassée à l'œil (audit MDM8_AUDIT_PHASE1.md §1.3). Un skeleton
// comble cette fenêtre ; renderResponsiveProductDetail() l'efface déjà
// via son propre container.innerHTML = '' en cas de succès.
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

// Échec du fetch /detail (réseau lent/coupure) : le chemin transactionnel
// reste verrouillé (fail-closed volontaire, PDC-6, non modifié ici) mais
// l'utilisateur voit désormais un état explicite plutôt qu'un vide silencieux.
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

  // Le renderer termine son paint avant de publier la disponibilité du contrat.
  // Le module panier reste propriétaire de sa projection UI et écoute ce signal.
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

  // MDP-3 : le cœur PDC vient d'être re-rendu pour le nouveau viewport, mais
  // les enrichissements périphériques (placement des actions desktop, entrée
  // paiement) ont leur propre cycle de vie (b-modal-approche-c-hybrid.js,
  // b-modal-desktop-enhancers.js) qui n'écoute que modal:opened/modal:closed.
  // Sans ce signal, un resize en cours de session laissait ces enrichissements
  // non réconciliés (D3). Émis une seule fois par transition de viewport —
  // jamais en boucle — donc idempotent pour des resizes successifs.
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

  // Verrouillage AVANT le fetch : tant que le contrat détail n'a pas résolu
  // avec succès, aucune mutation panier SKU n'est permise.
  lockTransactionalPath();
  renderDetailSkeleton();

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

  /* Garde late-install : si la modale est déjà ouverte au moment où ce module
     se charge (race condition en chargement lazy — les 50+ modules JS + images
     d'un produit SKU saturent le serveur de dev mono-thread ; modal:opened a
     déjà ete emis avant que ce handler soit enregistre), on rejoue loadProductDetail
     sur le produit courant. En production (CDN, modules en cache) ce chemin n'est
     jamais emprunte — les modules chargent en < 200ms, bien avant tout clic humain. */
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