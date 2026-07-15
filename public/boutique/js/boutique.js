/**
 * @komerce-arch
 * @role          boutique-ui-orchestrator
 * @domain        boutique
 * @layer         ui-page
 * @criticality   critical
 * @inputs        dom, state, bus_events
 * @outputs       catalog_init, cart_init, modal_init, checkout_init, navigation_init, share_cart_init
 * @depends       b-store.js, b-cart-core.js, b-catalog.js, b-modal.js, b-cart.js, b-checkout.js, b-nav.js, b-share-cart.js
 * @used-by       public/boutique/index.html
 * @doctrine      boutique_canal_decouverte, navigation_sans_friction, side_cart_non_intrusif
 * @impact-areas  boutique-home, product-discovery, side-cart, checkout, shared-cart, responsive-layout
 * @version       2026-07
 */
'use strict';

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
  loadProducts, setActiveCat,
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
  switchView, setupBnav, loadRelais,
  handleParticipantUrl,
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
import { installScrollOwner, scrollPageToElement } from './b-scroll-owner.js';
import { install as installShareCart } from './b-share-cart.js';
import './b-group-banner.js'; // chargé pour init auto si token actif
import './b-cart-stepper-guard.js'; // correctif capture document vs boutons +/-

'use strict';

// ── Desktop scroll fix : neutraliser style.top posé par setupMobile() ──
(function resetDesktopScroll() {
  function applyDesktopReset() {
    if (window.innerWidth >= 900) {
      let ps = document.getElementById('k-page-scroll');
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

// ── FIX Samsung Internet : un seul propriétaire de la hauteur viewport ──
// L'overlay #k-modal-overlay est déjà position:fixed avec les 4 côtés ancrés.
// Il représente donc directement la zone réellement disponible. Sur mobile,
// la modal doit remplir CE parent (100%) au lieu de recalculer une seconde
// hauteur via 100dvh ou visualViewport.height : Samsung Internet peut alors
// soustraire la barre système deux fois et faire remonter la CTA sur le prix.
// Le style inline est volontairement limité à ce garde runtime de viewport ;
// il est retiré dès le passage en desktop, dont le shell possède sa propre taille.
function syncModalViewportOwner() {
  const modal = document.getElementById('k-modal');
  if (!modal) return;

  if (window.innerWidth < 900) {
    modal.style.height = '100%';
    modal.style.maxHeight = '100%';
  } else {
    if (modal.style.height === '100%') modal.style.removeProperty('height');
    if (modal.style.maxHeight === '100%') modal.style.removeProperty('max-height');
  }
}

window.addEventListener('resize', syncModalViewportOwner);
window.addEventListener('orientationchange', syncModalViewportOwner);
bus.on('modal:opened', syncModalViewportOwner);

// ── CONSTANTES KOMERCE ──────────────────────────────────────────────
const KOMERCE_WA = '33699272526';
const KOMERCE_WA_URL = 'https://wa.me/' + KOMERCE_WA;

const PAVILION_CATEGORY_ALIASES = {
  'Créations personnelles': 'Sur-mesure',
};

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
  syncModalViewportOwner();
  document.body.classList.add('k-view-shop');

  installScrollOwner();
  updateCartBadge();
  setupCats();
  setupCatSwipeNav();
  setupSearch();
  setupModal();
  setupDrawer();
  setupBnav();
  handleParticipantUrl();
  setupInfiniteScroll();
  initFlatSubcat();
  installShareCart();
  setupFooterLinks();
  loadProducts();
  loadRelais();
}

// Liens Boutique du footer → activent la catégorie + scroll au catalogue
function setupFooterLinks() {
  document.querySelectorAll('[data-footer-cat]').forEach(function(a) {
    a.addEventListener('click', function(e) {
      e.preventDefault();
      let cat = a.dataset.footerCat;
      let chip = document.querySelector('.k-chip[data-cat="' + cat + '"]');
      if (chip) {
        chip.click();
      } else {
        // Fallback : import dynamique de setActiveCat si chip absent
        import('./b-catalog.js').then(function(m) {
          if (m.setActiveCat) m.setActiveCat(cat);
        });
      }
      let grid = document.getElementById('k-grid');
      if (grid) grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

// ── Boot ─────────────────────────────────────────────────────────────
// ARCH-1 : remplace window.__kmrcCheckout par un listener bus.
// Assigné AVANT init() pour que renderSideCart trouve le handler dès le premier rendu.
bus.on('checkout:open', checkoutCart);

if (document.readyState === 'loading') {
  // Listener global cart:setqty (stepper) — enregistré UNE SEULE FOIS
  document.addEventListener('cart:setqty', function(e) {
    let d = e.detail || {};
    if (d.pid !== undefined && d.qty !== undefined) {
      setQty(d.pid, d.qty);
    }
  });
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// ── Side cart checkout : pont window pour éviter la dépendance circulaire b-cart↔b-checkout ──
// ARCH-1 : checkout désormais via bus.on('checkout:open') — voir plus haut.
// ── Listener global délégué : modal carousel dots ──
document.addEventListener('click', function(e) {
  let dot = e.target.closest('.k-modal-dot');
  if (!dot) return;
  e.preventDefault();
  e.stopPropagation();
  let idx = parseInt(dot.dataset.index || dot.getAttribute('data-index') || '0', 10);
  let track = document.querySelector('.k-modal-carousel-track');
  if (!track) return;
  let slides = track.querySelectorAll('.k-modal-slide');
  if (!slides.length) return;
  track.style.transform = 'translateX(-' + (idx * 100) + '%)';
  document.querySelectorAll('.k-modal-dot').forEach(function(d, i) {
    d.classList.toggle('active', i === idx);
  });
});