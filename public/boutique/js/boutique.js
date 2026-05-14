/**
 * @module boutique
 * @brief Komerce boutique â€” Â§13 INIT (orchestrateur)
 *
 * Â§1  UTILS        â†’ b-utils.js      âœ…
 * Â§2  STATE & DOM  â†’ b-store.js      âœ…
 * Â§3  CART CORE    â†’ b-cart-core.js  âœ…
 * Â§4  CATALOG      â†’ b-catalog.js    âœ…
 * Â§5  FLAT SUBCAT  â†’ b-subcat.js     âœ…
 * Â§6  GRID SECTIONSâ†’ b-catalog.js    âœ…
 * Â§7  CART INTER.  â†’ b-cart.js       âœ…
 * Â§8  CATS & SEARCHâ†’ b-catalog.js    âœ…
 * Â§9  MODAL        â†’ b-modal.js      âœ…
 * Â§10 CART PANEL   â†’ b-cart.js       âœ…
 * Â§11 CHECKOUT     â†’ b-checkout.js   âœ…
 * Â§12 VIEWS        â†’ b-nav.js        âœ… (navigation)
 *                  â†’ b-favs.js       âœ… (favoris)
 *                  â†’ b-tracking.js   âœ… (suivi commandes)
 * Â§13 INIT         â†’ ici (orchestrateur) âœ…
 * Â§14 STEPPER      â†’ b-cart.js       âœ…
 * Â§15 PAGER TEMU   â†’ b-pager.js      âœ…
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
// setupDesktopSidebar dÃ©sactivÃ© â€” mode Temu/Shein = chips rail uniquement, pas de sidebar verticale
// import { setupDesktopSidebar } from './b-desktop-sidebar.js';
import { installScrollOwner, scrollPageToElement } from './b-scroll-owner.js';

'use strict';

// â”€â”€ Desktop scroll fix : neutraliser style.top posÃ© par setupMobile() â”€â”€
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


// â”€â”€ CONSTANTES KOMERCE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const KOMERCE_WA = '33699272526';
const KOMERCE_WA_URL = 'https://wa.me/' + KOMERCE_WA;

const PAVILION_CATEGORY_ALIASES = {
  'CrÃ©ations personnelles': 'Sur-mesure',
};

// â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
// â•‘  Â§13 Â· INIT â€” Boot sequence, bnav, seeAll, global listeners      â•‘
// â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

/**
 * Point d'entrÃ©e principal â€” initialise l'application Komerce boutique.
 * Charge les produits, configure les vues, branche tous les listeners.
 * AppelÃ©e une seule fois au DOMContentLoaded.
 */
function init() {
  initDom();
  document.body.classList.add('k-view-shop');

  installScrollOwner();
  updateCartBadge();
  setupCats();
  // setupDesktopSidebar(); â€” dÃ©sactivÃ©, mode rail uniquement
  setupCatSwipeNav();
  setupSearch();
  setupModal();
  setupDrawer();
  setupBnav();
  setupSeeAll();
  setupInfiniteScroll();
  initFlatSubcat();
  setupFooterLinks();
  loadProducts();
  loadRelais();
}

// Liens Boutique du footer â†’ activent la catÃ©gorie + scroll au catalogue
function setupFooterLinks() {
  document.querySelectorAll('[data-footer-cat]').forEach(function(a) {
    a.addEventListener('click', function(e) {
      e.preventDefault();
      var cat = a.dataset.footerCat;
      var chip = document.querySelector('.k-chip[data-cat="' + cat + '"]');
      if (chip) {
        chip.click();
      } else {
        // Fallback : import dynamique de setActiveCat si chip absent
        import('./b-catalog.js').then(function(m) {
          if (m.setActiveCat) m.setActiveCat(cat);
        });
      }
      var grid = document.getElementById('k-grid');
      if (grid) grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

// â”€â”€ Boot â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
if (document.readyState === 'loading') {
  // Listener global cart:setqty (stepper) â€” enregistrÃ© UNE SEULE FOIS
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

// â”€â”€ Side cart checkout : pont window pour Ã©viter la dÃ©pendance circulaire b-cartâ†”b-checkout â”€â”€
window.__kmrcCheckout = checkoutCart;
// Expose renderGrid pour le listener dÃ©lÃ©guÃ© sous-cats (b-subcat.js + boutique.js)
if (typeof window !== 'undefined') window.renderGrid = renderGrid;

// â”€â”€ Listener global dÃ©lÃ©guÃ© : modal carousel dots â”€â”€
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




