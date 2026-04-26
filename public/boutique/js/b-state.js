/* ═══════════════════════════════════════════════════════════
   KOMERCE BOUTIQUE — b-state.js
   Global state, event bus, cart/fav persistence, DOM refs
   Depends on: b-config.js
   ═══════════════════════════════════════════════════════════ */
(function (K) {
  'use strict';

  // ── CART VERSIONING ──────────────────────────────────────
  const CART_VERSION = 2;
  let savedCartV = 0;
  try { savedCartV = parseInt(localStorage.getItem('kmrc_cart_v') || '0', 10); } catch (e) {}

  let initialCart = [];
  if (savedCartV < CART_VERSION) {
    try { localStorage.removeItem('kmrc_cart'); localStorage.removeItem('k_cart'); } catch (e) {}
    try { localStorage.setItem('kmrc_cart_v', String(CART_VERSION)); } catch (e) {}
  } else {
    try { initialCart = JSON.parse(localStorage.getItem('kmrc_cart') || '[]'); } catch (e) {}
  }

  // ── STATE ─────────────────────────────────────────────────
  K.state = {
    products:      [],
    filtered:      [],
    cart:          initialCart,    // [{product: {...}, qty: N}]
    favs:          [],
    activeCat:     'all',
    sortMode:      'default',      // 'default' | 'price_asc' | 'price_desc' | 'promo'
    modalProduct:  null,
    modalQty:      1,
    modalHistory:  [],
    searchTimeout: null,
    relais:        [],
    orderData:     { payment_mode: 'cash_relais' },
    walletBalance: 0,
    page:          0,
    pageSize:      K.PAGE_SIZE || 16,
    currentTab:    'shop',
  };

  try {
    K.state.favs = JSON.parse(localStorage.getItem('k_favs') || '[]');
  } catch (e) { K.state.favs = []; }

  // ── PERSISTENCE ──────────────────────────────────────────
  K.saveCart = function () {
    try {
      localStorage.setItem('kmrc_cart', JSON.stringify(K.state.cart));
      localStorage.setItem('kmrc_cart_v', String(CART_VERSION));
    } catch (e) {}
  };

  K.saveFavs = function () {
    try { localStorage.setItem('k_favs', JSON.stringify(K.state.favs)); } catch (e) {}
  };

  // ── CART HELPERS ─────────────────────────────────────────
  K.cartQty   = function () { return K.state.cart.reduce((s, i) => s + i.qty, 0); };
  K.cartTotal = function () { return K.state.cart.reduce((s, i) => s + (i.product.price_kmf || 0) * i.qty, 0); };

  K.isFav = function (id) { return K.state.favs.includes(id); };

  // ── EVENT BUS ─────────────────────────────────────────────
  const _listeners = {};
  K.on = function (event, fn) {
    (_listeners[event] = _listeners[event] || []).push(fn);
  };
  K.emit = function (event, data) {
    (_listeners[event] || []).forEach(fn => { try { fn(data); } catch (e) { console.error('K.emit', event, e); } });
  };

  // ── DOM REFS (lazy — resolved after DOMContentLoaded) ────
  K.dom = {};
  K._initDom = function () {
    const $ = K.$;
    K.dom = {
      promoRail:        $('#k-promo-rail'),
      grid:             $('#k-grid'),
      loading:          $('#k-loading'),
      searchInput:      $('#k-search-input'),
      searchDrop:       $('#k-search-dropdown'),
      cartBtn:          $('#k-cart-btn'),
      cartBadge:        $('#k-cart-badge'),
      // Product Modal
      modalOverlay:     $('#k-modal-overlay'),
      modal:            $('#k-modal'),
      modalBack:        $('#k-modal-back'),
      modalBackLabel:   $('#k-modal-back-label'),
      modalClose:       $('#k-modal-close'),
      modalCartBtn:     $('#k-modal-cart-btn'),
      modalCartBadge:   $('#k-modal-cart-badge'),
      modalImg:         $('#k-modal-img'),
      modalPromoBadge:  $('#k-modal-promo-badge'),
      modalName:        $('#k-modal-name'),
      modalDesc:        $('#k-modal-desc'),
      modalPrice:       $('#k-modal-price'),
      modalOldPrice:    $('#k-modal-old-price'),
      modalCat:         $('#k-modal-cat'),
      modalStock:       $('#k-modal-stock'),
      modalQtyVal:      $('#k-qty-val'),
      qtyMinus:         $('#k-qty-minus'),
      qtyPlus:          $('#k-qty-plus'),
      addCartBtn:       $('#k-add-cart-btn'),
      buyNowBtn:        $('#k-buy-now-btn'),
      sugRail:          $('#k-sug-rail'),
      // Cart Drawer
      cartOverlay:      $('#k-cart-overlay'),
      cartDrawer:       $('#k-cart-drawer'),
      cartHeaderTitle:  $('#k-cart-header-title'),
      cartClose:        $('#k-cart-close'),
      cartBody:         $('#k-cart-body'),
      cartFooter:       $('#k-cart-footer'),
      cartTotalVal:     $('#k-cart-total-val'),
      cartTotalConv:    $('#k-cart-total-conv'),
      cartContinue:     $('#k-cart-continue'),
      cartClear:        $('#k-cart-clear'),
      cartWhatsapp:     $('#k-cart-whatsapp'),
      cartCheckout:     $('#k-cart-checkout'),
      // Order Modal
      orderModal:       $('#k-order-modal'),
      orderTitle:       $('#k-order-title'),
      orderBody:        $('#k-order-body'),
      orderClose:       $('#k-order-close'),
      // Toast
      toast:            $('#k-toast'),
      // Scroll to top
      scrollTop:        $('#k-scrolltop'),
    };
  };

})(window.K = window.K || {});
