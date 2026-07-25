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

/* ══ SPIKE ROUTE B — scroll document mobile (temporaire, réversible) ══════════
 * Objectif : valider sur appareil réel si sortir la modale du `position:fixed`
 * permet à Samsung Internet de rétracter sa barre d'adresse (~100-150px rendus).
 *
 * Contexte : le site n'a AUCUN scroll de document (catalogue en cage fixe
 * `#k-page-scroll.k-pager-active`, modale en overlay fixed + `.k-modal-scroll`
 * interne). Or les navigateurs mobiles ne rétractent leur barre QUE sur scroll
 * de document. La barre reste donc déployée en permanence.
 *
 * Activation : ajouter ?docscroll=1 à l'URL. Absent = comportement actuel
 * inchangé (risque nul en prod). Permet un A/B sur le même appareil.
 *
 * ⚠ NON VALIDÉ : la rétraction de barre est intestable en Chromium headless
 * (pas de barre d'adresse). Seule la précondition — document réellement
 * scrollable — est vérifiée automatiquement. Le reste exige un test manuel.
 *
 * À SUPPRIMER après arbitrage : ce bloc, la classe CSS `.k-doc-scroll`
 * (modal-shell.css, bloc SPIKE) et le guard dans syncModalViewportOwner().
 * ═══════════════════════════════════════════════════════════════════════════ */
const DOC_SCROLL_SPIKE = (() => {
  try {
    return new URLSearchParams(window.location.search).get('docscroll') === '1';
  } catch (_) {
    return false;
  }
})();

if (DOC_SCROLL_SPIKE) {
  document.documentElement.classList.add('k-doc-scroll');
}

// ── FIX Samsung Internet : le shell mobile suit le viewport réellement visible ──
// L'overlay fixed peut rester dimensionné sur le layout viewport, qui inclut une zone
// masquée par les barres du navigateur sur certains Samsung Internet. `height:100%`
// reproduit alors exactement cette hauteur trop grande. La modal reçoit donc directement
// la hauteur en pixels du Visual Viewport. `innerHeight` reste le fallback standard.
//
// [MDM-8 phase 3] --k-modal-vvh : .k-modal-img-wrap répartit 48% de la hauteur
// via une unité vh/dvh statique (modal-mobile-canonical.css), déconnectée de
// la mesure ci-dessus. Sur certains Samsung Internet, dvh elle-même peut
// reproduire la hauteur "layout viewport" trop grande — un pourcentage calculé
// en CSS via vh/dvh hérite donc du même bug, juste déplacé sur la zone média
// au lieu du prix. On réexpose visibleHeight (déjà fiabilisée ci-dessus) en
// variable CSS sur #k-modal, réutilisée telle quelle par modal-mobile-canonical.css
// via calc() — pas une nouvelle source de mesure, la même.
function syncModalViewportOwner() {
  const modal = document.getElementById('k-modal');
  if (!modal) return;

  // SPIKE ROUTE B : en mode scroll-document, la hauteur de la modale est
  // dictée par son contenu (flux normal), pas par le visual viewport. Forcer
  // une hauteur en pixels ici annulerait tout le principe et rendrait le
  // document non scrollable. On nettoie donc les overrides et on sort.
  if (DOC_SCROLL_SPIKE && window.innerWidth < 900) {
    modal.style.removeProperty('height');
    modal.style.removeProperty('max-height');
    modal.style.removeProperty('--k-modal-vvh');
    return;
  }

  if (window.innerWidth < 900) {
    const vv = window.visualViewport;
    const rawHeight = vv && Number.isFinite(vv.height) && vv.height > 0
      ? vv.height
      : (window.innerHeight || document.documentElement.clientHeight);
    const visibleHeight = Math.max(1, Math.floor(rawHeight || 1));

    modal.style.height = visibleHeight + 'px';
    modal.style.maxHeight = visibleHeight + 'px';
    modal.style.setProperty('--k-modal-vvh', visibleHeight + 'px');
  } else {
    modal.style.removeProperty('height');
    modal.style.removeProperty('max-height');
    modal.style.removeProperty('--k-modal-vvh');
  }
}

window.addEventListener('resize', syncModalViewportOwner);
window.addEventListener('orientationchange', syncModalViewportOwner);
if (window.visualViewport && typeof window.visualViewport.addEventListener === 'function') {
  window.visualViewport.addEventListener('resize', syncModalViewportOwner);
}
bus.on('modal:opened', syncModalViewportOwner);

// FIX Samsung Internet (suite) : sur certains appareils, la barre d'outils
// se rétracte/apparaît PENDANT le scroll à l'intérieur de la modale, sans
// déclencher ni 'resize' ni 'visualViewport resize' de façon fiable (l'un
// des deux peut arriver en retard, voire jamais, selon le firmware One UI).
// La mesure figée à l'ouverture devient alors trop restrictive après coup :
// --k-modal-vvh sous-évalue l'espace réellement disponible, ce qui pousse
// #k-modal-suggestions plus bas que nécessaire (aucun "peek" visible même
// quand la barre s'est rétractée). On resynchronise donc aussi sur scroll,
// avec un rAF pour ne pas mesurer pendant une frame de transition du chrome
// navigateur (rAF laisse le layout se stabiliser avant la lecture).
let _vvhScrollSyncPending = false;
function scheduleModalViewportResync() {
  if (window.innerWidth >= 900 || _vvhScrollSyncPending) return;
  _vvhScrollSyncPending = true;
  requestAnimationFrame(() => {
    _vvhScrollSyncPending = false;
    syncModalViewportOwner();
  });
}
document.addEventListener(
  'scroll',
  (event) => {
    const modal = document.getElementById('k-modal');
    if (!modal || !modal.contains(event.target)) return;
    scheduleModalViewportResync();
  },
  { capture: true, passive: true }
);

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
// MDM-9 §6 : le listener délégué legacy sur .k-modal-dot a été retiré ici —
// dead code jamais synchronisé avec data-index (jamais posé par
// b-modal-product.js), il retombait systématiquement sur idx=0 et écrasait
// track.style.transform juste après le vrai goToSlide() (listener direct
// posé par b-modal-product.js à la création de chaque dot), cassant la
// navigation carousel dès qu'on cliquait un dot ≠ 0. Source unique de
// navigation désormais : b-modal-product.js::goToSlide.
