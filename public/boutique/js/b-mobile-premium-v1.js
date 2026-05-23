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
  html.k-mobile-premium-v1 #k-hero-fixed-wrap {
    background:
      radial-gradient(circle at 16% 0%, color-mix(in srgb, var(--ocean-bg-08) 68%, transparent), transparent 26%),
      var(--sand-warm);
  }

  html.k-mobile-premium-v1 .k-header-inner {
    gap: 8px;
    padding-inline: 10px;
  }

  html.k-mobile-premium-v1 .k-search {
    min-height: 42px;
    border-radius: 999px;
    box-shadow: 0 10px 22px var(--border-text-06);
  }

  html.k-mobile-premium-v1 .k-search input { font-size: 14px; }

  html.k-mobile-premium-v1 .k-hero-inner { padding: 0 10px; }

  html.k-mobile-premium-v1 .k-hero-media {
    border-radius: 22px;
    height: 118px;
    max-height: 118px;
    overflow: hidden;
    box-shadow: 0 10px 24px var(--border-text-06);
  }

  html.k-mobile-premium-v1 .k-hero-img {
    height: 118px;
    object-fit: cover;
    object-position: center;
  }

  /* Slogan overlay : visible mais discret. Plus de scale (qui floutait le texte).
     On garde le badge "La boutique comorienne" + le slogan court (ligne 1/2),
     dans le coin gauche, sur fond image. */
  html.k-mobile-premium-v1 .k-hero-mini-slogan--premium {
    padding: 10px 12px 0;
    align-items: flex-start;
    text-align: left;
  }

  html.k-mobile-premium-v1 .k-hero-mini-slogan--premium .k-hero-badge {
    display: inline-block;
    padding: 4px 10px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--white) 88%, transparent);
    color: var(--text);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .04em;
    text-transform: uppercase;
    box-shadow: 0 2px 6px var(--border-text-08);
    margin-bottom: 6px;
  }

  html.k-mobile-premium-v1 .k-hero-mini-slogan--premium .k-line-1,
  html.k-mobile-premium-v1 .k-hero-mini-slogan--premium .k-line-2 {
    text-align: left;
    font-size: 18px;
    line-height: 1.05;
  }

  /* On masque toujours les CTAs / trust / pills / overlay desktop sur mobile.
     Le hero reste un overlay d'identité, pas un bloc d'action. */
  html.k-mobile-premium-v1 .k-hero-cta-row,
  html.k-mobile-premium-v1 .k-hero-trust,
  html.k-mobile-premium-v1 .k-hero-bubble,
  html.k-mobile-premium-v1 .k-hero-sub,
  html.k-mobile-premium-v1 .k-hero-overlay {
    display: none !important;
  }

  html.k-mobile-premium-v1 .k-hero-cats-sticky { padding-top: 6px; }
  html.k-mobile-premium-v1 .k-cats-shell { padding: 0 10px 8px; }

  /* V3 catégories mobile : UNE seule rangée scrollable horizontalement.
     Affordance "il y a plus à droite" + gain hauteur ≈ 100px vs grid 4×2.
     Les fades gauche/droite déjà présents dans le DOM (.k-cats-wrap-fade-*)
     prennent le relais visuel. */
  html.k-mobile-premium-v1 .k-cats {
    display: flex !important;
    flex-direction: row;
    flex-wrap: nowrap;
    overflow-x: auto;
    overflow-y: hidden;
    gap: 10px;
    padding: 6px 12px 10px;
    scroll-snap-type: x proximity;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }

  html.k-mobile-premium-v1 .k-cats::-webkit-scrollbar { display: none; }

  html.k-mobile-premium-v1 .k-chip,
  html.k-mobile-premium-v1 .k-chip.is-active,
  html.k-mobile-premium-v1 .k-chip.active {
    flex: 0 0 auto !important;
    width: 64px !important;
    min-width: 64px !important;
    max-width: 64px !important;
    height: 84px !important;
    min-height: 84px !important;
    padding: 6px 4px 6px !important;
    border-radius: 16px !important;
    display: flex !important;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: 5px;
    background: color-mix(in srgb, var(--white) 86%, transparent);
    box-shadow: 0 6px 14px var(--border-text-06);
    scroll-snap-align: start;
  }

  html.k-mobile-premium-v1 .k-chip-photo {
    width: 44px !important;
    height: 44px !important;
    flex: 0 0 44px;
    border-radius: 12px;
    object-fit: cover;
    object-position: center;
  }

  html.k-mobile-premium-v1 .k-chip-label {
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    white-space: normal;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    line-height: 1.15;
    font-size: 10.5px;
    font-weight: 800;
    text-align: center;
  }

  /* Petits écrans : chips encore un peu plus serrées pour qu'on en voie 5 d'un coup. */
  @media (max-width: 360px) {
    html.k-mobile-premium-v1 .k-chip,
    html.k-mobile-premium-v1 .k-chip.active {
      width: 60px !important;
      min-width: 60px !important;
      max-width: 60px !important;
    }
  }

  html.k-mobile-premium-v1 #k-subcats-wrap { margin-top: -4px; }
  html.k-mobile-premium-v1 .k-proverb-sep { display: none; }
  html.k-mobile-premium-v1 #k-catalog-section { padding-top: 6px; }

  html.k-mobile-premium-v1 .k-section-title,
  html.k-mobile-premium-v1 .k-cat-title { margin-top: 8px; }

  html.k-mobile-premium-v1 .k-grid {
    gap: 14px;
    padding-inline: 12px;
  }

  html.k-mobile-premium-v1 .k-card {
    border-radius: 22px;
    overflow: hidden;
    box-shadow: 0 12px 30px var(--border-text-06);
  }

  html.k-mobile-premium-v1 .k-card-title {
    font-size: 16px;
    line-height: 1.15;
  }

  html.k-mobile-premium-v1 .k-card-desc {
    font-size: 12px;
    line-height: 1.25;
    max-height: 2.5em;
    overflow: hidden;
  }

  html.k-mobile-premium-v1 .k-card-price {
    font-size: 22px;
    letter-spacing: -.035em;
  }

  html.k-mobile-premium-v1 .k-wa-fab {
    width: 50px;
    height: 50px;
    right: 16px;
    bottom: 98px;
    box-shadow: 0 12px 30px color-mix(in srgb, #25D366 28%, transparent);
  }

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
