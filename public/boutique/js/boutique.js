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
 * @version       2026-08
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
  loadSharedCart,
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

// ── Carte + identité de visite du point relais ───────────────────────────────
// Le checkout rend le lien canonique « Localiser ce relais ». Cette couche
// l'enrichit avec les données publiques du relais chargées dans state : GPS
// exact (quand disponible), photo reconnaissable et message d'accueil local.
// Tant que le GPS n'est pas renseigné, le fallback nom + adresse reste actif.
let _relayMapPreviewObserver = null;

function relayCoordinates(relay = {}) {
  if (!relay) return null;
  const latitude = Number(relay.latitude ?? relay.lat);
  const longitude = Number(relay.longitude ?? relay.lng ?? relay.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

function relayForMapLink(mapLink) {
  const relais = Array.isArray(state.relais) ? state.relais : [];
  const selectedId = state.orderData?.selectedRelaisId;
  if (selectedId != null) {
    const exact = relais.find(relay => String(relay?.id) === String(selectedId));
    if (exact) return exact;
  }

  const label = String(mapLink?.getAttribute?.('aria-label') || '').toLowerCase();
  return relais.find((relay) => {
    const name = String(relay?.name || relay?.nom || '').trim().toLowerCase();
    return name && label.includes(name);
  }) || null;
}

function relayNavigationUrl(relay, fallbackHref = null) {
  const coordinates = relayCoordinates(relay);
  return coordinates
    ? `https://www.google.com/maps?q=${coordinates.latitude},${coordinates.longitude}&z=17&hl=fr`
    : fallbackHref;
}

function relayEmbedUrlFromLink(mapLink, relay = null) {
  const coordinates = relayCoordinates(relay);
  if (coordinates) {
    return `https://www.google.com/maps?q=${coordinates.latitude},${coordinates.longitude}&z=17&output=embed`;
  }

  if (!mapLink?.href) return null;
  try {
    const url = new URL(mapLink.href, window.location.href);
    const query = url.searchParams.get('query') || url.searchParams.get('q');
    return query
      ? `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`
      : null;
  } catch (_) {
    return null;
  }
}

function relayPhotoUrl(relay = {}) {
  const raw = String(relay.photo_url || relay.photoUrl || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw, window.location.href);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch (_) {
    return null;
  }
}

function buildRelayVisitIdentity(relay = {}) {
  const strip = document.createElement('div');
  strip.className = 'ck-relais-visit-identity';
  strip.style.display = 'flex';
  strip.style.alignItems = 'center';
  strip.style.gap = '10px';
  strip.style.padding = '10px';
  strip.style.background = 'var(--sand)';

  const photoUrl = relayPhotoUrl(relay);
  const relayName = String(relay.name || relay.nom || 'ce relais').trim();
  if (photoUrl) {
    const photoLink = document.createElement('a');
    photoLink.className = 'ck-relais-photo-link';
    photoLink.href = photoUrl;
    photoLink.target = '_blank';
    photoLink.rel = 'noopener';
    photoLink.setAttribute('aria-label', `Voir la photo de ${relayName}`);
    photoLink.style.display = 'block';
    photoLink.style.flex = '0 0 76px';

    const image = document.createElement('img');
    image.className = 'ck-relais-photo';
    image.src = photoUrl;
    image.alt = `Entrée de ${relayName}`;
    image.loading = 'lazy';
    image.style.display = 'block';
    image.style.width = '76px';
    image.style.height = '62px';
    image.style.objectFit = 'cover';
    image.style.borderRadius = '11px';
    image.style.border = '1px solid rgba(31,48,36,.10)';
    image.addEventListener('error', () => photoLink.remove(), { once: true });
    photoLink.appendChild(image);
    strip.appendChild(photoLink);
  } else {
    const icon = document.createElement('span');
    icon.className = 'ck-relais-visit-icon';
    icon.textContent = '🏪';
    icon.setAttribute('aria-hidden', 'true');
    icon.style.display = 'grid';
    icon.style.placeItems = 'center';
    icon.style.flex = '0 0 44px';
    icon.style.width = '44px';
    icon.style.height = '44px';
    icon.style.borderRadius = '12px';
    icon.style.background = 'rgba(255,255,255,.72)';
    strip.appendChild(icon);
  }

  const copy = document.createElement('span');
  copy.className = 'ck-relais-visit-copy';
  copy.style.display = 'grid';
  copy.style.gap = '2px';

  const title = document.createElement('strong');
  title.className = 'ck-relais-visit-title';
  title.textContent = 'Venez nous voir au relais 👋';
  title.style.fontSize = '13px';
  title.style.color = 'var(--text)';

  const note = document.createElement('span');
  note.className = 'ck-relais-visit-note';
  note.textContent = photoUrl
    ? 'Repérez facilement l’entrée avant de venir · photo cliquable'
    : 'Retrouvez facilement le point de retrait sur la carte.';
  note.style.fontSize = '11px';
  note.style.lineHeight = '1.35';
  note.style.color = 'var(--muted)';

  copy.append(title, note);
  strip.appendChild(copy);
  return strip;
}

function ensureRelayMapPreview(mapLink) {
  const summary = mapLink?.closest?.('#ck-relais-summary');
  const container = summary?.parentElement;
  if (!summary || !container || container.querySelector('.ck-relais-map-preview')) return;

  const relay = relayForMapLink(mapLink);
  const exactMapUrl = relayNavigationUrl(relay, mapLink.href);
  if (exactMapUrl && exactMapUrl !== mapLink.href) {
    mapLink.href = exactMapUrl;
    mapLink.dataset.locationPrecision = 'gps';
  }

  const embedUrl = relayEmbedUrlFromLink(mapLink, relay);
  if (!embedUrl) return;

  const preview = document.createElement('div');
  preview.className = 'ck-relais-map-preview';
  preview.style.margin = '8px 0 2px';
  preview.style.overflow = 'hidden';
  preview.style.border = '1px solid var(--border-sage-14, var(--border))';
  preview.style.borderRadius = '14px';
  preview.style.background = 'var(--sand)';
  preview.style.boxShadow = '0 3px 10px rgba(31,48,36,.04)';

  preview.appendChild(buildRelayVisitIdentity(relay || {}));

  const frame = document.createElement('iframe');
  frame.className = 'ck-relais-map-frame';
  frame.src = embedUrl;
  frame.title = relay?.name
    ? `Carte de ${relay.name}`
    : (mapLink.getAttribute('aria-label')?.replace(/^Localiser\s+/i, 'Carte de ') || 'Carte du point relais');
  frame.loading = 'lazy';
  frame.referrerPolicy = 'no-referrer-when-downgrade';
  frame.allowFullscreen = true;
  frame.style.display = 'block';
  frame.style.width = '100%';
  frame.style.height = 'clamp(150px, 24vw, 190px)';
  frame.style.border = '0';
  frame.style.background = 'var(--sand)';

  preview.appendChild(frame);
  summary.insertAdjacentElement('afterend', preview);
}

function syncRelayMapPreviews(root = document) {
  const links = [];
  if (root?.matches?.('.ck-relais-map-link')) links.push(root);
  root?.querySelectorAll?.('.ck-relais-map-link').forEach(link => links.push(link));
  links.forEach(ensureRelayMapPreview);
}

function installRelayMapPreviews() {
  syncRelayMapPreviews(document);
  if (_relayMapPreviewObserver || typeof MutationObserver !== 'function' || !document.body) return;

  _relayMapPreviewObserver = new MutationObserver((records) => {
    records.forEach((record) => {
      record.addedNodes.forEach((node) => {
        if (node?.nodeType === 1) syncRelayMapPreviews(node);
      });
    });
  });
  _relayMapPreviewObserver.observe(document.body, { childList: true, subtree: true });
}

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
  installRelayMapPreviews();
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

  document.querySelectorAll('[data-footer-action="share-list"]').forEach(function(button) {
    button.addEventListener('click', function() {
      // Le tiroir panier est l'entrée canonique : son action « Partager »
      // crée la liste sans réintroduire l'ancienne route /event/create.
      openCart();
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
