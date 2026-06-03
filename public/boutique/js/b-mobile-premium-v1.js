/**
 * @module b-mobile-premium-v1
 * @brief Couche premium mobile pour l'accueil et la PDP Komerce.
 *
 * Objectif : rendre le mobile plus fluide et tactile sans dériver du desktop.
 * V1 volontairement additive : CSS mobile-only + garde quantité d'intention à 1.
 */

import { bus } from './b-bus.js';
import { state } from './b-store.js';
import { fmtPrice } from './b-utils.js';
import { isDesktop } from './b-scroll-owner.js';

'use strict';

let _installed = false;
let _styleInjected = false;
let _qtyGuardInstalled = false;

function isMobile() {
  return !isDesktop();
}

function injectStyles() {
  // Lot 2 / L2-S2 — TOUT le CSS premium mobile a été rapatrié dans les owners :
  //   hero → hero.css · header/search → layout.css · catégories/sous-cat → categories.css
  //   grille/cartes/fab → products.css · modale produit → modal-product.css
  // Le JS ne possède plus aucun style. Cette fonction est conservée en no-op pour
  // ne pas casser ses appelants ; la seule responsabilité restante de ce module est
  // de poser la classe d'état html.k-mobile-premium-v1 (voir plus bas dans le boot).
  return;
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

function applyMobilePremium() {
  if (!isMobile()) return;
  syncMobileIntentQty();
}

export function setupMobilePremiumV1() {
  if (_installed) return;
  _installed = true;
  injectStyles();
  installQtyGuard();

  if (typeof document !== 'undefined') {
    document.documentElement.classList.add('k-mobile-premium-v1');
  }

  bus.on('modal:opened', function() {
    if (!isMobile()) return;
    // Deux frames : attendre que b-modal ait injecté/réconcilié la fiche
    // et que les handlers historiques aient synchronisé le stepper.
    requestAnimationFrame(function() {
      requestAnimationFrame(applyMobilePremium);
    });
  });
}
