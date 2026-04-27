/**
 * @module boutique
 * @brief Komerce boutique — migration ES modules (Option C)
 *
 * Phase 3 : §3 TOAST & CART CORE → b-cart-core.js ✅
 *
 * §1  UTILS        → b-utils.js      ✅
 * §2  STATE & DOM  → b-store.js      ✅
 * §3  CART CORE    → b-cart-core.js  ✅
 * §4  CATALOG      ← ici (futur b-catalog.js)
 * §5  FLAT SUBCAT  (futur b-subcat.js)
 * §6  GRID SECTIONS
 * §7  CART INTERACTIONS
 * §8  CATS & SEARCH
 * §9  MODAL
 * §10 CART PANEL & SHARE
 * §11 CHECKOUT
 * §12 VIEWS
 * §13 INIT
 * §14 STEPPER
 * §15 PAGER TEMU
 */

import { bus }           from './b-bus.js';
import {
  state, SUBCATS, dom, initDom, updateMobileScrollTop,
  $, $$, CART_VERSION, PAGE_SIZE,
}                         from './b-store.js';
import {
  optimizeImgUrl, sanitize, promoImgUrl, renderProductCarousel,
  bindCarouselDots, detectCurrency, fmt, fmtPrice,
  productEmoji, genIdempotencyKey, _currency, _rates,
}                         from './b-utils.js';
import {
  showToast, cartQty, cartTotal, saveCart, updateCartBadge,
  isFav, saveFavs,
}                         from './b-cart-core.js';
import {
  renderPromos, renderGrid, renderSection,
  initCats, initSearch,
}                         from './b-catalog.js';
import {
  initFlatSubcat, renderSubcatChips,
}                         from './b-subcat.js';
import {
  openModal, closeModal, modalGoBack,
}                         from './b-modal.js';
import {
  addToCart, openCart, closeCart, renderCart,
  shareCartWhatsApp, showShareChoiceModal,
  renderStepper,
}                         from './b-cart.js';
import {
  closeOrderModal,
  renderCheckout,
  updatePaymentUI,
  makeInput,
  makeIntlPhoneInput,
  digitsOnly,
  normalizeLocal,
  prettifyLocal,
  buildE164,
  currentCountry,
  sync,
  makePhoneInput,
  checkWalletBalance,
  updateWalletDisplay,
  submitOrder,
  renderOrderSuccess,
}                         from './b-checkout.js';
import {
  setupDrawer,
  setupInfiniteScroll,
  renderFavView,
  updateFavPromoBadge,
  shareWishlistWhatsApp,
  buildTimeline,
  renderOrdersHistory,
  renderOrderDetail,
  renderTrackView,
  renderMyOrdersList,
  getStatusDisplay,
  formatOrderDate,
  renderTrackViewSearchMode,
  switchView,
  setupBnav,
  setupSeeAll,
  loadRelais,
}                         from './b-views.js';
import {
  _setupMobilePager,
  _setupSectionAutoAdvance,
  _setupHorizontalWrap,
  _syncChipToScroll,
  _onPagerScroll,
}                         from './b-pager.js';


'use strict';

// ── CONSTANTES KOMERCE ──────────────────────────────────
const KOMERCE_WA = '33699272526';
const KOMERCE_WA_URL = 'https://wa.me/' + KOMERCE_WA;

