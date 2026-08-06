/**
 * @komerce-arch-lite
 * @role          catalog-b-product-open-contract
 * @domain        catalog
 * @layer         ui-component
 * @owner         public/boutique/js/b-modal-core.js
 * @purpose       supports public/boutique/js/b-modal-core.js
 * @impact-areas  catalog, product-discovery
 * @version       2026-06
 */
'use strict';

/**
 * @module b-product-open-contract
 * @brief Contrat unique d'ouverture produit depuis les surfaces panier.
 *
 * Objectif : éviter les rustines dispersées du type closeCart()+bus.emit()
 * dans chaque rendu panier. Ce module centralise :
 *   - résolution produit robuste number/string,
 *   - fermeture sûre des surfaces panier,
 *   - ouverture de la fiche produit via l'API modal réelle,
 *   - délégation image-only pour tiroir mobile + side-cart desktop.
 */

import { bus }       from './b-bus.js';
import { state }     from './b-store.js';
import { openModal } from './b-modal.js';

let _installed = false;

function _sameId(a, b) {
  return String(a) === String(b);
}

function _findProductById(productId) {
  const sid = String(productId);
  return state.products.find(p => String(p.id) === sid) || null;
}

function _isInteractiveCartControl(target) {
  return Boolean(target.closest([
    '.k-qty-btn',
    '.k-cart-item-remove',
    '.k-cart-event-btn',
    '.k-cart-checkout',
    '#k-cart-checkout',
    '.k-side-cart-remove',
    '.k-side-cart-qty',
    '.k-side-cart-action',
    '.k-side-cart-checkout',
    '.k-sc-btn-checkout',
    '.k-sc-btn-group',
    '.k-sc-btn-cart',
    '.k-sc-remove',
    '.k-sc-qty',
    '.k-sc-action',
    '[data-cart-action]',
    '[data-no-product-open]',
    'button',
    'select',
    'input',
    'textarea'
  ].join(',')));
}

function _closeCartSurfaces() {
  document.getElementById('k-cart-overlay')?.classList.remove('open');
  document.getElementById('k-cart-drawer')?.classList.remove('open');
  document.body.classList.remove('cart-open', 'cart-empty');

  // Desktop : le side-cart est inline/sticky. On ne le détruit pas ; on retire
  // seulement les états transitoires pour que la modal prenne la main proprement.
  const sideCart = document.getElementById('k-side-cart');
  if (sideCart) {
    sideCart.classList.remove('is-attention');
  }
}

export function openProductFromCart(productId) {
  const product = _findProductById(productId);

  if (!product) {
    console.warn('[cart→modal] Produit introuvable depuis le panier:', productId);
    return false;
  }

  _closeCartSurfaces();

  requestAnimationFrame(() => {
    // Important : on passe l'id original du produit, pas String(id), car
    // openModal compare encore certains chemins en strict equality.
    openModal(product.id, false);
  });

  return true;
}

function _extractProductIdFromCartImageClick(target) {
  // Règle UX : seule l'image produit du panier ouvre la fiche produit.
  // Le nom reste texte simple pour éviter les ouvertures accidentelles près des
  // steppers, prix, suppression ou CTA.

  const drawerImg = target.closest('.k-cart-item-img');
  if (drawerImg) {
    const drawerItem = drawerImg.closest('.k-cart-item[data-pid], [data-open-product]');
    if (drawerItem) {
      return drawerItem.dataset.openProduct || drawerItem.dataset.pid || null;
    }
  }

  const sideImg = target.closest([
    '#k-side-cart .k-cart-item-img',
    '#k-side-cart .k-side-cart-item-img',
    '#k-side-cart .k-side-item-img',
    '#k-side-cart .k-cart-product-thumb',
    '#k-side-cart .k-sc-item-img',
    '#k-side-cart .k-sc-item-image',
    '#k-side-cart .k-sc-product-img',
    '#k-side-cart .k-sc-product-image',
    '#k-side-cart .k-sc-thumb',
    '#k-side-cart .k-sc-media',
    '#k-side-cart [data-open-product-img]'
  ].join(','));

  if (sideImg) {
    const sideItem = sideImg.closest('[data-open-product], [data-pid], [data-product-id], .k-sc-item');
    if (sideItem) {
      return sideItem.dataset.openProduct || sideItem.dataset.pid || sideItem.dataset.productId || null;
    }
  }

  // Défense en profondeur : certains rendus side-cart peuvent ne pas avoir une
  // classe image dédiée, mais placer directement un <img> dans .k-sc-item.
  const sideRawImg = target.closest('#k-side-cart .k-sc-item img');
  if (sideRawImg) {
    const item = sideRawImg.closest('.k-sc-item[data-product-id], .k-sc-item[data-pid], .k-sc-item[data-open-product]');
    if (item) return item.dataset.productId || item.dataset.pid || item.dataset.openProduct || null;
  }

  return null;
}

function _onDocumentClick(e) {
  const productId = _extractProductIdFromCartImageClick(e.target);
  if (productId == null) return;

  if (_isInteractiveCartControl(e.target)) return;

  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation?.();

  openProductFromCart(productId);
}

function _installBusSafetyNet() {
  // Sécurité : si une ancienne surface émet encore modal:open avec un id numérique,
  // on laisse d'abord le listener historique tenter sa chance, puis on corrige si
  // la modal n'a pas réellement changé de produit.
  bus.on('modal:open', function(payload) {
    if (!payload || payload.id == null) return;

    const wanted = String(payload.id);

    requestAnimationFrame(() => {
      if (state.modalProduct && _sameId(state.modalProduct.id, wanted)) return;

      const product = _findProductById(payload.id);
      if (!product) return;

      openModal(product.id, false);
    });
  });
}

export function setupProductOpenContract() {
  if (_installed) return;
  _installed = true;

  document.addEventListener('click', _onDocumentClick, true);
  _installBusSafetyNet();

  // ARCH-1, listener bus product:open-from-cart retiré (2026-08) : aucun
  // appelant réel ne l'a jamais déclenché — le chemin "ouvrir la fiche
  // depuis le panier" passe en pratique par le click-delegation DOM direct
  // ci-dessus (_onDocumentClick -> openProductFromCart(), même fichier).
  // Démasqué comme orphelin réel après correction du scanner boutique:360
  // (le commentaire précédent citait la syntaxe d'appel du bus, ce qui le
  // faisait passer pour un émetteur existant, cf. faux positif
  // nav:goto-group, même session).
}
