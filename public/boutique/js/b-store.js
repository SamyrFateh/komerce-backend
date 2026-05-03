/**
 * @module b-store
 * @brief Source de vérité unique pour l'état applicatif et les constantes.
 *
 * Contient :
 *   - state       → état mutable partagé (panier, catalogue, modal…)

 *   - dom         → cache des refs DOM (peuplé par initDom() au boot)
 *   - $, $$       → aliases querySelector / querySelectorAll
 *
 * Usage :

 */

/* ── CONSTANTES ──────────────────────────────────────────── */

/** Version du panier — incrémenter pour forcer un reset localStorage */
export const CART_VERSION = 3;

/** URL de base pour les images produits Cloudinary */
export const CLOUD_BASE = 'https://res.cloudinary.com/dloffvvdz/image/upload';

/** Nombre de produits chargés par page Temu */
export const PAGE_SIZE = 20;

/* ── HELPERS DOM ─────────────────────────────────────────── */

/**
 * Alias quertySelector.
 * @param {string} s - Sélecteur CSS
 * @returns {Element|null}
 */
export const $ = (s) => document.querySelector(s);

/**
 * Alias querySelectorAll.
 * @param {string} s - Sélecteur CSS
 * @returns {NodeList}
 */
export const $$ = (s) => document.querySelectorAll(s);

/* ── CART INIT ───────────────────────────────────────────── */

/**
 * Charge le panier depuis localStorage en vérifiant la version.
 * @returns {Array} Tableau d'items panier (peut être vide)
 */
function _loadCart() {
  try {
    const v = localStorage.getItem('kmrc_cart_v');
    if (String(v) !== String(CART_VERSION)) return [];
    return JSON.parse(localStorage.getItem('kmrc_cart') || '[]');
  } catch(e) { return []; }
}

/* ── STATE ───────────────────────────────────────────────── */

/**
 * État applicatif global (mutable).
 * Toujours modifier via les fonctions des modules (jamais direct depuis HTML).
 */
export const state = {
  products: [],
  filtered: [],
  cart: _loadCart(),
  favs: JSON.parse(localStorage.getItem('k_favs') || '[]'),
  activeCat: 'all',
  activeSubcat: null,
  sectionSubcats: {},
  /** Mode pager Temu — { cat: 'Mode', sub: 'Femme' } | null */
  flatSubcat: null,
  modalProduct: null,
  modalSubcatFilter: null,
  modalQty: 1,
  modalHistory: [],
  /** Historique des produits vus (IDs), persisté en localStorage.
      Utilisé pour la section "Vu récemment" en desktop. */
  viewedHistory: JSON.parse(localStorage.getItem('k_viewed_history') || '[]'),
  carouselIndex: 0,
  carouselCount: 1,
  searchTimeout: null,
  relais: [],
  orderData: { payment_mode: 'cash_relais' },
  walletBalance: 0,
  page: 0,
  pageSize: PAGE_SIZE,
  checkoutAttemptKey: null,
  pendingStripeOrderRef: null,
};

// Debug global (read-only)
if (typeof window !== 'undefined') window._kstate = state;

/* ── SCROLL SHARED STATE ─────────────────────────────────── */

/**
 * État de scroll partagé entre modules.
 * Évite les window.* partagés entre b-cart.js et b-checkout.js.
 */
export const scroll = {
  /** Position Y sauvegardée avant ouverture d'un overlay (panier, checkout). */
  savedY: 0,
  /** Vrai pendant un scroll programmatique vers une section (anti-rebond). */
  scrollingToSection: false,
};


/* ── SUBCATEGORIES MAP — LOT 10 ─────────────────────────── */
/*
 * SUBCATS supprimé — source de vérité déplacée vers la DB.
 * Utiliser getSubcategories(catKey) depuis ./shop-schema.js
 * (fetche GET /api/categories au boot, fallback hardcodé si API indispo).
 */


/* ── DOM REFS ────────────────────────────────────────────── */

/**
 * Cache des références DOM.
 * Vide jusqu'à l'appel de initDom() dans main.js (après DOMContentLoaded).
 * @type {Object.<string, Element|null>}
 */
export const dom = {};

/**
 * Peuple le cache DOM depuis le document.
 * Doit être appelé une seule fois dans main.js après DOMContentLoaded.
 */
export function initDom() {
  Object.assign(dom, {
    promoRail:          $('#k-promo-rail'),
    grid:               $('#k-grid'),
    loading:            $('#k-loading'),
    searchInput:        $('#k-search-input'),
    searchDrop:         $('#k-search-dropdown'),
    cartBtn:            $('#k-cart-btn'),
    cartBadge:          $('#k-cart-badge'),
    // Product Modal
    modalOverlay:       $('#k-modal-overlay'),
    modal:              $('#k-modal'),
    modalBack:          $('#k-modal-back'),
    modalBackLabel:     $('#k-modal-back-label'),
    modalClose:         $('#k-modal-close'),
    modalCartBtn:       $('#k-modal-cart-btn'),
    modalCartBadge:     $('#k-modal-cart-badge'),
    modalImg:           $('#k-modal-img'),
    modalCarousel:      $('#k-modal-carousel'),
    modalCarouselTrack: $('#k-modal-carousel-track'),
    modalDots:          $('#k-modal-dots'),
    modalDetails:       $('#k-modal-details'),
    modalPromoBadge:    $('#k-modal-promo-badge'),
    modalName:          $('#k-modal-name'),
    modalDesc:          $('#k-modal-desc'),
    modalPrice:         $('#k-modal-price'),
    modalOldPrice:      $('#k-modal-old-price'),
    modalCat:           $('#k-modal-cat'),
    modalStock:         $('#k-modal-stock'),
    modalQtyVal:        $('#k-qty-val'),
    qtyMinus:           $('#k-qty-minus'),
    qtyPlus:            $('#k-qty-plus'),
    addCartBtn:         $('#k-add-cart-btn'),
    sugRail:            $('#k-sug-rail'),
    // Cart Drawer
    cartOverlay:        $('#k-cart-overlay'),
    cartDrawer:         $('#k-cart-drawer'),
    cartHeader:         $('#k-cart-header'),
    cartHeaderTitle:    $('#k-cart-header-title'),
    cartClose:          $('#k-cart-close'),
    cartBody:           $('#k-cart-body'),
    cartFooter:         $('#k-cart-footer'),
    cartTotalVal:       $('#k-cart-total-val'),
    cartTotalConv:      $('#k-cart-total-conv'),
    cartContinue:       $('#k-cart-continue'),
    cartClear:          $('#k-cart-clear'),
    cartWhatsapp:       $('#k-cart-whatsapp'),
    cartCheckout:       $('#k-cart-checkout'),
    // Order Modal
    orderModal:         $('#k-order-modal'),
    orderTitle:         $('#k-order-title'),
    orderBody:          $('#k-order-body'),
    orderClose:         $('#k-order-close'),
    // Toast
    toast:              $('#k-toast'),
  });
}

/**
 * Recalcule le scroll top mobile après resize/orientation change.
 * (Style inline légitime : mesure de hauteur runtime impossible en CSS)
 */
export function updateMobileScrollTop() {
  if (window.innerWidth > 899) return;
  const doUpdate = () => {
    const w = document.getElementById('k-hero-fixed-wrap');
    const s = document.getElementById('k-page-scroll');
    if (w && s) s.style.top = (w.offsetHeight + 44) + 'px';
  };
  requestAnimationFrame(doUpdate);
  setTimeout(doUpdate, 400);
}