/* ═══════════════════════════════════════════════════════════
   KOMERCE — Boutique JS v2.0 "Archipel"
   Full cart/checkout mechanism ported from original
   Depends on: komerce-api.js (K global), Stripe (optional)
   ═══════════════════════════════════════════════════════════ */

  // Numéro WhatsApp de contact Komerce (format international sans +)


  // ╔══════════════════════════════════════════════════════════════════╗
  // ║  §13 · INIT — Boot sequence, bnav, seeAll                        ║
  // ╚══════════════════════════════════════════════════════════════════╝
  //  → Reste dans boutique.js (orchestrateur)

  /**
   * Point d'entrée principal — initialise l'application Komerce boutique.
   * Charge les produits, configure les vues, branche tous les listeners.
   * Appelée une seule fois au DOMContentLoaded.
   */
  function init() {
    updateCartBadge();
    // Expose renderGrid sur window pour le listener délégué global (flat subcat)
    if (typeof window !== 'undefined') window.renderGrid = renderGrid;
    setupCats();
    setupCatSwipeNav();

    /* ── Card mini-tabs (Shein-style, event delegation) ── */
    document.addEventListener('click', function(e) {
      var tab = e.target.closest('.k-card-tab');
      if (!tab) return;
      e.stopPropagation(); // don't open modal
      var card = tab.closest('.k-card');
      if (!card) return;
      card.querySelectorAll('.k-card-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      card.querySelectorAll('.k-card-panel').forEach(p => p.classList.remove('active'));
      var target = tab.dataset.tab;
      var panel = card.querySelector('.k-card-panel[data-panel="' + target + '"]');
      if (panel) panel.classList.add('active');
    });
    setupSearch();
    setupModal();
    setupDrawer();
    setupBnav();
    setupSeeAll();
    setupInfiniteScroll();
    loadProducts();
    loadRelais();
  }

  // resize: applyMobileStyles supprimé — CSS gère tout
  if (document.readyState === 'loading') {
    // ── LISTENER GLOBAL cart:setqty (stepper flottant) ──
  // Enregistré UNE SEULE FOIS ici — pas dans setQty (memory leak évité)
  document.addEventListener('cart:setqty', function(e) {
    var d = e.detail || {};
    if (d.pid !== undefined && d.qty !== undefined) {
      setQty(d.pid, d.qty);
    }
  });

    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }


// FIX 2.3 : Rendre les carousel dots de la modal cliquables
// DEBUG TEMPORAIRE : logguer TOUT pointerdown pour voir sur quoi on tape vraiment
document.addEventListener('pointerdown', function(e) {
  var el = e.target;
  var info = el.tagName + (el.className ? '.' + String(el.className).split(' ').slice(0,2).join('.') : '');
  var chip = el.closest ? el.closest('.k-sec-subchip') : null;
  window.__lastPointerDown = {
    target: info,
    insideChip: !!chip,
    chipCat: chip ? chip.dataset.secCat : null,
    chipSub: chip ? chip.dataset.secSub : null,
    x: e.clientX, y: e.clientY,
    pointerType: e.pointerType,
    ts: Date.now()
  };
}, true);

// ══════════════════════════════════════════════════════════
// LISTENER GLOBAL DÉLÉGUÉ pour .k-sec-subchip — SOURCE UNIQUE
// Capture phase + stopImmediatePropagation pour bypass tout handler concurrent.
// Mobile : bascule en mode flat (pager horizontal sous-cats)
// Desktop : filtre local dans la section
// ══════════════════════════════════════════════════════════
document.addEventListener('click', function(e) {
  var chip = e.target.closest('.k-sec-subchip');
  if (!chip) return;
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation(); // bloque tout handler concurrent sur le même event
  var cat = chip.dataset.secCat;
  var sub = chip.dataset.secSub;
  window.__lastSubchipClick = { cat: cat, sub: sub, ts: Date.now(), innerW: window.innerWidth, via: 'click-capture' };
  if (!cat || !sub) return;
  var state = window.state;
  if (!state) return;
  var _isMobile = window.innerWidth < 900;
  if (_isMobile) {
    // Pas de toggle-off : re-cliquer la même chip re-scroll en haut.
    // La sortie se fait UNIQUEMENT par le bouton ✕ du chrome.
    state.flatSubcat = { cat: cat, sub: sub };
    state.page = 0;
    if (typeof window.renderGrid === 'function') window.renderGrid();
    var _sc = document.getElementById('k-page-scroll');
    if (_sc) _sc.scrollTo({ top: 0, behavior: 'auto' });
  } else {
    if (!state.sectionSubcats) state.sectionSubcats = {};
    state.sectionSubcats[cat] = (state.sectionSubcats[cat] === sub) ? null : sub;
    if (typeof window.renderGrid === 'function') window.renderGrid();
  }
}, true); // capture: true → tourne AVANT tous les autres handlers

// (si ce n'est pas déjà fait ailleurs)
document.addEventListener('click', function(e) {
  const dot = e.target.closest('.k-modal-dot');
  if (!dot) return;
  e.preventDefault();
  e.stopPropagation();
  const idx = parseInt(dot.dataset.index || dot.getAttribute('data-index') || '0', 10);
  const track = document.querySelector('.k-modal-carousel-track');
  if (!track) return;
  // Largeur d'une slide = largeur du track / nb slides
  const slides = track.querySelectorAll('.k-modal-slide');
  if (!slides.length) return;
  track.style.transform = 'translateX(-' + (idx * 100) + '%)';
  // Mettre à jour les dots actifs
  document.querySelectorAll('.k-modal-dot').forEach((d, i) => {
    d.classList.toggle('active', i === idx);
  });
});



// ═══════════════════════════════════════════════════════════════════════
