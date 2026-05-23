/**
 * @module b-mobile-modal-v1
 * @brief Couche mobile-only pour réaligner la PDP / modal Komerce.
 *
 * Périmètre strict : uniquement #k-modal sur mobile.
 * Ne touche pas au hero, aux catégories, aux cartes catalogue ou au desktop.
 *
 * NOTE — Mai 2026 — CSS neutralisé après régression visuelle :
 * Le CSS injecté par `injectStyles()` imposait un design "premium" (H2 titre
 * à clamp(28px, 8vw, 38px), prix à clamp(42px, 12vw, 58px), barre actions
 * avec z-index: 2147483000 !important) qui a introduit 3 régressions vs
 * GEL v1.0 documenté dans MODAL_MOBILE_ARCHITECTURE.md :
 *   1. Titre produit débordant hors viewport sur noms longs
 *   2. Badges promo des suggestions s'affichant sur le bouton Acheter
 *   3. Badges promo dépassant sous la barre actions
 * Le CSS du module est désactivé. Le JS utile reste actif :
 *   - syncMobileIntentQty() : synchro qty modal ↔ panier
 *   - installQtyGuard()     : empêche qty de descendre sous 1
 */

import { bus } from './b-bus.js';
import { state } from './b-store.js';
import { fmtPrice } from './b-utils.js';
import { isDesktop } from './b-scroll-owner.js';

'use strict';

let _installed = false;
let _qtyGuardInstalled = false;

function isMobile() {
  return !isDesktop();
}

function clearNode(node) {
  if (!node) return;
  while (node.firstChild) node.removeChild(node.firstChild);
}

function syncMobileIntentQty() {
  if (!isMobile() || !state.modalProduct) return;

  const item = (state.cart || []).find(function(i) {
    return String((i.product && i.product.id) || i.id) === String(state.modalProduct.id);
  });

  const intendedQty = item ? Math.max(1, Number(item.qty || 1)) : 1;
  state.modalQty = intendedQty;

  const qtyVal = document.getElementById('k-qty-val');
  if (qtyVal) qtyVal.textContent = String(intendedQty);

  const addBtn = document.getElementById('k-add-cart-btn');
  if (addBtn && !item) {
    addBtn.classList.remove('in-cart');
    clearNode(addBtn);
    const img = document.createElement('img');
    img.src = '/images/panier_tresse_vert.png';
    img.width = 20;
    img.height = 20;
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    img.style.pointerEvents = 'none';
    img.style.flexShrink = '0';
    addBtn.append(img, document.createTextNode('Ajouter au panier'));
  }

  const buyBtn = document.getElementById('k-buy-now-btn');
  if (buyBtn && state.modalProduct.price_kmf) {
    buyBtn.setAttribute('aria-label', 'Acheter maintenant — ' + fmtPrice(state.modalProduct.price_kmf * intendedQty));
  }
}

function installQtyGuard() {
  if (_qtyGuardInstalled || typeof document === 'undefined') return;
  _qtyGuardInstalled = true;

  document.addEventListener('click', function(e) {
    const minus = e.target && e.target.closest ? e.target.closest('#k-qty-minus') : null;
    if (!minus || !isMobile() || !state.modalProduct) return;

    const current = Number(state.modalQty || 0);
    if (current <= 1) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      state.modalQty = 1;
      const qtyVal = document.getElementById('k-qty-val');
      if (qtyVal) qtyVal.textContent = '1';
    }
  }, true);
}

function applyMobileModal() {
  if (!isMobile()) return;
  syncMobileIntentQty();
}

export function setupMobileModalV1() {
  if (_installed) return;
  _installed = true;
  installQtyGuard();

  bus.on('modal:opened', function() {
    if (!isMobile()) return;
    requestAnimationFrame(function() {
      requestAnimationFrame(applyMobileModal);
    });
  });
}
