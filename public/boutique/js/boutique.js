/**
 * @module boutique
 * @brief Komerce boutique — §13 INIT (orchestrateur)
 *
 * §1  UTILS        → b-utils.js      ✅
 * §2  STATE & DOM  → b-store.js      ✅
 * §3  CART CORE    → b-cart-core.js  ✅
 * §4  CATALOG      → b-catalog.js    ✅
 * §5  FLAT SUBCAT  → b-subcat.js     ✅
 * §6  GRID SECTIONS→ b-catalog.js    ✅
 * §7  CART INTER.  → b-cart.js       ✅
 * §8  CATS & SEARCH→ b-catalog.js    ✅
 * §9  MODAL        → b-modal.js      ✅
 * §10 CART PANEL   → b-cart.js       ✅
 * §11 CHECKOUT     → b-checkout.js   ✅
 * §12 VIEWS        → b-nav.js        ✅ (navigation)
 *                  → b-favs.js       ✅ (favoris)
 *                  → b-tracking.js   ✅ (suivi commandes)
 * §13 INIT         → ici (orchestrateur) ✅
 * §14 STEPPER      → b-cart.js       ✅
 * §15 PAGER TEMU   → b-pager.js      ✅
 */

import { bus }                from './b-bus.js';
import {
  state, dom, initDom, updateMobileScrollTop,
  $, $$, CART_VERSION, PAGE_SIZE,
}                              from './b-store.js';
import {
  optimizeImgUrl, sanitize, promoImgUrl, renderProductCarousel,
  bindCarouselDots, detectCurrency, fmt, fmtPrice,
  productEmoji, genIdempotencyKey, _currency, _rates,
}                              from './b-utils.js';
import {
  showToast, cartQty, cartTotal, saveCart, updateCartBadge,
  isFav, saveFavs,
}                              from './b-cart-core.js';
import {
  renderPromos, renderGrid, appendNextPage,
  setupCats, setupCatSwipeNav, centerActiveChip, setupSearch,
  loadProducts,
}                              from './b-catalog.js';
import {
  initFlatSubcat, renderSubcatChips,
}                              from './b-subcat.js';
import {
  openModal, closeModal, modalGoBack, setupModal,
}                              from './b-modal.js';
import {
  addToCart, openCart, closeCart, renderCartBody as renderCart,
  quickAdd, quickRemove, setQty,
  shareCartWhatsApp, showShareChoiceModal, loadSharedCart,
}                              from './b-cart.js';
import {
  checkoutCart, closeOrderModal, renderCheckout,
  makeInput, makeIntlPhoneInput,
  digitsOnly, normalizeLocal, prettifyLocal, buildE164,
  makePhoneInput, checkWalletBalance, updateWalletDisplay,
  submitOrder, renderOrderSuccess,
}                              from './b-checkout.js';
import {
  setupDrawer, setupInfiniteScroll,
  switchView, setupBnav, setupSeeAll, loadRelais,
}                              from './b-nav.js';
import {
  renderFavView, updateFavPromoBadge, shareWishlistWhatsApp,
}                              from './b-favs.js';
import {
  buildTimeline, renderOrdersHistory, renderOrderDetail,
  renderTrackView, renderMyOrdersList,
  getStatusDisplay, formatOrderDate, renderTrackViewSearchMode,
}                              from './b-tracking.js';
import {
  _setupMobilePager, _setupSectionAutoAdvance,
  _setupHorizontalWrap, _syncChipToScroll, _onPagerScroll,
}                              from './b-pager.js';
import { setupDesktopSidebar } from './b-desktop-sidebar.js';
import { installScrollOwner } from './b-scroll-owner.js';

'use strict';

// ── Desktop scroll fix : neutraliser style.top posé par setupMobile() ──
(function resetDesktopScroll() {
  function applyDesktopReset() {
    if (window.innerWidth >= 900) {
      var ps = document.getElementById('k-page-scroll');
      if (ps) {
        ps.style.top      = '';
        ps.style.position = '';
        ps.style.height   = '';
        ps.style.overflow = '';
      }
    }
  }
  applyDesktopReset();
  window.addEventListener('resize', applyDesktopReset);
})();


// ── CONSTANTES KOMERCE ──────────────────────────────────────
const KOMERCE_WA = '33699272526';
const KOMERCE_WA_URL = 'https://wa.me/' + KOMERCE_WA;

// ╔══════════════════════════════════════════════════════════════════╗
// ║  §13 · INIT — Boot sequence, bnav, seeAll, global listeners      ║
// ╚══════════════════════════════════════════════════════════════════╝

/**
 * Point d'entrée principal — initialise l'application Komerce boutique.
 * Charge les produits, configure les vues, branche tous les listeners.
 * Appelée une seule fois au DOMContentLoaded.
 */
function init() {
  initDom();
  installScrollOwner();
  updateCartBadge();
  // Expose renderGrid sur window pour le listener délégué global (flat subcat)
  if (typeof window !== 'undefined') window.renderGrid = renderGrid;
  setupCats();
  setupDesktopSidebar();
  setupCatSwipeNav();
  setupSearch();
  setupModal();
  setupDrawer();
  setupBnav();
  setupSeeAll();
  setupInfiniteScroll();
  loadProducts();
  loadRelais();
}

// ── Boot ────────────────────────────────────────────────────
if (document.readyState === 'loading') {
  // Listener global cart:setqty (stepper) — enregistré UNE SEULE FOIS
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

// ── Listener global délégué : sous-cats (.k-sec-subchip) ──
// Capture phase + stopImmediatePropagation — source unique
document.addEventListener('click', function(e) {
  var chip = e.target.closest('.k-sec-subchip');
  if (!chip) return;
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
  var cat = chip.dataset.secCat;
  var sub = chip.dataset.secSub;
  if (!cat || !sub) return;
  var _isMobile = window.innerWidth < 900;
  if (_isMobile) {
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
}, true);

// ── Listener global délégué : modal carousel dots ──
document.addEventListener('click', function(e) {
  var dot = e.target.closest('.k-modal-dot');
  if (!dot) return;
  e.preventDefault();
  e.stopPropagation();
  var idx = parseInt(dot.dataset.index || dot.getAttribute('data-index') || '0', 10);
  var track = document.querySelector('.k-modal-carousel-track');
  if (!track) return;
  var slides = track.querySelectorAll('.k-modal-slide');
  if (!slides.length) return;
  track.style.transform = 'translateX(-' + (idx * 100) + '%)';
  document.querySelectorAll('.k-modal-dot').forEach(function(d, i) {
    d.classList.toggle('active', i === idx);
  });
});
