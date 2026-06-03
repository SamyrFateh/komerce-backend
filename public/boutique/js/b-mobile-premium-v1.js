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
  if (_styleInjected || typeof document === 'undefined') return;
  _styleInjected = true;

  const style = document.createElement('style');
  style.id = 'k-mobile-premium-v1-style';
  style.textContent = `
@media (max-width: 899px) {
  /* Hero premium mobile (#k-hero-fixed-wrap, .k-hero-*, .k-hero-cats-sticky)
     → DÉPLACÉ vers hero.css (owner). Lot 2 / L2-S2. */

  /* Header/recherche premium mobile → DÉPLACÉ vers layout.css (owner). Lot 2/L2-S2.
     Catégories premium mobile → DÉPLACÉ vers categories.css. Lot 2/L2-S2.
     Catalogue/grille/cartes/fab premium mobile → DÉPLACÉ vers products.css. Lot 2/L2-S2.
     Le JS ne pose plus que la classe d'état html.k-mobile-premium-v1. */

  /* PDP mobile : assumer une vraie sheet tactile. */
  html.k-mobile-premium-v1 #k-modal .k-modal-scroll {
    background: linear-gradient(180deg, var(--sand) 0%, var(--white) 34%);
    padding-bottom: calc(172px + env(safe-area-inset-bottom));
  }

  html.k-mobile-premium-v1 #k-modal .k-modal-img-wrap {
    min-height: 46vh;
    max-height: 52vh;
    background: var(--sand);
  }

  html.k-mobile-premium-v1 #k-modal .k-modal-slide { object-fit: cover; }

  html.k-mobile-premium-v1 #k-modal .k-modal-details {
    margin-top: -28px;
    position: relative;
    z-index: 2;
    border-radius: 28px 28px 0 0;
    background: color-mix(in srgb, var(--white) 96%, transparent);
    box-shadow: 0 -14px 36px var(--border-text-08);
    overflow: hidden;
  }

  html.k-mobile-premium-v1 #k-modal .k-modal-info { padding: 24px 18px 12px; }

  html.k-mobile-premium-v1 #k-modal .k-modal-info::before {
    content: '';
    display: block;
    width: 44px;
    height: 5px;
    margin: -10px auto 16px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--text-muted) 28%, transparent);
  }

  html.k-mobile-premium-v1 #k-modal .k-modal-name-row {
    gap: 12px;
    align-items: flex-start;
  }

  html.k-mobile-premium-v1 #k-modal .k-modal-info h2 {
    font-family: var(--font-display, var(--font));
    font-size: clamp(28px, 8vw, 38px);
    line-height: 1.02;
    letter-spacing: -.035em;
    color: var(--text);
  }

  html.k-mobile-premium-v1 #k-modal .k-modal-fav-btn {
    width: 58px;
    height: 58px;
    flex: 0 0 auto;
    border-radius: 999px;
    box-shadow: 0 12px 28px var(--border-text-08);
  }

  html.k-mobile-premium-v1 #k-modal .k-modal-price-row { margin-top: 12px; }

  html.k-mobile-premium-v1 #k-modal .k-modal-price {
    font-size: clamp(42px, 12vw, 58px);
    line-height: .95;
    letter-spacing: -.045em;
  }

  html.k-mobile-premium-v1 #k-modal .k-modal-desc {
    margin-top: 10px;
    color: var(--text-muted);
    font-size: 13px;
    line-height: 1.45;
  }

  html.k-mobile-premium-v1 #k-modal .k-modal-actions {
    display: grid;
    grid-template-columns: minmax(106px, .8fr) minmax(0, 1.25fr);
    gap: 12px;
    padding: 14px 16px calc(16px + env(safe-area-inset-bottom));
    background: var(--white);
    border-top: 1px solid var(--border-text-06);
    box-shadow: 0 -18px 40px color-mix(in srgb, var(--text) 10%, transparent);
    isolation: isolate;
    z-index: 30;
  }

  html.k-mobile-premium-v1 #k-modal .k-modal-actions::before {
    content: '';
    position: absolute;
    inset: -22px 0 auto 0;
    height: 22px;
    pointer-events: none;
    background: linear-gradient(180deg, transparent 0%, var(--white) 100%);
  }

  html.k-mobile-premium-v1 #k-modal .k-modal-actions .k-qty,
  html.k-mobile-premium-v1 #k-modal .k-modal-actions .k-add-cart-btn,
  html.k-mobile-premium-v1 #k-modal .k-modal-actions .k-buy-now-btn {
    border-radius: 999px;
    min-height: 54px;
  }

  html.k-mobile-premium-v1 #k-modal .k-modal-actions .k-qty {
    grid-column: 1;
    grid-row: 1;
    background: var(--sand);
    box-shadow: inset 0 0 0 1px var(--border-text-06);
  }

  html.k-mobile-premium-v1 #k-modal .k-modal-actions .k-add-cart-btn {
    grid-column: 2;
    grid-row: 1;
    background: var(--white);
    font-size: 16px;
    font-weight: 850;
  }

  html.k-mobile-premium-v1 #k-modal .k-modal-actions .k-buy-now-btn {
    grid-column: 1 / -1;
    grid-row: 2;
    min-height: 62px;
    font-size: 20px;
    font-weight: 900;
    box-shadow: 0 14px 34px color-mix(in srgb, var(--ocean) 26%, transparent);
  }

  html.k-mobile-premium-v1 #k-modal .k-modal-suggestions {
    background: var(--sand);
    padding-top: 22px;
  }

  html.k-mobile-premium-v1 #k-modal .k-modal-suggestions h3 {
    font-family: var(--font-display, var(--font));
    font-size: 24px;
    letter-spacing: -.025em;
  }
}
`;

  document.head.appendChild(style);
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
