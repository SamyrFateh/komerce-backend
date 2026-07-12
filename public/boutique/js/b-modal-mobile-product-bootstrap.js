/**
 * @komerce-arch
 * @role          mobile-product-detail-orchestrator
 * @domain        catalog
 * @layer         ui-controller
 * @criticality   high
 * @inputs        modal_lifecycle, product_id, product_detail_v1
 * @outputs       mobile_product_detail_state, mobile_product_modal_render
 * @depends       b-bus.js, b-store.js, b-modal-mobile-product.js, view-models/modal-selection-model.js
 * @used-by       main.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md, docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md
 * @impact-areas  product-modal, mobile, product-detail, sku-selection
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

let _installed = false;
let _generation = 0;
let _variantGuard = null;

function isMobileViewport() {
  return window.matchMedia('(max-width: 899px)').matches;
}

function currentProductId() {
  return state.modalProduct ? String(state.modalProduct.id) : null;
}

function disconnectVariantGuard() {
  if (_variantGuard) _variantGuard.disconnect();
  _variantGuard = null;
}

/**
 * Transition PDC-4 : le vieux fetch /api/products/:id existe encore dans
 * b-modal-core.js jusqu'à PDC-6. S'il termine APRES le nouveau contrat détail,
 * il peut tenter de repeindre #k-modal-variants avec le modèle à deux axes.
 *
 * Le guard ne calcule aucune disponibilité : il rétablit simplement le rendu
 * PDC-4 depuis l'état unique si le root PDC-4 a été remplacé. Il disparaîtra
 * avec le fetch legacy en PDC-6.
 */
function installVariantGuard(detail) {
  disconnectVariantGuard();
  const container = dom.modalVariants || document.getElementById('k-modal-variants');
  if (!container || typeof MutationObserver === 'undefined') return;

  _variantGuard = new MutationObserver(() => {
    if (!state.modalOpen || !isMobileViewport()) return;
    if (currentProductId() !== String(detail.product.id)) return;
    if (!state.modalSelection || !state.modalProductDetail) return;
    if (container.querySelector('[data-pdc4-root]')) return;

    renderMobileProductDetail(detail, state.modalSelection, { forceMedia: false });
  });

  _variantGuard.observe(container, { childList: true, subtree: true });
}

async function loadMobileProductDetail(product) {
  if (!product || !isMobileViewport()) return;

  const productId = String(product.id);
  const generation = ++_generation;
  clearMobileProductDetailState();
  disconnectVariantGuard();

  try {
    const response = await fetch(`/api/products/${productId}/detail`, {
      credentials: 'include',
    });
    if (!response.ok) {
      throw new Error(`Product detail HTTP ${response.status}`);
    }

    const detail = await response.json();
    if (generation !== _generation) return;
    if (!state.modalOpen || !isMobileViewport()) return;
    if (currentProductId() !== productId) return;

    const selection = createModalSelection(detail);
    renderMobileProductDetail(detail, selection, { forceMedia: true });
    installVariantGuard(detail);
  } catch (error) {
    // Compatibilité de transition : PDC-4 ne détruit pas la fiche legacy si le
    // nouveau contrat est momentanément indisponible. Il n'invente rien non plus.
    // PDC-6 supprimera ce fallback quand le contrat détail sera l'unique chemin.
    console.warn('[PDC-4] détail produit mobile indisponible:', error?.message || error);
  }
}

export function setupMobileProductDetail() {
  if (_installed) return;
  _installed = true;

  bus.on('modal:opened', (product) => {
    loadMobileProductDetail(product);
  });

  bus.on('modal:closed', () => {
    _generation += 1;
    disconnectVariantGuard();
    clearMobileProductDetailState();
  });
}
