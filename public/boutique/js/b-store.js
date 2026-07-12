/**
 * @komerce-arch
 * @role          boutique-shared-state
 * @domain        boutique
 * @layer         state
 * @criticality   critical
 * @inputs        dom_refs, persisted_cart, products, session_context
 * @outputs       shared_state, dom_registry, constants, scroll_context
 * @depends       localStorage, sessionStorage, DOM
 * @used-by       all-boutique-js-modules
 * @doctrine      state_partage_explicite, panier_local_source_unique, dom_refs_centralisees
 * @impact-areas  all-boutique, cart, checkout, catalog, modal, shared-cart, tracking
 * @version       2026-07
 */
'use strict';

/**
 * @module b-store
 * @brief Source de vérité unique pour l'état applicatif et les constantes.
 *
 * Contient :
 *   - state       → état mutable partagé (panier, catalogue, modal…)
 *
 *   - dom         → cache des refs DOM (peuplé par initDom() au boot)
 *   - $, $$       → aliases querySelector / querySelectorAll
 *
 * Usage :
 *
 */

import { bus } from './b-bus.js';

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
  /** Modal ouvert (vrai entre openModal et closeModal). Lu par b-pager.js
   *  pour bloquer l'auto-advance pendant l'affichage d'une fiche produit.
   *  AVANT le fix : déclaré nulle part, lu 3 fois → garde inerte → scroll
   *  horizontal automatique parasite après fermeture de modal. */
  modalOpen: false,
  modalProduct: null,
  modalSubcatFilter: null,
  modalQty: 1,
  modalHistory: [],
  /** PDC-4 — contrat détail produit public actuellement affiché sur mobile. */
  modalProductDetail: null,
  /** PDC-3 — état dérivé unique de sélection SKU, partagé par les renderers. */
  modalSelection: null,
  /** Signature des médias déjà rendus ; évite de reconstruire le carousel à vide. */
  modalMediaSignature: '',
  /** Variantes legacy sélectionnées : transition jusqu'à extinction PDC-6. */
  modalVariantCombo: {},
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
  /** Panier partagé actif — posé par b-share-cart.js */
  shareToken: null,
  shareId:    null,
  cartName:   '',
  shareExpiry: null,
  /**
   * SC-EDIT-01 — Contexte d'édition du panier collectif.
   * Posé par b-group-view.js au clic "Modifier les articles".
   * Supprimé après PUT réussi ou annulation explicite.
   *
   * Shape : {
   *   shared_cart_id : string,   // cartId numérique
   *   token          : string,   // shareToken (pour notif / rafraîchi)
   *   return_tab     : 'group',  // onglet de retour après édition
   *   started_at     : number,   // Date.now() — pour debug
   * } | null
   */
  editSharedCart: null,
};

// Debug global (read-only) — dev/local uniquement (pas en prod)
if (
  typeof window !== 'undefined' &&
  window.location &&
  (() => { const h = window.location.hostname; return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.local'); })()
) {
  window._kstate = state;
}

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
 * @hook modalZone(selector)
 * @brief Lookup scopé au root #k-modal — évite que chaque enhancer fasse
 *   son propre `dom.modal ? dom.modal.querySelector(...) : null`.
 *   Zones : .k-modal-img-wrap, .k-modal-topbar, .k-modal-info, .k-modal-actions,
 *           .k-modal-scroll, .k-modal-meta, .k-modal-carousel[-track], .k-modal-product-zone
 * Usage : import { modalZone } from './b-store.js';
 */
export function modalZone(selector) {
  return dom.modal ? dom.modal.querySelector(selector) : null;
}

/**
 * Setter léger — mutation d'état + bus, SANS renderGrid().
 *
 * Réservé aux contextes scroll où le pager gère déjà l'affichage :
 *   - b-pager._syncChip   (listener scroll natif / rAF)
 *   - home-controller     (branche pagerActive — scrollPagerToCat gère le rendu)
 *
 * Placé ici (b-store) et non dans b-catalog pour éviter la dépendance
 * circulaire b-catalog → b-pager → b-catalog.
 *
 * @param {string} cat
 * @param {string|null} [sub=null]
 */
export function setActiveCatState(cat, sub = null) {
  state.activeCat    = cat;
  state.activeSubcat = sub;
  state.flatSubcat   = null;
  state.page         = 0;
  bus.emit('catalog:cat-changed', cat);
}

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
    modalSku:           $('#k-modal-sku'),
    modalDesc:          $('#k-modal-desc'),
    modalPrice:         $('#k-modal-price'),
    modalOldPrice:      $('#k-modal-old-price'),
    modalCat:           $('#k-modal-cat'),
    modalStock:         $('#k-modal-stock'),
    modalVariants:      $('#k-modal-variants'),
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
    // Scroll container mobile (pager Temu + scroll infini)
    pageScroll:         $('#k-page-scroll'),
  });
}

/**
 * Recalcule le scroll top mobile après resize/orientation change.
 * (Style inline légitime : mesure de hauteur runtime impossible en CSS)
 */
export function updateMobileScrollTop() {
  if (window.innerWidth > 899) return;
  const doUpdate = () => {
    // Mesure cohérente avec _recalcPagerVars() dans b-pager.js :
    // on prend le bas réel du dernier élément fixe (hero + chips).
    let top = 0;
    [
      document.getElementById('k-hero-fixed-wrap'),
      document.getElementById('k-sticky-bar'),
      document.querySelector('.k-cats-shell'),
    ].forEach(function(el) {
      if (!el) return;
      const b = el.getBoundingClientRect().bottom;
      if (b > top) top = b;
    });
    // Fallback si éléments non encore rendus
    if (top < 10) {
      const w = document.getElementById('k-hero-fixed-wrap');
      const headerH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 44;
      top = (w ? w.offsetHeight : 140) + headerH;
    }
    const s = dom.pageScroll;
    if (s) s.style.top = top + 'px';
  };
  requestAnimationFrame(doUpdate);
  setTimeout(doUpdate, 400);
}
