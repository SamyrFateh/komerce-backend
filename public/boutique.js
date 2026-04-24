/* ═══════════════════════════════════════════════════════════
   KOMERCE — Boutique JS v2.0 "Archipel"
   Full cart/checkout mechanism ported from original
   Depends on: komerce-api.js (K global), Stripe (optional)
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── CONSTANTES KOMERCE ──────────────────────────────────
  // Numéro WhatsApp de contact Komerce (format international sans +)
  const KOMERCE_WA = '33699272526'; // Numéro WhatsApp Komerce
  const KOMERCE_WA_URL = 'https://wa.me/' + KOMERCE_WA;

  /* ── HELPERS ───────────────────────────────────────────── */
  function optimizeImgUrl(url, w) {
    if (!url || url.indexOf('res.cloudinary.com') === -1) return url;
    if (url.indexOf('f_auto') !== -1) return url;
    return url.replace('/upload/', '/upload/f_auto,q_auto' + (w ? ',w_' + w : '') + '/');
  }

  /* ── Carousel produit (Shein-like) ──────────────────────────
     Swipeable gauche/droite sur les cartes grille.
     Utilise p.images (JSON array) si dispo, sinon duplique image_url × 4.
  */
  function renderProductCarousel(p, width) {
    width = width || 400;
    let imgs = [];
    if (p.images) {
      try {
        imgs = typeof p.images === 'string' ? JSON.parse(p.images) : p.images;
      } catch (_) { imgs = []; }
    }
    if (!Array.isArray(imgs) || imgs.length === 0) {
      imgs = p.image_url ? [p.image_url, p.image_url, p.image_url, p.image_url] : [];
    }
    if (!imgs.length) {
      return `<img class="k-card-img" src="" alt="${sanitize(p.name||'')}" loading="lazy">`;
    }
    const slides = imgs.map((src, i) => `
      <div class="k-card-slide">
        <img class="k-card-slide-img" src="${optimizeImgUrl(src, width)}" alt="${sanitize(p.name||'')} ${i+1}" loading="lazy">
      </div>`).join('');
    const dots = imgs.length > 1
      ? `<div class="k-card-dots">${imgs.map((_, i) => `<span class="k-card-dot${i===0?' active':''}"></span>`).join('')}</div>`
      : '';
    return `<div class="k-card-carousel">${slides}</div>${dots}`;
  }

  /* ── Bind scroll dots + tap vs swipe (pour ouvrir modale au tap) ── */
  function bindCarouselDots(card) {
    const carousel = card.querySelector('.k-card-carousel');
    const dots = card.querySelectorAll('.k-card-dot');
    if (!carousel || carousel.dataset.bound) return;
    carousel.dataset.bound = '1';

    if (dots.length > 1) {
      let raf = null;
      carousel.addEventListener('scroll', () => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = null;
          const idx = Math.round(carousel.scrollLeft / carousel.clientWidth);
          dots.forEach((d, i) => d.classList.toggle('active', i === idx));
        });
      }, { passive: true });
    }

    // Tap vs swipe : si bouge > 10px, on marque pour bloquer ouverture modale
    let sx = 0, sy = 0, moved = false;
    function onStart(e) {
      const t = e.touches ? e.touches[0] : e;
      sx = t.clientX; sy = t.clientY; moved = false;
    }
    function onMove(e) {
      const t = e.touches ? e.touches[0] : e;
      if (Math.abs(t.clientX - sx) > 10 || Math.abs(t.clientY - sy) > 10) moved = true;
    }
    function onEnd() {
      if (moved) {
        card.dataset.justSwiped = '1';
        setTimeout(() => { delete card.dataset.justSwiped; }, 250);
      }
    }
    carousel.addEventListener('touchstart', onStart, { passive: true });
    carousel.addEventListener('touchmove', onMove, { passive: true });
    carousel.addEventListener('touchend', onEnd, { passive: true });
    carousel.addEventListener('mousedown', onStart);
    carousel.addEventListener('mousemove', (e) => { if (e.buttons) onMove(e); });
    carousel.addEventListener('mouseup', onEnd);
  }

  function promoImgUrl(url, w) {
    // Détourage CSS via mix-blend-mode:multiply (fonds blancs/clairs)
    // e_background_removal retiré : add-on non disponible sur ce compte Cloudinary
    return optimizeImgUrl(url, w);
  }

  function detectCurrency() {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      if (/Comoro|Mayotte/i.test(tz)) return 'KMF';
    } catch (e) {}
    return 'EUR';
  }

  const _rates = { EUR: 495, KMF: 1 };
  const _currency = detectCurrency();

  function fmt(kmf, currency) {
    const c = currency || _currency;
    const rate = _rates[c] || 1;
    const val = Math.round(kmf / rate);
    return val.toLocaleString('fr-FR') + (c === 'EUR' ? ' €' : ' KMF');
  }

  function fmtPrice(kmf) {
    return new Intl.NumberFormat('fr-FR').format(kmf) + ' KMF';
  }

  function sanitize(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function productEmoji(p) { return p.emoji || '📦'; }

  async function apiGet(path) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    try {
      const res = await fetch(path, { credentials: 'include', signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    } finally { clearTimeout(t); }
  }

  /** UUID v4 pour Idempotency-Key (compat navigateurs anciens) */
  function genIdempotencyKey() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  async function apiPost(path, body, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);

  try {
    const headers = { 'Content-Type': 'application/json' };

    // /api/orders : accepte une clé stable fournie par le checkout
    if (path === '/api/orders') {
      headers['Idempotency-Key'] = opts.idempotencyKey || genIdempotencyKey();
    }

    const res = await fetch(path, {
      method: 'POST',
      headers,
      credentials: 'include',
      signal: ctrl.signal,
      body: JSON.stringify(body)
    });

    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.message || data.error || 'Erreur serveur');
      err.data = data;
      throw err;
    }

    return data;
  } finally {
    clearTimeout(t);
  }

  }

  /* ── STRIPE ───────────────────────────────────────────── */
  let _stripe = null, _stripeElements = null, _stripeCard = null;
  try {
    _stripe = typeof Stripe !== 'undefined' ?
      Stripe('pk_test_51TKKX3Enc3Ce0auC9CJERH5p4xism4E0MsJzAFFJbacrZ7m3ttvIRY8Uq7A1kHLLxoTWzofgzJNX9AWPlbNOBX5s00nAUjKiyQ') : null;
  } catch(e) { console.warn('Stripe not loaded:', e); }

  /* ── STATE ─────────────────────────────────────────────── */
  const CART_VERSION = 3; // bumped: clear carts with old (deactivated) product UUIDs
  let savedCartV;
  try { savedCartV = parseInt(localStorage.getItem('kmrc_cart_v') || '0', 10); } catch(e) { savedCartV = 0; }

  let initialCart = [];
  if (savedCartV < CART_VERSION) {
    localStorage.removeItem('kmrc_cart');
    localStorage.removeItem('k_cart');
    localStorage.setItem('kmrc_cart_v', String(CART_VERSION));
  } else {
    try { initialCart = JSON.parse(localStorage.getItem('kmrc_cart') || '[]'); } catch(e) { initialCart = []; }
  }

  const state = {
  products: [],
  filtered: [],
  cart: initialCart,
  favs: JSON.parse(localStorage.getItem('k_favs') || '[]'),
  activeCat: 'all',
    activeSubcat: null,
    sectionSubcats: {},
  modalProduct: null,
  modalQty: 1,
  modalHistory: [],
  carouselIndex: 0,
  carouselCount: 1,
  searchTimeout: null,
  relais: [],
  orderData: { payment_mode: 'cash_relais' },
  walletBalance: 0,
  page: 0,
  pageSize: 16,
  checkoutAttemptKey: null,
  pendingStripeOrderRef: null,
};
  // Expose state (read-only) pour les modules externes (long-press stepper)
  if (typeof window !== "undefined") window.state = state;



  /* ── SUBCATEGORIES MAP ───────────────────────────────── */
  /* Keys MUST match DB subcategory values exactly (case-sensitive) */
  const SUBCATS = {
    'Mode': [
      { key: 'Femme', label: 'Femme', icon: '👗' },
      { key: 'Homme', label: 'Homme', icon: '👔' },
      { key: 'Hijab', label: 'Hijab', icon: '🧕' },
      { key: 'Boubou', label: 'Boubou', icon: '👘' },
      { key: 'Shoes', label: 'Shoes', icon: '👟' },
    ],
    'Beauté': [
      { key: 'Parfums', label: 'Parfum', icon: '🌸' },
      { key: 'Soins', label: 'Soin', icon: '🧴' },
      { key: 'Cheveux', label: 'Cheveux', icon: '💇' },
      { key: 'Maquillage', label: 'Maquil.', icon: '💄' },
      { key: 'Ongles', label: 'Ongles', icon: '💅' },
    ],
    'Tech': [
      { key: 'Phones', label: 'Tél.', icon: '📱' },
      { key: 'Ordi', label: 'Ordi', icon: '💻' },
      { key: 'Audio', label: 'Audio', icon: '🎧' },
      { key: 'Montres', label: 'Montres', icon: '⌚' },
      { key: 'Gaming', label: 'Gaming', icon: '🎮' },
    ],
    'Enfant': [
      { key: 'Bébé', label: 'Bébé', icon: '🍼' },
      { key: 'Garçon', label: 'Garçon', icon: '👦' },
      { key: 'Fille', label: 'Fille', icon: '👧' },
      { key: 'Jouets', label: 'Jouets', icon: '🧸' },
      { key: 'École', label: 'École', icon: '📚' },
    ],
    'Maison': [
      { key: 'Cuisine', label: 'Cuisine', icon: '🍳' },
      { key: 'Salon', label: 'Salon', icon: '🛋' },
      { key: 'Chambre', label: 'Chambre', icon: '🛏' },
      { key: 'Déco', label: 'Déco', icon: '🖼' },
      { key: 'Rangement', label: 'Rangem.', icon: '📦' },
    ],
    'Sport': [
      { key: 'Foot', label: 'Foot', icon: '⚽' },
      { key: 'Fitness', label: 'Fitness', icon: '💪' },
      { key: 'Natation', label: 'Natation', icon: '🏊' },
      { key: 'Yoga', label: 'Yoga', icon: '🧘' },
      { key: 'Outdoor', label: 'Outdoor', icon: '🏕' },
    ],
    'Sur-mesure': [
      { key: 'Couture', label: 'Couture', icon: '🧵' },
      { key: 'Design', label: 'Design', icon: '✏️' },
      { key: 'Mesure', label: 'Mesure', icon: '📏' },
      { key: 'Broderie', label: 'Broderie', icon: '🪡' },
      { key: 'Premium', label: 'Premium', icon: '⭐' },
    ],
  };

  /* ── RENDER SUBCATEGORIES ────────────────────────────── */
  function renderSubcats() {
    /* Removed — subcategories are now local inline chips inside each section.
       See _renderGridWithSections() for the local subcats approach. */
    var wrap = document.getElementById('k-subcats-wrap');
    if (wrap) { wrap.innerHTML = ''; wrap.classList.remove('k-subcats-visible'); }
  }

    /* ── MOBILE SCROLL TOP RECALC ────────────────────────── */
  function _updateMobileScrollTop() {
    if (window.innerWidth > 899) return;
    var doUpdate = function() {
      var w = document.getElementById('k-hero-fixed-wrap');
      var s = document.getElementById('k-page-scroll');
      if (w && s) s.style.top = (w.offsetHeight + 44) + 'px';
    };
    requestAnimationFrame(doUpdate);
    setTimeout(doUpdate, 400);
  }

  /* ── DOM REFS ──────────────────────────────────────────── */
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  const dom = {
    promoRail: $('#k-promo-rail'),
    grid: $('#k-grid'),
    loading: $('#k-loading'),
    searchInput: $('#k-search-input'),
    searchDrop: $('#k-search-dropdown'),
    cartBtn: $('#k-cart-btn'),
    cartBadge: $('#k-cart-badge'),
    // Product Modal
    modalOverlay: $('#k-modal-overlay'),
    modal: $('#k-modal'),
    modalBack: $('#k-modal-back'),
    modalBackLabel: $('#k-modal-back-label'),
    modalClose: $('#k-modal-close'),
    modalCartBtn: $('#k-modal-cart-btn'),
    modalCartBadge: $('#k-modal-cart-badge'),
    modalImg: $('#k-modal-img'),
    modalCarousel: $('#k-modal-carousel'),
    modalCarouselTrack: $('#k-modal-carousel-track'),
    modalDots: $('#k-modal-dots'),
    modalDetails: $('#k-modal-details'),
    modalPromoBadge: $('#k-modal-promo-badge'),
    modalName: $('#k-modal-name'),
    modalDesc: $('#k-modal-desc'),
    modalPrice: $('#k-modal-price'),
    modalOldPrice: $('#k-modal-old-price'),
    modalCat: $('#k-modal-cat'),
    modalStock: $('#k-modal-stock'),
    modalQtyVal: $('#k-qty-val'),
    qtyMinus: $('#k-qty-minus'),
    qtyPlus: $('#k-qty-plus'),
    addCartBtn: $('#k-add-cart-btn'),
    sugRail: $('#k-sug-rail'),
    // Cart Drawer
    cartOverlay: $('#k-cart-overlay'),
    cartDrawer: $('#k-cart-drawer'),
    cartHeader: $('#k-cart-header'),
    cartHeaderTitle: $('#k-cart-header-title'),
    cartClose: $('#k-cart-close'),
    cartBody: $('#k-cart-body'),
    cartFooter: $('#k-cart-footer'),
    cartTotalVal: $('#k-cart-total-val'),
    cartTotalConv: $('#k-cart-total-conv'),
    cartContinue: $('#k-cart-continue'),
    cartClear: $('#k-cart-clear'),
    cartWhatsapp: $('#k-cart-whatsapp'),
    cartCheckout: $('#k-cart-checkout'),
    // Order Modal
    orderModal: $('#k-order-modal'),
    orderTitle: $('#k-order-title'),
    orderBody: $('#k-order-body'),
    orderClose: $('#k-order-close'),
    // Toast
    toast: $('#k-toast'),
  };

  /* ── TOAST ─────────────────────────────────────────────── */
  function showToast(msg, type) {
    type = type || '';
    // Wrapper requis pour les styles .k-toast.error/.success
    dom.toast.innerHTML = '<div class="k-toast-simple">' + (msg || '') + '</div>';
    dom.toast.className = 'k-toast show' + (type ? ' ' + type : '');
    clearTimeout(dom.toast._t);
    dom.toast._t = setTimeout(() => dom.toast.classList.remove('show'), 2800);
  }

  /* ── CART HELPERS ───────────────────────────────────────── */
  function cartQty() { return state.cart.reduce((s, i) => s + i.qty, 0); }
  function cartTotal() { return state.cart.reduce((s, i) => s + (i.product.price_kmf || 0) * i.qty, 0); }

  function saveCart() {
    try {
      localStorage.setItem('kmrc_cart', JSON.stringify(state.cart));
      localStorage.setItem('kmrc_cart_v', String(CART_VERSION));
    } catch(e) {}
    updateCartBadge();
  }

  function updateCartBadge() {
    const count = cartQty();
    dom.cartBadge.textContent = count;
    dom.cartBadge.classList.toggle('show', count > 0);
    // Modal badge
    if (dom.modalCartBadge) {
      dom.modalCartBadge.textContent = count > 0 ? count : '';
    }
  }

  function isFav(id) { return state.favs.includes(id); }

  function saveFavs() {
    localStorage.setItem('k_favs', JSON.stringify(state.favs));
  }


  /* ── SKELETON LOADING ───────────────────────────────────── */
  function showSkeletons(n) {
    if (!dom.grid) return;
    dom.grid.innerHTML = Array.from({length: n}, () => `
      <div class="k-card k-card-skeleton">
        <div class="k-skeleton k-skeleton-img"></div>
        <div class="k-card-info">
          <div class="k-skeleton k-skeleton-title"></div>
          <div class="k-skeleton k-skeleton-price"></div>
        </div>
      </div>`).join('');
  }

  function hideSkeletons() {
    dom.grid.querySelectorAll('.k-card-skeleton').forEach(el => el.remove());
  }

  /* ── INFINITE SCROLL — append next page ─────────────────── */
  function appendNextPage() {
    const spinner = document.getElementById('k-load-more-spinner');
    // Même logique que renderGrid : si activeCat === 'all', on prend filtered tel quel
    // sinon on filtre filtered par catégorie (cohérent avec renderGrid)
    let list = state.activeCat === 'all'
      ? state.filtered
      : state.filtered.filter(p => p.category === state.activeCat);
    // Subcategory filter
    if (state.activeSubcat) {
      const subF = list.filter(p => p.subcategory === state.activeSubcat);
      if (subF.length > 0) list = subF;
    }
    const start = (state.page + 1) * state.pageSize;
    if (start >= list.length) {
      if (spinner) spinner.classList.remove('show');
      return;
    }
    state.page += 1;
    const nextItems = list.slice(start, start + state.pageSize);
    const fragment = nextItems.map(p => {
      const inCart = state.cart.find(i => String(i.product.id) === String(p.id));
      const qty = inCart ? inCart.qty : 0;
      return `
        <div class="k-card" data-id="${p.id}">
          <div class="k-card-img-wrap">
            ${renderProductCarousel(p, 400)}
            ${p.promo_pct ? `<span class="k-card-promo">-${p.promo_pct}%</span>` : ''}
            <button class="k-card-fav${isFav(p.id) ? ' liked' : ''}" data-fav="${p.id}" aria-label="Favori">
              ${isFav(p.id) ? '❤️' : '🤍'}
            </button>
            <button class="k-card-add${qty > 0 ? ' in-cart' : ''}" data-add="${p.id}" aria-label="Ajouter">
              ${qty > 0 ? '<span class="k-add-minus" data-pid="' + p.id + '">−</span><span class="k-add-qty">' + qty + '</span><span class="k-add-plus-ic">+</span>' : '<span class="k-card-add-plus">+</span>'}
            </button>
          </div>
          <div class="k-card-info">
            <div class="k-card-name">${p.name}</div>
            <div class="k-card-bottom k-card-prices-row">
              <span class="k-card-price">${fmtPrice(p.price_kmf)}</span>
              ${p.promo_pct ? '<span class="k-card-old-price">' + fmtPrice(Math.round(p.price_kmf / (1 - p.promo_pct / 100))) + '</span>' : ''}
            </div>

          </div>
        </div>`;
    }).join('');
    dom.grid.insertAdjacentHTML('beforeend', fragment);
    // Re-bind events on new cards
    dom.grid.querySelectorAll('.k-card:not([data-bound])').forEach(card => {
      card.dataset.bound = '1';
      bindCarouselDots(card);
      card.addEventListener('click', (e) => {
        if (e.target.closest('.k-card-fav') || e.target.closest('.k-card-add') || e.target.closest('.k-card-tab') || e.target.closest('.k-card-dots')) return;
        if (card.dataset.justSwiped === '1') return;
        openModal(card.dataset.id);
      });
    });
    dom.grid.querySelectorAll('.k-card-fav:not([data-bound])').forEach(btn => {
      btn.dataset.bound = '1';
      btn.addEventListener('click', (e) => { e.stopPropagation(); toggleFav(btn.dataset.fav, btn); });
    });
    dom.grid.querySelectorAll('.k-card-add:not([data-bound])').forEach(btn => {
      btn.dataset.bound = '1';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (e.target.closest('.k-add-minus')) { quickRemove(btn.dataset.add, btn); }
        else { quickAdd(btn.dataset.add, btn); }
      });
    });
    if (spinner) spinner.classList.remove('show');
  }

  /* ── LOAD PRODUCTS ──────────────────────────────────────── */
  async function loadProducts() {
  console.log("[loadProducts] start");

  try {
    if (typeof K === 'undefined' || !K.products) {
      throw new Error("K non disponible");
    }

    const data = await K.products.list({ limit: 1000 });

    state.products = (Array.isArray(data) ? data : data.products || [])
      .filter(p => p.is_available !== false);

    localStorage.setItem('komerce_products_cache', JSON.stringify(state.products));

  } catch (e) {
    console.warn("[loadProducts] API KO → fallback cache");

    const cached = localStorage.getItem('komerce_products_cache');

    if (cached) {
      state.products = JSON.parse(cached);
    } else {
      showToast("Pas de connexion", "error");
      return;
    }
  }

  state.filtered = [...state.products];
  renderGrid();
  if (dom.promoRail) renderPromos();
    applyMobileStyles();
  markAllCartButtons();
  applyMobileStyles();

  // FEATURE 2 : vérifier si des favoris sont en promo et màj badge bnav
  try {
    const favProducts = state.products.filter(p => state.favs.includes(p.id));
    const promoFavs = favProducts.filter(p => (p.promo_pct || 0) > 0);
    if (typeof updateFavPromoBadge === 'function') updateFavPromoBadge(promoFavs.length);
  } catch(e) { console.warn('[fav-promo-badge]', e.message); }

  // FIX : nettoyer le panier des produits qui n'existent plus en DB
  const validIds = new Set(state.products.map(p => String(p.id)));
  const before = state.cart.length;
  state.cart = state.cart.filter(item => {
    const ok = validIds.has(String(item.product.id));
    if (!ok) console.warn('[cart] Produit obsolète retiré :', item.product.id, item.product.name);
    return ok;
  });
  if (state.cart.length !== before) {
    saveCart();
    if (typeof renderCartBody === 'function') renderCartBody();
    if (typeof updateCartBadge === 'function') updateCartBadge();
    const removed = before - state.cart.length;
    showToast(`${removed} produit${removed > 1 ? 's' : ''} obsolète${removed > 1 ? 's' : ''} retiré${removed > 1 ? 's' : ''} du panier`, 'info');
  }
}

  /* ── RENDER PROMOS ──────────────────────────────────────── */

  /* ═══════════════════════════════════════════════════════════════
     MOBILE FIX v7.0 — Force inline styles via JS
     Runs after every render to guarantee mobile layout
     ═══════════════════════════════════════════════════════════════ */
  function applyMobileStyles() {
    /* CSS is the single source of truth for all layout.
       This function is intentionally empty.
       Mobile styles are defined in boutique.css @media(max-width:899px).
       Desktop styles use @media(min-width:900px) overrides. */
  }

  function renderPromos() {
    const promos = state.products.filter(p => p.promo_pct > 0).slice(0, 10);
    dom.promoRail.innerHTML = promos.map(p => {
      const oldPrice = Math.round(p.price_kmf / (1 - p.promo_pct / 100));
      return `
        <div class="k-promo-card" data-id="${p.id}">
          <img class="k-promo-card-img" src="${promoImgUrl(p.image_url, 400)}" alt="${p.name}" loading="lazy">
          <span class="k-promo-badge">-${p.promo_pct}%</span>
          <div class="k-promo-card-info">
            <div class="k-promo-card-name">${p.name}</div>
            <div class="k-promo-card-prices">
              <span class="k-promo-card-price">${fmtPrice(p.price_kmf)}</span>
              <span class="k-promo-card-old">${fmtPrice(oldPrice)}</span>
            </div>
          </div>
        </div>`;
    }).join('');

    // Wrap in inner div for seamless auto-scroll
    const inner = document.createElement('div');
    inner.className = 'k-promo-rail-inner';
    inner.innerHTML = dom.promoRail.innerHTML + dom.promoRail.innerHTML;
    dom.promoRail.innerHTML = '';
    dom.promoRail.appendChild(inner);
    // Pause on touch (mobile)
    inner.addEventListener('touchstart', () => inner.style.animationPlayState = 'paused');
    inner.addEventListener('touchend', () => inner.style.animationPlayState = 'running');
    
    inner.querySelectorAll('.k-promo-card').forEach(card => {
      card.addEventListener('click', () => openModal(card.dataset.id));
    });
  }

  /* ── RENDER GRID ────────────────────────────────────────── */
  function renderGrid() {
    state.page = 0;
    const _isMobile = window.innerWidth < 900;
    // Mobile pager: always show all products grouped by category
    let list = (state.activeCat === 'all' || _isMobile)
      ? state.filtered
      : state.filtered.filter(p => p.category === state.activeCat);
    // Subcategory filter (desktop focused mode only)
    if (!_isMobile && state.activeSubcat) {
      const subF = list.filter(p => p.subcategory === state.activeSubcat);
      if (subF.length > 0) list = subF;
    }

    // ── TEMU PAGER (mobile): always sections ──
    // ── Desktop: sections only in "Tout" mode ──
    const useSections = state.activeCat === 'all' || _isMobile;

    let pageItems;
    if (useSections) {
      // Mobile pager: more products per page (20 per cat); Desktop: balanced 48
      pageItems = _isMobile ? _balancedPick(list, 160) : _balancedPick(list, 48);
    } else {
      pageItems = list.slice(0, state.pageSize);
    }

    if (useSections) {
      dom.grid.classList.add('k-grid-has-sections');
      dom.grid.innerHTML = _renderGridWithSections(pageItems);
      _bindGridEvents();
      // ── Temu pager setup (mobile) ──
      if (_isMobile) {
        var _ps = document.getElementById('k-page-scroll');
        if (_ps) _ps.classList.add('k-pager-active');
        _setupMobilePager();
        if (state.activeCat !== 'all') {
          setTimeout(function() { _scrollPagerToCat(state.activeCat); }, 50);
        }
      } else {
        var _ps2 = document.getElementById('k-page-scroll');
        if (_ps2) _ps2.classList.remove('k-pager-active');
      }
      return;
    }
    // Sinon : mode grille classique, s'assurer qu'on n'a pas la classe sections
    dom.grid.classList.remove('k-grid-has-sections');
    var _ps3 = document.getElementById('k-page-scroll');
    if (_ps3) _ps3.classList.remove('k-pager-active');

    dom.grid.innerHTML = pageItems.map(p => {
      const inCart = state.cart.find(i => String(i.product.id) === String(p.id));
      const qty = inCart ? inCart.qty : 0;
      return `
        <div class="k-card" data-id="${p.id}">
          <div class="k-card-img-wrap">
            ${renderProductCarousel(p, 400)}
            ${p.promo_pct ? `<span class="k-card-promo">-${p.promo_pct}%</span>` : ''}
            <button class="k-card-fav${isFav(p.id) ? ' liked' : ''}" data-fav="${p.id}" aria-label="Favori">
              ${isFav(p.id) ? '❤️' : '🤍'}
            </button>
            <button class="k-card-add${qty > 0 ? ' in-cart' : ''}" data-add="${p.id}" aria-label="Ajouter">
              ${qty > 0 ? '<span class="k-add-minus" data-pid="' + p.id + '">−</span><span class="k-add-qty">' + qty + '</span><span class="k-add-plus-ic">+</span>' : '<span class="k-card-add-plus">+</span>'}
            </button>
          </div>
          <div class="k-card-info">
            <div class="k-card-name">${p.name}</div>
            <div class="k-card-bottom k-card-prices-row">
              <span class="k-card-price">${fmtPrice(p.price_kmf)}</span>
              ${p.promo_pct ? '<span class="k-card-old-price">' + fmtPrice(Math.round(p.price_kmf / (1 - p.promo_pct / 100))) + '</span>' : ''}
            </div>

          </div>
        </div>`;
    }).join('');

    // Events
    dom.grid.querySelectorAll('.k-card').forEach(card => {
      bindCarouselDots(card);
      card.addEventListener('click', (e) => {
        if (e.target.closest('.k-card-fav') || e.target.closest('.k-card-add') || e.target.closest('.k-card-tab') || e.target.closest('.k-card-dots')) return;
        if (card.dataset.justSwiped === '1') return;
        openModal(card.dataset.id);
      });
    });

    dom.grid.querySelectorAll('.k-card-fav').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFav(btn.dataset.fav, btn);
      });
    });

    dom.grid.querySelectorAll('.k-card-add:not([data-bound])').forEach(btn => {
      btn.dataset.bound = '1';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (e.target.closest('.k-add-minus')) { quickRemove(btn.dataset.add, btn); }
        else { quickAdd(btn.dataset.add, btn); }
      });
    });
  }


  // ── HELPERS pour rendu sections catégorie en mode "Tout" ────────────
  function _renderCard(p) {
    const inCart = state.cart.find(i => String(i.product.id) === String(p.id));
    const qty = inCart ? inCart.qty : 0;
    return `
      <div class="k-card" data-id="${p.id}">
        <div class="k-card-img-wrap">
          ${renderProductCarousel(p, 400)}
          ${p.promo_pct ? `<span class="k-card-promo">-${p.promo_pct}%</span>` : ''}
          <button class="k-card-fav${isFav(p.id) ? ' liked' : ''}" data-fav="${p.id}" aria-label="Favori">
            ${isFav(p.id) ? '❤️' : '🤍'}
          </button>
          <button class="k-card-add${qty > 0 ? ' in-cart' : ''}" data-add="${p.id}" aria-label="Ajouter">
            ${qty > 0 ? '<span class="k-add-minus" data-pid="' + p.id + '">−</span><span class="k-add-qty">' + qty + '</span><span class="k-add-plus-ic">+</span>' : '<span class="k-card-add-plus">+</span>'}
          </button>
        </div>
        <div class="k-card-info">
          <div class="k-card-name">${p.name}</div>
          ${p.description ? '<div class="k-card-desc">' + p.description.slice(0, 60) + '</div>' : ''}
          <div class="k-card-bottom k-card-prices-row">
            <span class="k-card-price">${fmtPrice(p.price_kmf)}</span>
            ${p.promo_pct ? '<span class="k-card-old-price">' + fmtPrice(Math.round(p.price_kmf / (1 - p.promo_pct / 100))) + '</span>' : ''}
          </div>
        </div>
      </div>`;
  }

  /**
   * Piochage équilibré par catégorie :
   *   - Parcourt `list` en ordre d'apparition pour grouper par catégorie
   *   - Garde seulement les catégories qui ont >= MIN_PER_SECTION produits
   *   - Les catégories "maigres" (< MIN) sont fusionnées en une section "Autres" à la fin
   *   - Résultat : jamais de cartes orphelines dans la grille 3-cols
   */
  // ── Fisher-Yates shuffle (chaos contrôlé pour page "Tout") ──
  function _shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  function _balancedPick(list, pageSize) {
    const MIN_PER_SECTION = 4; // min produits par section (pair pour grille 2-cols)

    // Grouper par cat dans l'ordre d'apparition
    const byCat = new Map();
    const order = [];
    for (const p of list) {
      const cat = p.category || 'Autres';
      if (!byCat.has(cat)) { byCat.set(cat, []); order.push(cat); }
      byCat.get(cat).push(p);
    }

    const rich = [];   // catégories qui ont >= MIN
    const thin = [];   // produits des catégories maigres → regrouper en "Autres"

    for (const cat of order) {
      const prods = byCat.get(cat);
      if (prods.length >= MIN_PER_SECTION) {
        rich.push({ cat, prods });
      } else {
        thin.push(...prods);
      }
    }
    if (thin.length >= MIN_PER_SECTION) {
      rich.push({ cat: 'Autres', prods: thin });
    }

    // ── Distribution équitable : chaque catégorie reçoit sa part ──
    const nCats = rich.length || 1;
    const basePerCat = Math.floor(pageSize / nCats);
    // Arrondir au pair inférieur (grille 2-cols, pas de carte orpheline)
    const perCat = basePerCat >= 2 ? (basePerCat % 2 === 0 ? basePerCat : basePerCat - 1) : 2;

    const flat = [];
    for (const section of rich) {
      _shuffle(section.prods); // ← chaos contrôlé : ordre aléatoire dans chaque catégorie
      const take = Math.min(perCat, section.prods.length);
      // Aussi arrondir au pair
      const count = take >= 2 ? (take % 2 === 0 ? take : take - 1) : 0;
      for (let i = 0; i < count; i++) flat.push(section.prods[i]);
    }
    return flat;
  }

  function _renderGridWithSections(items) {
    // Grouper par catégorie en préservant l'ordre d'apparition
    const order = [];
    const byCat = {};
    for (const p of items) {
      const cat = p.category || 'Autres';
      if (!byCat[cat]) { byCat[cat] = []; order.push(cat); }
      byCat[cat].push(p);
    }
    const EMOJI_CAT = {
      'Mode': '👕', 'Beauté': '🌸', 'Tech': '📱', 'Enfant': '🧒',
      'Maison': '🏠', 'Sport': '⚽', 'Sur-mesure': '✨', 'Autres': '📦',
    };
    // Total produits par catégorie (tous, pas seulement le balanced pick)
    const totalByCat = {};
    for (const p of state.filtered) {
      const cat = p.category || 'Autres';
      totalByCat[cat] = (totalByCat[cat] || 0) + 1;
    }
    const parts = [];
    // ── Mobile pager: prepend "Soldes" section with promo products ──
    if (window.innerWidth < 900) {
      var _soldes = _shuffle(state.filtered.filter(function(p){ return p.promo_pct > 0; })).slice(0, 30);
      if (_soldes.length > 0) {
        parts.push('<div class="k-cat-section" data-cat="Soldes">');
        parts.push(
          '<div class="k-sec-header" data-cat="Soldes">' +
          '<span class="k-sec-header-emoji">🏷️</span>' +
          '<span class="k-sec-header-name">Soldes</span>' +
          '<span class="k-sec-header-count">' + _soldes.length + '</span>' +
          '</div>'
        );
        parts.push('<div class="k-sec-grid">');
        for (var _si = 0; _si < _soldes.length; _si++) parts.push(_renderCard(_soldes[_si]));
        parts.push('</div></div>');
      }
    }
    for (const cat of order) {
      const emoji = EMOJI_CAT[cat] || '📦';
      const prods = byCat[cat];
      const total = totalByCat[cat] || prods.length;
      const anchorId = 'k-sec-' + cat.replace(/[^a-zA-Z0-9]/g, '-');
      // ── Wrapper section (pour horizontal pager mobile) ──
      parts.push('<div class="k-cat-section" data-cat="' + sanitize(cat) + '">');
      // ── Section header avec "Voir tout" ──
      parts.push(
        '<div class="k-sec-header" id="' + anchorId + '" data-cat="' + sanitize(cat) + '">' +
          '<span class="k-sec-header-emoji">' + emoji + '</span>' +
          '<span class="k-sec-header-name">' + sanitize(cat) + '</span>' +
          '<span class="k-sec-header-count">' + total + '</span>' +
          '<button class="k-sec-see-all" data-see-cat="' + sanitize(cat) + '">Voir tout →</button>' +
        '</div>'
      );
      // ── Sous-catégories locales (chips inline dans la section) ──
      const localSub = (state.sectionSubcats || {})[cat] || null;
      if (SUBCATS[cat] && SUBCATS[cat].length > 0) {
        parts.push('<div class="k-sec-subcats">');
        for (const s of SUBCATS[cat]) {
          parts.push(
            '<button class="k-sec-subchip' + (localSub === s.key ? ' active' : '') + '" ' +
            'data-sec-cat="' + sanitize(cat) + '" data-sec-sub="' + s.key + '">' +
            s.icon + ' ' + s.label + '</button>'
          );
        }
        parts.push('</div>');
      }
      // ── Filtrer par sous-cat locale si active ──
      let sectionProds = prods;
      if (localSub) {
        const filtered = prods.filter(p => p.subcategory === localSub);
        if (filtered.length > 0) sectionProds = filtered;
      }
      // ── Grille produits de cette section ──
      parts.push('<div class="k-sec-grid">');
      for (const p of sectionProds) parts.push(_renderCard(p));
      parts.push('</div>');
      parts.push('</div>'); // close .k-cat-section
    }
    return parts.join('');
  }

  function _bindGridEvents() {
    // ── Cartes : ouvrir modal ──
    dom.grid.querySelectorAll('.k-card').forEach(card => {
      bindCarouselDots(card);
      card.addEventListener('click', (e) => {
        if (e.target.closest('.k-card-fav') || e.target.closest('.k-card-add') || e.target.closest('.k-card-tab') || e.target.closest('.k-card-dots')) return;
        if (card.dataset.justSwiped === '1') return;
        openModal(card.dataset.id);
      });
    });
    // ── Favoris ──
    dom.grid.querySelectorAll('.k-card-fav').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFav(btn.dataset.fav, btn);
      });
    });
    // ── Ajout panier ──
    dom.grid.querySelectorAll('.k-card-add:not([data-bound])').forEach(btn => {
      btn.dataset.bound = '1';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (e.target.closest('.k-add-minus')) { quickRemove(btn.dataset.add, btn); }
        else { quickAdd(btn.dataset.add, btn); }
      });
    });
    // ── "Voir tout →" dans les en-têtes de section ──
    dom.grid.querySelectorAll('.k-sec-see-all').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const cat = btn.dataset.seeCat;
        if (!cat) return;
        state.activeCat = cat;
        state.activeSubcat = null;
        $$('.k-chip').forEach(c => c.classList.remove('active'));
        const chip = document.querySelector('.k-chip[data-cat="' + cat + '"]');
        if (chip) { chip.classList.add('active'); centerActiveChip(chip); }
        renderGrid();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
    // ── Sous-catégories locales (filtrent dans la section) ──
    dom.grid.querySelectorAll('.k-sec-subchip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const cat = chip.dataset.secCat;
        const sub = chip.dataset.secSub;
        if (!cat || !sub) return;
        if (!state.sectionSubcats) state.sectionSubcats = {};
        state.sectionSubcats[cat] = (state.sectionSubcats[cat] === sub) ? null : sub;
        renderGrid();
      });
    });
    // ── Index flottant + observer nav chips ──
    if (typeof _renderFloatingIndex === 'function') _renderFloatingIndex();
  }

  // ── Saut vers une section depuis le header (chip tap) ou l'index flottant ──
  window._scrollingToSection = false;
  window.scrollToCategorySection = function(cat) {
    // Mobile pager: scroll horizontally
    if (window.innerWidth < 900 && document.getElementById('k-page-scroll') &&
        document.getElementById('k-page-scroll').classList.contains('k-pager-active')) {
      if (!cat || cat === 'all') {
        var _g = document.getElementById('k-grid');
        if (_g) _g.scrollTo({ left: 0, behavior: 'smooth' });
      } else {
        _scrollPagerToCat(cat);
      }
      return;
    }
    // Desktop: vertical scroll
    var scroller = document.getElementById('k-page-scroll');
    if (!scroller) return;
    if (!cat || cat === 'all') {
      scroller.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    var anchorId = 'k-sec-' + cat.replace(/[^a-zA-Z0-9]/g, '-');
    var el = document.getElementById(anchorId);
    if (!el) return;
    window._scrollingToSection = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(function() { window._scrollingToSection = false; }, 700);
  };


  /* ── FLY TO CART ANIMATION ──────────────────────────────── */
  function flyToCart(sourceEl, product) {
    const cartIcon = dom.cartBtn;
    if (!cartIcon || !sourceEl) return;
    const srcRect = sourceEl.getBoundingClientRect();
    const dstRect = cartIcon.getBoundingClientRect();
    const startX = srcRect.left + srcRect.width / 2;
    const startY = srcRect.top + srcRect.height / 2;
    const endX = dstRect.left + dstRect.width / 2;
    const endY = dstRect.top + dstRect.height / 2;

    // Main particle
    const particle = document.createElement('div');
    particle.style.cssText = [
      'position:fixed', 'z-index:9999', 'pointer-events:none',
      'border-radius:50%', 'background:var(--ocean)',
      'width:56px', 'height:56px',
      'display:flex', 'align-items:center', 'justify-content:center',
      'font-size:1.5rem',
      'box-shadow:0 4px 20px rgba(67,160,71,0.6)',
      'overflow:hidden',
      'left:' + startX + 'px', 'top:' + startY + 'px',
      'transform:translate(-50%,-50%) scale(0)', 'opacity:0'
    ].join(';');

    if (product.image_url) {
      const img = document.createElement('img');
      img.src = optimizeImgUrl(product.image_url, 80);
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;';
      particle.appendChild(img);
    } else {
      particle.textContent = productEmoji(product);
    }
    document.body.appendChild(particle);

    // Sparkle trail
    const sparkles = [];
    for (let s = 0; s < 6; s++) {
      const sp = document.createElement('div');
      sp.style.cssText = [
        'position:fixed', 'z-index:9998', 'pointer-events:none',
        'border-radius:50%', 'background:var(--coral)',
        'width:8px', 'height:8px',
        'left:' + startX + 'px', 'top:' + startY + 'px',
        'transform:translate(-50%,-50%)', 'opacity:0'
      ].join(';');
      document.body.appendChild(sp);
      sparkles.push(sp);
    }

    // Phase 1: Pop-in
    particle.getBoundingClientRect();
    particle.style.transition = 'transform 0.35s cubic-bezier(0.34,1.56,0.64,1), opacity 0.2s ease-out';
    particle.style.transform = 'translate(-50%,-50%) scale(1.15)';
    particle.style.opacity = '1';

    // Phase 2: Arc flight
    const duration = 900;
    let startTime = null;

    function animateArc(timestamp) {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const t = Math.min(elapsed / duration, 1);
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const x = startX + (endX - startX) * ease;
      const arcT = 1 - Math.pow(2 * t - 1, 2);
      const y = startY + (endY - startY) * ease - arcT * 120;
      const scale = 1.15 - (0.85 * ease);
      const rot = ease * 360;

      particle.style.transition = 'none';
      particle.style.left = x + 'px';
      particle.style.top = y + 'px';
      particle.style.transform = 'translate(-50%,-50%) scale(' + scale + ') rotate(' + rot + 'deg)';
      particle.style.opacity = String(1 - ease * 0.3);

      for (let i = 0; i < sparkles.length; i++) {
        const delay = i * 0.12;
        const st = Math.max(0, t - delay);
        if (st > 0 && st < 1) {
          const sx = startX + (endX - startX) * st;
          const sArc = 1 - Math.pow(2 * st - 1, 2);
          const sy = startY + (endY - startY) * st - sArc * 120;
          const scatter = (Math.random() - 0.5) * 16;
          sparkles[i].style.transition = 'none';
          sparkles[i].style.left = (sx + scatter) + 'px';
          sparkles[i].style.top = (sy + scatter) + 'px';
          sparkles[i].style.opacity = String(0.8 - st);
          sparkles[i].style.transform = 'translate(-50%,-50%) scale(' + (1 - st * 0.7) + ')';
        }
      }

      if (t < 1) {
        requestAnimationFrame(animateArc);
      } else {
        // Phase 3: Impact
        particle.style.transition = 'transform 0.15s ease-in, opacity 0.15s ease-in';
        particle.style.transform = 'translate(-50%,-50%) scale(0)';
        particle.style.opacity = '0';
        cartIcon.style.transition = 'transform 0.15s ease-out';
        cartIcon.style.transform = 'scale(1.3)';
        setTimeout(() => {
          cartIcon.style.transition = 'transform 0.25s cubic-bezier(0.34,1.56,0.64,1)';
          cartIcon.style.transform = 'scale(1)';
        }, 150);
        setTimeout(() => {
          particle.remove();
          sparkles.forEach(sp => sp.remove());
        }, 200);
        // Badge bump
        dom.cartBadge.classList.remove('bump');
        void dom.cartBadge.offsetWidth;
        dom.cartBadge.classList.add('bump');
      }
    }

    setTimeout(() => requestAnimationFrame(animateArc), 350);
  }

  /* ── ADD TO CART ────────────────────────────────────────── */
  /* ── ADD TO CART ────────────────────────────────────────── */
function addToCart(product, qty, sourceBtn) {
  qty = qty || 1;

  const existing = state.cart.find(i =>
    String(i.product?.id ?? i.id) === String(product.id)
  );

  if (existing) {
    existing.qty += qty;
    if (!existing.product) existing.product = product;
    if (!existing.id) existing.id = product.id;
    if (!existing.name) existing.name = product.name;
    if (existing.price == null) existing.price = product.price_kmf ?? product.price ?? 0;
    if (!existing.image) existing.image = product.image_url || product.image || '';
  } else {
    state.cart.push({
      product: product,
      id: product.id,
      name: product.name,
      price: product.price_kmf ?? product.price ?? 0,
      image: product.image_url || product.image || '',
      qty: qty
    });
  }

  // Fly animation
  if (sourceBtn) {
    flyToCart(sourceBtn, product);
  }

  saveCart();

  const isModalAdd = sourceBtn === dom.addCartBtn;

  // Mark button feedback (grid / rail buttons only)
  if (sourceBtn && !isModalAdd) {
    sourceBtn.classList.add('added');
    sourceBtn.disabled = true;
    setTimeout(() => {
      sourceBtn.classList.remove('added');
      sourceBtn.classList.add('in-cart');
      sourceBtn.disabled = false;
    }, 800);
  }

  // Mark all grid buttons for this product
  markAllCartButtons();

  // Animation "coucou" : la petite dame fait signe
  // On cible LES DEUX dames (header catalogue + topbar modale) pour que
  // l'animation soit toujours visible quel que soit le contexte.
  const cartBtns = [
    document.getElementById('k-cart-btn'),
    document.getElementById('k-modal-cart-btn'),
  ].filter(Boolean);

  cartBtns.forEach(btn => {
    // Ring pulse coral
    btn.classList.remove('ring-pulse');
    void btn.offsetWidth;
    btn.classList.add('ring-pulse');
    setTimeout(() => btn.classList.remove('ring-pulse'), 1500);

    // Animation "coucou" de l'avatar
    btn.classList.remove('avatar-wave');
    void btn.offsetWidth;
    btn.classList.add('avatar-wave');
    setTimeout(() => btn.classList.remove('avatar-wave'), 900);
  });

  if (isModalAdd) {
    // Fix 8 : modal button → "✓ Dans le panier | Voir (N) →"
    setTimeout(() => {
      const count = cartQty();
      dom.addCartBtn.classList.remove('added');
      dom.addCartBtn.classList.add('confirmed');
      dom.addCartBtn.disabled = false;
      dom.addCartBtn.innerHTML = '<span class="k-btn-done">✓ Dans le panier</span><span class="k-btn-sep"> | </span><span class="k-btn-see">Voir (' + count + ') →</span>';
      dom.addCartBtn.onclick = function() { closeModal(); setTimeout(openCart, 150); };
    }, 700);
  } else if (sourceBtn) {
    // Toast de confirmation (grid / rail)
    showToast('✓ ' + (product.name || 'Produit') + ' ajouté', 'success');
  }
}

  function setQty(productId, newQty) {
    const pid = String(productId);
    if (newQty < 1) { removeFromCart(pid); return; }
    
  // Écoute les événements du stepper flottant (module externe long-press)
  document.addEventListener('cart:setqty', function(e) {
    const { pid, qty } = e.detail || {};
    if (pid !== undefined && qty !== undefined) {
      setQty(pid, qty);
    }
  });
const item = state.cart.find(i => String(i.product.id) === pid);
    if (item) {
      item.qty = newQty;
      saveCart();
      // FIX 1.3 : rafraîchit À LA FOIS le panier drawer ET tous les steppers catalogue/suggestions
      if (typeof renderCartBody === 'function') renderCartBody();
      if (typeof markAllCartButtons === 'function') markAllCartButtons();
      if (typeof updateCartBadge === 'function') updateCartBadge();
      renderCartBody();
      markAllCartButtons();
    }
  }

  function markAllCartButtons() {
    // IDs actuellement dans le panier
    const inCartIds = new Set(state.cart.map(i => String(i.product.id)));

    // OPTION C : panier tressé visuel + stepper "− qty +" visible dès ajout
    //            (plus besoin de long-press, le stepper est directement accessible)
    document.querySelectorAll('.k-card-add').forEach(btn => {
      const pid = String(btn.dataset.add);
      if (inCartIds.has(pid)) {
        const item = state.cart.find(i => String(i.product.id) === pid);
        btn.classList.add('in-cart');
        // Stepper compact : − quantité + (tous cliquables indépendamment)
        btn.innerHTML =
          '<span class="k-add-minus" data-pid="' + pid + '">−</span>' +
          '<span class="k-add-qty">' + item.qty + '</span>' +
          '<span class="k-add-plus-ic">+</span>';
      } else {
        // Produit plus dans le panier → remettre juste le "+"
        btn.classList.remove('in-cart');
        btn.innerHTML = '<span class="k-card-add-plus">+</span>';
      }
    });
  }

  /* ── REMOVE FROM CART ───────────────────────────────────── */
  function removeFromCart(productId) {
    const pid = String(productId);
    state.cart = state.cart.filter(i => String(i.product.id) !== pid);
    saveCart();
    renderCartBody();
    markAllCartButtons();
  }

  /* ── QUICK ADD FROM GRID ────────────────────────────────── */
function quickAdd(productId, btnEl) {
  const pid = String(productId);
  const product = state.products.find(p => String(p.id) === pid);

  if (!product) {
    console.warn('[quickAdd] Produit introuvable:', productId);
    return;
  }

  addToCart(product, 1, btnEl);
}

function quickRemove(productId, btnEl) {
    const pid = String(productId);
    const item = state.cart.find(i => String(i.product.id) === pid);
    if (!item) return;
    if (item.qty <= 1) {
      removeFromCart(pid);
    } else {
      setQty(pid, item.qty - 1);
    }
  }

  /* ── TOGGLE FAV ─────────────────────────────────────────── */
  function toggleFav(id, btnEl) {
    const idx = state.favs.indexOf(id);
    if (idx >= 0) {
      state.favs.splice(idx, 1);
      btnEl.classList.remove('liked');
      btnEl.innerHTML = '🤍';
      showToast('Retiré des favoris');
    } else {
      state.favs.push(id);
      btnEl.classList.add('liked');
      btnEl.innerHTML = '❤️';
      btnEl.classList.add('k-pop');
      setTimeout(() => btnEl.classList.remove('k-pop'), 300);
      showToast('❤️ Ajouté aux favoris');
    }
    saveFavs();
  }

  /* ── CATEGORIES ─────────────────────────────────────────── */
  function setupCats() {
    // Split emoji + label pour le layout en carré empilé
    const emojiRx = /^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)\s*/u;
    $$('.k-chip').forEach(chip => {
      const raw = chip.textContent.trim();
      const m = raw.match(emojiRx);
      if (m) {
        const emoji = m[1];
        const label = raw.slice(m[0].length);
        chip.innerHTML =
          `<span class="k-chip-emoji">${emoji}</span>` +
          `<span class="k-chip-label">${label}</span>`;
      }
      chip.addEventListener('click', () => {
        const cat = chip.dataset.cat;

        // ── Mobile pager: scroll to page instead of re-rendering ──
        if (window.innerWidth < 900 && document.getElementById('k-page-scroll') &&
            document.getElementById('k-page-scroll').classList.contains('k-pager-active')) {
          $$('.k-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          centerActiveChip(chip);
          if (cat === 'all') {
            var _g = document.getElementById('k-grid');
            if (_g) _g.scrollTo({ left: 0, behavior: 'smooth' });
          } else {
            _scrollPagerToCat(cat);
          }
          return;
        }

        // ── "Tout" chip ──
        if (cat === 'all') {
          if (state.activeCat === 'all') {
            // Already in Tout → scroll to top
            window.scrollTo({ top: 0, behavior: 'smooth' });
            return;
          }
          // Retour au mode sections
          $$('.k-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          state.activeCat = 'all';
          state.activeSubcat = null;
          state.sectionSubcats = {};
          renderGrid();
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }

        // ── En mode "Tout" (sections) → scroll vers la section ──
        if (state.activeCat === 'all') {
          // Feedback visuel immédiat
          $$('.k-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          centerActiveChip(chip);
          scrollToCategorySection(cat);
          return;
        }

        // ── En mode focalisé : même chip → retour à "Tout" ──
        if (cat === state.activeCat) {
          $$('.k-chip').forEach(c => c.classList.remove('active'));
          const allChip = document.querySelector('.k-chip[data-cat="all"]');
          if (allChip) allChip.classList.add('active');
          state.activeCat = 'all';
          state.activeSubcat = null;
          state.sectionSubcats = {};
          renderGrid();
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }

        // ── En mode focalisé : autre chip → changer de catégorie ──
        $$('.k-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        state.activeCat = cat;
        state.activeSubcat = null;
        renderGrid();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
  }

  /* ── CATEGORY SWIPE NAV (mobile) ────────────────────────── */
  /* Scroll horizontal sur les chips → auto-switch catégorie  */
  /* ── Center active chip on click (Temu-style) ── */
  function centerActiveChip(chip) {
    var catsEl = document.getElementById('k-cats');
    if (!chip || !catsEl || window.innerWidth >= 900) return;
    var left = chip.offsetLeft - (catsEl.clientWidth / 2) + (chip.clientWidth / 2);
    catsEl.scrollTo({ left: left, behavior: 'smooth' });
  }

  function setupCatSwipeNav() {
    if (window.innerWidth > 899) return;
    var catsEl = document.getElementById('k-cats');
    if (!catsEl) return;

    // Center active chip on click
    catsEl.addEventListener('click', function(e) {
      var chip = e.target.closest('.k-chip');
      if (!chip) return;
      requestAnimationFrame(function() { centerActiveChip(chip); });
    });

    // Center active chip on load
    var activeChip = catsEl.querySelector('.k-chip.active');
    if (activeChip) centerActiveChip(activeChip);
    // Scroll horizontal = visuel uniquement, pas de changement auto de catégorie
  }

  /* ── CATALOG SWIPE removed — navigation v2 uses scroll-to-section ── */

    /* ── SEARCH ─────────────────────────────────────────────── */
  function setupSearch() {
    dom.searchInput.addEventListener('input', () => {
      clearTimeout(state.searchTimeout);
      const q = dom.searchInput.value.trim().toLowerCase();
      if (q.length < 2) {
        dom.searchDrop.classList.remove('open');
        state.filtered = [...state.products];
        renderGrid();
        return;
      }
      state.searchTimeout = setTimeout(() => {
        const results = state.products.filter(p =>
          p.name.toLowerCase().includes(q) ||
          (p.category || '').toLowerCase().includes(q) ||
          (p.description || '').toLowerCase().includes(q)
        );
        state.filtered = results;
        renderGrid();
        renderSearchDropdown(results.slice(0, 8));
      }, 250);
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.k-search')) dom.searchDrop.classList.remove('open');
    });
  }

  function renderSearchDropdown(results) {
    if (!results.length) {
      dom.searchDrop.innerHTML = '<div class="k-search-empty">Aucun résultat</div>';
      dom.searchDrop.classList.add('open');
      return;
    }
    dom.searchDrop.innerHTML = results.map(p => `
      <div class="k-search-item" data-id="${p.id}">
        <img src="${optimizeImgUrl(p.image_url, 80)}" alt="${p.name}" loading="lazy">
        <div class="k-search-item-info">
          <div class="k-search-item-name">${p.emoji || ''} ${p.name}</div>
          <div class="k-search-item-price">${fmtPrice(p.price_kmf)}</div>
        </div>
      </div>
    `).join('');
    dom.searchDrop.classList.add('open');

    dom.searchDrop.querySelectorAll('.k-search-item').forEach(item => {
      item.addEventListener('click', () => {
        openModal(item.dataset.id);
        dom.searchDrop.classList.remove('open');
        dom.searchInput.value = '';
      });
    });
  }

  /* ── PRODUCT MODAL — Carousel (Temu-style with Komerce spirit) ────── */

  // Build carousel slides dynamically (1 or N images)
  function buildCarouselSlides(product) {
    var track = dom.modalCarouselTrack;
    var dots = dom.modalDots;
    var images = product.images || [product.image_url];

    track.innerHTML = '';
    images.forEach(function(url, i) {
      var img = document.createElement('img');
      img.className = 'k-modal-slide';
      img.src = optimizeImgUrl(url, 600);
      img.alt = product.name || '';
      img.draggable = false;
      track.appendChild(img);
    });
    dom.modalImg = track.querySelector('.k-modal-slide');

    dots.innerHTML = '';
    if (images.length > 1) {
      images.forEach(function(_, i) {
        var dot = document.createElement('span');
        dot.className = 'k-modal-dot' + (i === 0 ? ' is-active' : '');
        dot.addEventListener('click', function() { goToSlide(i); });
        dots.appendChild(dot);
      });
    }

    state.carouselIndex = 0;
    state.carouselCount = images.length;
    track.style.transition = 'none';
    track.style.transform = 'translateX(0)';
  }

  // Navigate to a specific slide
  function goToSlide(index) {
    if (index < 0 || index >= state.carouselCount) return;
    state.carouselIndex = index;
    var track = dom.modalCarouselTrack;
    track.style.transition = 'transform .3s cubic-bezier(.22,1,.36,1)';
    track.style.transform = 'translateX(-' + (index * 100) + '%)';
    var allDots = dom.modalDots.querySelectorAll('.k-modal-dot');
    allDots.forEach(function(d, i) {
      d.classList.toggle('is-active', i === index);
    });
  }

  function openModal(id, pushHistory) {
    const product = state.products.find(p => p.id === id);
    if (!product) return;

    // Mémoriser la position de scroll du catalogue pour y revenir à la fermeture
    if (!dom.modalOverlay.classList.contains('open')) {
      state._savedCatalogScrollY = window.scrollY;
    }

    if (pushHistory !== false && state.modalProduct) {
      state.modalHistory.push(state.modalProduct.id);
    }

    state.modalProduct = product;
    state.modalQty = 1;

    // Fix 1+2: reset "Ajouter" button — disabled, classes, confirmed state
    if (dom.addCartBtn) {
      dom.addCartBtn.disabled = false;
      dom.addCartBtn.onclick = null;
      if (dom.addCartBtn.classList.contains('confirmed') || dom.addCartBtn.querySelector('.k-btn-done')) {
        dom.addCartBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg> Ajouter au panier';
      }
      dom.addCartBtn.classList.remove('added', 'in-cart', 'confirmed');
    }

    buildCarouselSlides(product);
    dom.modalName.textContent = product.name;
    dom.modalDesc.textContent = product.description || '';
    dom.modalPrice.textContent = fmtPrice(product.price_kmf);
    dom.modalQtyVal.textContent = '1';

    if (product.promo_pct) {
      const old = Math.round(product.price_kmf / (1 - product.promo_pct / 100));
      dom.modalOldPrice.textContent = fmtPrice(old);
      dom.modalOldPrice.classList.remove('u-hidden');
      dom.modalPromoBadge.textContent = `-${product.promo_pct}%`;
      dom.modalPromoBadge.classList.add('show');
    } else {
      dom.modalOldPrice.classList.add('u-hidden');
      dom.modalPromoBadge.classList.remove('show');
    }

    dom.modalCat.textContent = `${product.emoji || ''} ${product.category || ''}`;
    // Affichage stock intelligent : 3 états seulement
    // - Stock > 10 : "✓ Disponible"
    // - Stock 1-10 : "🔥 Plus que X en stock !"
    // - Stock 0 : "✗ Rupture"
    const stockVal = Number(product.stock || 0);
    if (stockVal === 0) {
      dom.modalStock.textContent = '✗ Rupture';
      dom.modalStock.className = 'k-modal-stock k-modal-stock--out';
    } else if (stockVal <= 10) {
      dom.modalStock.textContent = '🔥 Plus que ' + stockVal + ' en stock';
      dom.modalStock.className = 'k-modal-stock k-modal-stock--low';
    } else {
      dom.modalStock.textContent = '✓ Disponible';
      dom.modalStock.className = 'k-modal-stock k-modal-stock--ok';
    }
    dom.modalBackLabel.textContent = state.modalHistory.length > 0 ? 'Retour' : 'Catalogue';
    updateCartBadge();

    // Compteur de position dans la liste + boutons ← →
    const list = state.filtered.length ? state.filtered : state.products;
    const currentIdx = list.findIndex(p => p.id === product.id);
    updateModalNavArrows(list, currentIdx);

    // Séparer clairement : même catégorie (jusqu'à 8) puis autres (jusqu'à 12)
    const sameCat = state.products
      .filter(p => p.category === product.category && p.id !== product.id)
      .slice(0, 10);
    const otherCat = state.products
      .filter(p => p.category !== product.category && p.id !== product.id)
      .sort(() => Math.random() - 0.5)
      .slice(0, 16);
    console.log('[KMRC SUG] calling with sameCat=' + sameCat.length + ' otherCat=' + otherCat.length + ' cat=' + product.category);
    renderSuggestions(sameCat, otherCat, product.category);

    if (dom.modalDetails) dom.modalDetails.scrollTop = 0;
    const _scrollEl = document.querySelector('.k-modal-scroll');
    if (_scrollEl) _scrollEl.scrollTop = 0;
    dom.modalOverlay.classList.add('open');
    // Lock body scroll — CSS handles layout via body.modal-open
    state._savedCatalogScrollY = window.scrollY;
    document.body.style.setProperty('--modal-scroll-y', `-${state._savedCatalogScrollY}px`);
    document.body.classList.add('modal-open');

    // ── Déplacer les actions DANS le scroll pour un flux unifié ──
    const modalScroll = document.querySelector('.k-modal-scroll');
    const modalActions = document.querySelector('.k-modal-actions');
    if (modalScroll && modalActions && modalActions.parentElement !== modalScroll) {
      modalScroll.appendChild(modalActions);
    }

    // ── FAB flottant : apparaît quand les vrais boutons sortent du viewport ──
    setupModalFAB();
  }

  /* ── TOPBAR ENRICHIE : produit visible quand on scroll ── */
  function setupModalFAB() {
    // Nouvelle version : topbar enrichie au lieu d'un FAB
    setupEnrichedTopbar();
  }

  function scrollModalToTop() {
    const scrollEl = document.querySelector('.k-modal-scroll');
    if (scrollEl) {
      scrollEl.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function setupEnrichedTopbar() {
    const modal = document.getElementById('k-modal');
    const topbar = modal ? modal.querySelector('.k-modal-topbar') : null;
    const product = state.modalProduct;
    if (!topbar || !product) return;

    // 1. Créer le bloc produit dans la topbar s'il n'existe pas encore
    let productEl = topbar.querySelector('.k-modal-topbar-product');
    if (!productEl) {
      productEl = document.createElement('div');
      productEl.className = 'k-modal-topbar-product';
      productEl.innerHTML = `
        <div class="k-topbar-thumb" role="button" aria-label="Revenir en haut">
          <img class="k-topbar-thumb-img" src="" alt="">
        </div>
        <div class="k-topbar-info">
          <div class="k-topbar-name"></div>
          <div class="k-topbar-price">
            <span class="k-topbar-price-val"></span>
            <span class="k-topbar-price-promo u-hidden"></span>
          </div>
        </div>
        <button class="k-topbar-buy" aria-label="Acheter">⚡ Acheter</button>
      `;
      // Insérer avant .k-modal-topbar-right
      const rightBar = topbar.querySelector('.k-modal-topbar-right');
      if (rightBar) {
        topbar.insertBefore(productEl, rightBar);
      } else {
        topbar.appendChild(productEl);
      }

      // Wire click sur Acheter
      productEl.querySelector('.k-topbar-buy').addEventListener('click', () => {
        const buyBtn = document.getElementById('k-buy-now-btn');
        if (buyBtn) buyBtn.click();
      });

      // Wire click sur thumbnail → scroll smooth vers le haut
      productEl.querySelector('.k-topbar-thumb').addEventListener('click', () => {
        scrollModalToTop();
      });
    }

    // Créer le FAB "retour en haut" s'il n'existe pas
    let backTopFab = document.getElementById('k-modal-back-top');
    if (!backTopFab) {
      backTopFab = document.createElement('button');
      backTopFab.id = 'k-modal-back-top';
      backTopFab.className = 'k-modal-back-top';
      backTopFab.setAttribute('aria-label', 'Retour au produit');
      backTopFab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>';
      document.body.appendChild(backTopFab);
      backTopFab.addEventListener('click', () => {
        scrollModalToTop();
      });
    }

    // 2. Mettre à jour le contenu avec le produit actuel
    const thumb = productEl.querySelector('.k-topbar-thumb-img');
    const name = productEl.querySelector('.k-topbar-name');
    const priceVal = productEl.querySelector('.k-topbar-price-val');
    const pricePromo = productEl.querySelector('.k-topbar-price-promo');
    if (thumb) thumb.src = optimizeImgUrl(product.image_url, 80);
    if (name) name.textContent = product.name || '';
    if (priceVal) priceVal.textContent = fmtPrice(product.price_kmf);
    if (pricePromo) {
      if (product.promo_pct && product.promo_pct > 0) {
        pricePromo.textContent = '-' + product.promo_pct + '%';
        pricePromo.classList.remove('u-hidden');
      } else {
        pricePromo.classList.add('u-hidden');
      }
    }

    // 3. Observer le scroll : toggle .is-scrolled sur .k-modal
    // Créer un sentinel élément en haut du scroll
    const scrollEl = document.querySelector('.k-modal-scroll');
    if (!scrollEl) return;

    if (state._topbarObserver) state._topbarObserver.disconnect();

    // On observe l'image wrap : dès qu'elle n'est quasi plus visible → scrolled
    const imgWrap = scrollEl.querySelector('.k-modal-img-wrap');
    if (imgWrap && 'IntersectionObserver' in window) {
      state._topbarObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach(entry => {
            const backTopFab = document.getElementById('k-modal-back-top');
            if (entry.intersectionRatio < 0.3) {
              modal.classList.add('is-scrolled');
              if (backTopFab) backTopFab.classList.add('visible');
            } else {
              modal.classList.remove('is-scrolled');
              if (backTopFab) backTopFab.classList.remove('visible');
            }
          });
        },
        { root: scrollEl, threshold: [0, 0.3, 0.7, 1] }
      );
      state._topbarObserver.observe(imgWrap);
    }
  }

  function hideModalFAB() {
    // Reset topbar mode
    const modal = document.getElementById('k-modal');
    if (modal) modal.classList.remove('is-scrolled');
    // Cacher le FAB back-to-top
    const backTopFab = document.getElementById('k-modal-back-top');
    if (backTopFab) backTopFab.classList.remove('visible');
    // Cleanup observers
    if (state._fabObserver) {
      state._fabObserver.disconnect();
      state._fabObserver = null;
    }
    if (state._topbarObserver) {
      state._topbarObserver.disconnect();
      state._topbarObserver = null;
    }
    // Hide legacy FAB if present
    const fab = document.getElementById('k-modal-fab');
    if (fab) fab.classList.remove('visible');
  }

  // ── Boutons ← → dans la topbar de la modal
  function updateModalNavArrows(list, currentIdx) {
    let navEl = document.getElementById('k-modal-nav');
    if (!navEl) {
      navEl = document.createElement('div');
      navEl.id = 'k-modal-nav';
      // Styles in CSS: #k-modal-nav

      const prevBtn = document.createElement('button');
      prevBtn.id = 'k-modal-prev';
      prevBtn.className = 'k-modal-nav-btn';
      prevBtn.innerHTML = '←';
      prevBtn.addEventListener('click', () => navigateModal(-1));

      const counter = document.createElement('span');
      counter.id = 'k-modal-counter';
      counter.className = 'k-modal-nav-counter';

      const nextBtn = document.createElement('button');
      nextBtn.id = 'k-modal-next';
      nextBtn.className = 'k-modal-nav-btn';
      nextBtn.innerHTML = '→';
      nextBtn.addEventListener('click', () => navigateModal(1));

      navEl.appendChild(prevBtn);
      navEl.appendChild(counter);
      navEl.appendChild(nextBtn);

      // Insérer dans la topbar à droite du bouton back
      const topbar = dom.modal.querySelector('.k-modal-topbar');
      if (topbar) {
        const right = topbar.querySelector('.k-modal-topbar-right');
        topbar.insertBefore(navEl, right);
      }
    }

    const counter = document.getElementById('k-modal-counter');
    const prevBtn = document.getElementById('k-modal-prev');
    const nextBtn = document.getElementById('k-modal-next');

    if (counter) counter.textContent = `${currentIdx + 1}/${list.length}`;
    if (prevBtn) prevBtn.classList.toggle('is-disabled', currentIdx <= 0);
    if (nextBtn) nextBtn.classList.toggle('is-disabled', currentIdx >= list.length - 1);
  }

  function modalGoBack() {
    if (state.modalHistory.length === 0) { closeModal(); return; }
    const prevId = state.modalHistory.pop();
    openModal(prevId, false);
  }

  function closeModal() {
    hideModalFAB();
    dom.modalOverlay.classList.remove('open');
    // Unlock body scroll — CSS class drives layout
    const scrollY = state._savedCatalogScrollY || 0;
    document.body.classList.remove('modal-open');
    document.body.style.removeProperty('--modal-scroll-y');
    window.scrollTo(0, scrollY);
    state.modalProduct = null;
    state.modalHistory = [];
  }

  function renderSuggestions(sameCat, otherCat, categoryName) {
    console.log('[KMRC SUG] called with', {sameCat: sameCat?.length, otherCat: otherCat?.length, cat: categoryName});
    sameCat = sameCat || [];
    otherCat = otherCat || [];
    const sugSection = document.getElementById('k-modal-suggestions');
    console.log('[KMRC SUG] sugSection found:', !!sugSection);
    if (!sugSection) return;

    if (sameCat.length === 0 && otherCat.length === 0) {
      console.log('[KMRC SUG] HIDING (both empty)');
      sugSection.classList.add('u-hidden');
      return;
    }
    sugSection.classList.remove('u-hidden');
    console.log('[KMRC SUG] rendering', sameCat.length + otherCat.length, 'products');

    // Template carte suggestion — stepper −/qty/+ en bas
    const cardHTML = (p) => {
      const inCart = state.cart.find(i => String(i.product.id) === String(p.id));
      const qty = inCart ? inCart.qty : 0;
      return `
      <div class="k-sug-card" data-id="${p.id}">
        <div class="k-sug-card-img">
          <img src="${optimizeImgUrl(p.image_url, 200)}" alt="${sanitize(p.name)}" loading="lazy">
          ${p.promo_pct ? `<span class="k-sug-promo-badge">-${p.promo_pct}%</span>` : ''}
        </div>
        <div class="k-sug-card-name">${sanitize(p.name)}</div>
        <div class="k-sug-card-price">${fmtPrice(p.price_kmf)}</div>
        <div class="k-sug-card-actions">
          ${qty > 0
            ? `<button class="k-sug-step k-sug-minus" data-pid="${p.id}">−</button><span class="k-sug-qty">${qty}</span><button class="k-sug-step k-sug-plus" data-pid="${p.id}">+</button>`
            : `<button class="k-sug-add" data-add="${p.id}">+ Ajouter</button>`
          }
        </div>
      </div>`;
    };

    // Construire 2 sections distinctes avec titres contextuels
    let html = '';

    if (sameCat.length > 0) {
      const catLabel = categoryName ? categoryName.toLowerCase() : 'même catégorie';
      html += `
        <div class="k-sug-section">
          <div class="k-sug-title">
            <span class="k-sug-title-icon">🔍</span>
            <span class="k-sug-title-text">Dans la catégorie ${sanitize(catLabel)}</span>
          </div>
          <div class="k-sug-grid k-sug-grid--same">${sameCat.map(cardHTML).join('')}</div>
        </div>`;
    }

    if (otherCat.length > 0) {
      html += `
        <div class="k-sug-section">
          <div class="k-sug-title">
            <span class="k-sug-title-icon">✨</span>
            <span class="k-sug-title-text">Vous aimerez peut-être aussi</span>
          </div>
          <div class="k-sug-grid k-sug-grid--other">${otherCat.map(cardHTML).join('')}</div>
        </div>`;
    }

    // Replacer tout le contenu (remplace le vieux <div class="k-sug-rail">)
    dom.sugRail.innerHTML = html;
    // Masquer l'ancien h3 générique "Vous aimerez aussi" s'il existe
    const oldH3 = sugSection.querySelector('h3');
    if (oldH3) oldH3.style.display = 'none';

    // Clic sur toute la carte → ouvrir le produit
    dom.sugRail.querySelectorAll('.k-sug-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.k-sug-add') || e.target.closest('.k-sug-step')) return;
        openModal(card.dataset.id);
      });
    });

    // Bouton "Ajouter" (pas encore dans le panier)
    dom.sugRail.querySelectorAll('.k-sug-add').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const product = state.products.find(p => p.id === btn.dataset.add);
        if (!product) return;
        addToCart(product, 1, btn);
        // Re-render les suggestions pour afficher le stepper
        if (state.modalProduct) {
          const mp = state.modalProduct;
          const sameCat = state.products.filter(p => p.category === mp.category && p.id !== mp.id).slice(0, 10);
          const otherCat = state.products.filter(p => p.category !== mp.category).slice(0, 10);
          renderSuggestions(sameCat, otherCat, mp.category);
        }
      });
    });

    // Stepper −/+ (déjà dans le panier)
    dom.sugRail.querySelectorAll('.k-sug-minus').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        quickRemove(btn.dataset.pid, btn);
        // Re-render
        if (state.modalProduct) {
          const mp = state.modalProduct;
          const sameCat = state.products.filter(p => p.category === mp.category && p.id !== mp.id).slice(0, 10);
          const otherCat = state.products.filter(p => p.category !== mp.category).slice(0, 10);
          renderSuggestions(sameCat, otherCat, mp.category);
        }
      });
    });
    dom.sugRail.querySelectorAll('.k-sug-plus').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        quickAdd(btn.dataset.pid, btn);
        if (state.modalProduct) {
          const mp = state.modalProduct;
          const sameCat = state.products.filter(p => p.category === mp.category && p.id !== mp.id).slice(0, 10);
          const otherCat = state.products.filter(p => p.category !== mp.category).slice(0, 10);
          renderSuggestions(sameCat, otherCat, mp.category);
        }
      });
    });
  }

  function setupModal() {
    dom.modalBack.addEventListener('click', modalGoBack);
    dom.modalClose.addEventListener('click', closeModal);
    dom.modalCartBtn.addEventListener('click', () => {
      closeModal();
      setTimeout(openCart, 150);
    });
    dom.modalOverlay.addEventListener('click', (e) => {
      if (e.target === dom.modalOverlay) closeModal();
    });

    dom.qtyMinus.addEventListener('click', () => {
      if (state.modalQty > 1) { state.modalQty--; dom.modalQtyVal.textContent = state.modalQty; }
    });
    dom.qtyPlus.addEventListener('click', () => {
      state.modalQty++;
      dom.modalQtyVal.textContent = state.modalQty;
    });

    dom.addCartBtn.addEventListener('click', () => {
      if (!state.modalProduct || dom.addCartBtn.disabled || dom.addCartBtn.classList.contains('confirmed')) return;
      addToCart(state.modalProduct, state.modalQty, dom.addCartBtn);
    });

    // ── Bouton "⚡ Acheter" — ajout + transition douce vers le panier
    const buyNowBtn = document.getElementById('k-buy-now-btn');
    if (buyNowBtn) {
      buyNowBtn.addEventListener('click', () => {
        if (!state.modalProduct) return;

        // 1. Feedback visuel immédiat : bouton se transforme en "✓ Ajouté !"
        const originalContent = buyNowBtn.innerHTML;
        buyNowBtn.innerHTML = '<span style="display:flex;align-items:center;gap:8px;justify-content:center"><span>✓</span><span>Ajouté au panier !</span></span>';
        buyNowBtn.disabled = true;
        buyNowBtn.classList.add('buy-confirmed');

        // 2. Ajout au panier (déclenche l'animation coucou de la dame)
        addToCart(state.modalProduct, state.modalQty, buyNowBtn);

        // 3. Transition ÉTENDUE : 1200ms pour voir le feedback + coucou dame
        //    puis fermeture douce et ouverture panier avec 400ms entre les 2
        //    (le user a le temps de voir le confirm vert + la dame coucou)
        setTimeout(() => {
          // Restaurer le bouton pour la prochaine ouverture
          buyNowBtn.innerHTML = originalContent;
          buyNowBtn.disabled = false;
          buyNowBtn.classList.remove('buy-confirmed');
          // Fermer la modale et ouvrir le panier avec fluidité
          closeModal();
          setTimeout(openCart, 400);  // augmenté de 250 → 400ms
        }, 1200);  // augmenté de 800 → 1200ms
      });
    }

    // ── Image zone: carousel swipe + pull-to-close (Temu-style)
    setupImageZoneTouch();

    // ── Navigation clavier ← → entre produits (desktop)
    document.addEventListener('keydown', (e) => {
      if (!dom.modalOverlay.classList.contains('open')) return;
      if (e.key === 'ArrowRight') navigateModal(1);
      if (e.key === 'ArrowLeft') navigateModal(-1);
      if (e.key === 'Escape') closeModal();
    });
  }

  // ── Image zone: swipe ↔ carousel + swipe ↓ close (Temu-style) ──
  // Details zone: native ↕ scroll only — no gesture interference
  function setupImageZoneTouch() {
    var imgWrap = dom.modal.querySelector('.k-modal-img-wrap');
    var track = dom.modalCarouselTrack;
    var modal = dom.modal;
    var startX, startY, isDragging, direction; // 'h' | 'v' | null

    imgWrap.addEventListener('touchstart', function(e) {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      isDragging = true;
      direction = null;
    }, { passive: true });

    imgWrap.addEventListener('touchmove', function(e) {
      if (!isDragging) return;
      var dx = e.touches[0].clientX - startX;
      var dy = e.touches[0].clientY - startY;

      // Lock direction on first 8px movement
      if (!direction && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
        direction = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
      }

      // Horizontal → carousel (only if multi-image)
      if (direction === 'h' && state.carouselCount > 1) {
        e.preventDefault();
        track.style.transition = 'none';
        var offset = -state.carouselIndex * 100 + (dx / imgWrap.offsetWidth) * 100;
        track.style.transform = 'translateX(' + offset + '%)';
      }
      // Vertical down → pull-to-close
      else if (direction === 'v' && dy > 0) {
        modal.style.transform = 'translateY(' + (dy * 0.4) + 'px)';
        modal.style.transition = 'none';
        modal.style.opacity = String(Math.max(0.6, 1 - dy / 500));
      }
    }, { passive: false });

    imgWrap.addEventListener('touchend', function(e) {
      if (!isDragging) return;
      isDragging = false;
      var dx = e.changedTouches[0].clientX - startX;
      var dy = e.changedTouches[0].clientY - startY;

      if (direction === 'h' && state.carouselCount > 1) {
        // Carousel snap
        if (dx < -40 && state.carouselIndex < state.carouselCount - 1) {
          goToSlide(state.carouselIndex + 1);
        } else if (dx > 40 && state.carouselIndex > 0) {
          goToSlide(state.carouselIndex - 1);
        } else {
          goToSlide(state.carouselIndex); // snap back
        }
      } else if (direction === 'v') {
        modal.style.transition = 'transform .25s var(--ease), opacity .25s';
        modal.style.opacity = '';
        if (dy > 100) {
          modal.style.transform = 'translateY(100%)';
          setTimeout(function() { modal.style.transform = ''; closeModal(); }, 260);
        } else {
          modal.style.transform = '';
        }
      }
    });
  }

  // ── Navigation ← → entre produits dans la modal
  function navigateModal(direction) {
    if (!state.modalProduct) return;
    const list = state.filtered.length ? state.filtered : state.products;
    const currentIdx = list.findIndex(p => p.id === state.modalProduct.id);
    if (currentIdx === -1) return;
    const nextIdx = currentIdx + direction;
    if (nextIdx < 0 || nextIdx >= list.length) return;

    const scrollEl = dom.modal.querySelector('.k-modal-scroll');
    if (scrollEl) {
      scrollEl.style.transition = 'opacity .12s, transform .12s';
      scrollEl.style.opacity = '0';
      scrollEl.style.transform = `translateX(${direction > 0 ? '-24px' : '24px'})`;
      setTimeout(() => {
        openModal(list[nextIdx].id, false);
        scrollEl.style.transition = 'none';
        scrollEl.style.opacity = '0';
        scrollEl.style.transform = `translateX(${direction > 0 ? '24px' : '-24px'})`;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          scrollEl.style.transition = 'opacity .18s, transform .18s';
          scrollEl.style.opacity = '1';
          scrollEl.style.transform = 'translateX(0)';
        }));
      }, 130);
    } else {
      openModal(list[nextIdx].id, false);
    }
  }

  /* ══════════════════════════════════════════════════════════
     CART DRAWER — Full mechanism
     ══════════════════════════════════════════════════════════ */

  function openCart() {
    renderCartBody();
    dom.cartHeaderTitle.textContent = 'Mon Panier (' + cartQty() + ')';
    dom.cartOverlay.classList.add('open');
    dom.cartDrawer.classList.add('open');
    window._savedScrollY = window.scrollY;
    document.body.classList.add('cart-open');
  }

  function closeCart() {
    dom.cartOverlay.classList.remove('open');
    dom.cartDrawer.classList.remove('open');
    document.body.classList.remove('cart-open');
    document.body.classList.remove('cart-empty');
    if (typeof window._savedScrollY === 'number') {
      window.scrollTo(0, window._savedScrollY);
      window._savedScrollY = 0;
    }
  }

  function openCartWithHighlight(productId) {
    renderCartBody(productId);
    // Celebrating header
    dom.cartHeader.classList.add('celebrating');
    dom.cartHeaderTitle.textContent = '🎊 C\'est dans le panier !';
    setTimeout(() => {
      dom.cartHeader.classList.remove('celebrating');
      dom.cartHeaderTitle.textContent = 'Mon Panier (' + cartQty() + ')';
    }, 2400);

    dom.cartOverlay.classList.add('open');
    dom.cartDrawer.classList.add('open');
    window._savedScrollY = window.scrollY;
    document.body.classList.add('cart-open');

    setTimeout(() => {
      const newItem = dom.cartBody.querySelector('.k-cart-item.new-item');
      if (newItem) newItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 120);
  }

  function renderCartBody(highlightId) {
    dom.cartBody.innerHTML = '';

    // FIX UX : marquer le body avec 'cart-empty' si panier vide
    // → permet au CSS de garder la bnav visible pour naviguer
    if (state.cart.length === 0) {
      document.body.classList.add('cart-empty');
    } else {
      document.body.classList.remove('cart-empty');
    }

    if (state.cart.length === 0) {
      dom.cartBody.innerHTML = `
        <div class="k-cart-empty">
          <div class="k-cart-empty-icon">🧺</div>
          <p class="k-cart-empty-title">Votre panier est vide</p>
          <p class="k-cart-empty-sub">Découvrez notre sélection de produits livrés aux Comores.</p>
          <button type="button" class="k-cart-empty-cta" id="k-cart-empty-shop">
            🛍️ Découvrir la boutique
          </button>
        </div>`;
      dom.cartFooter.classList.add('u-hidden');

      // Binding bouton découvrir
      const shopBtn = document.getElementById('k-cart-empty-shop');
      if (shopBtn) {
        shopBtn.addEventListener('click', () => {
          closeCart();
          if (typeof switchView === 'function') switchView('shop');
          // Marquer l'onglet Boutique actif dans la bnav
          document.querySelectorAll('.k-bnav-item').forEach(i => i.classList.remove('active'));
          const shopNav = document.querySelector('.k-bnav-item[data-tab="shop"]');
          if (shopNav) shopNav.classList.add('active');
        });
      }
      return;
    }

    state.cart.forEach(item => {
      const p = item.product;
      const unitKmf = p.price_kmf || 0;
      const isNew = highlightId && String(p.id) === String(highlightId);

      const row = document.createElement('div');
      row.className = 'k-cart-item' + (isNew ? ' new-item' : '');
      row.dataset.pid = String(p.id);

      // Image
      const imgBox = document.createElement('div');
      imgBox.className = 'k-cart-item-img';
      if (p.image_url) {
        const img = document.createElement('img');
        img.src = optimizeImgUrl(p.image_url, 100);
        img.alt = p.name || '';
        img.loading = 'lazy';
        imgBox.appendChild(img);
      } else {
        imgBox.textContent = productEmoji(p);
      }
      row.appendChild(imgBox);

      // Info
      const info = document.createElement('div');
      info.className = 'k-cart-item-info';

      const name = document.createElement('div');
      name.className = 'k-cart-item-name';
      name.textContent = p.name || 'Produit';
      info.appendChild(name);

      if (item.qty > 1) {
        const unitLine = document.createElement('div');
        unitLine.className = 'k-cart-item-unit';
        unitLine.textContent = fmt(unitKmf, 'KMF') + ' × ' + item.qty;
        info.appendChild(unitLine);
      }

      const price = document.createElement('div');
      price.className = 'k-cart-item-price';
      price.textContent = fmt(unitKmf * item.qty, 'KMF');
      info.appendChild(price);

      // Qty controls
      const qtyRow = document.createElement('div');
      qtyRow.className = 'k-cart-item-qty';

      const minusBtn = document.createElement('button');
      minusBtn.className = 'k-qty-btn';
      minusBtn.textContent = '−';
      minusBtn.addEventListener('click', () => setQty(p.id, item.qty - 1));
      qtyRow.appendChild(minusBtn);

      const qtyVal = document.createElement('span');
      qtyVal.className = 'k-qty-val';
      qtyVal.textContent = item.qty;
      qtyRow.appendChild(qtyVal);

      const plusBtn = document.createElement('button');
      plusBtn.className = 'k-qty-btn';
      plusBtn.textContent = '+';
      plusBtn.addEventListener('click', () => setQty(p.id, item.qty + 1));
      qtyRow.appendChild(plusBtn);

      info.appendChild(qtyRow);

      // Ajouté badge
      if (isNew) {
        const badge = document.createElement('span');
        badge.className = 'k-cart-item-badge';
        badge.textContent = '✨ Ajouté';
        info.appendChild(badge);
      }

      row.appendChild(info);

      // Remove button
      const removeBtn = document.createElement('button');
      removeBtn.className = 'k-cart-item-remove';
      removeBtn.textContent = '✕';
      removeBtn.title = 'Retirer';
      removeBtn.addEventListener('click', () => removeFromCart(p.id));
      row.appendChild(removeBtn);

      dom.cartBody.appendChild(row);
    });

    // Footer
    dom.cartFooter.classList.remove('u-hidden');
    const qty = cartQty();
    const total = cartTotal();

    // Récap détaillé : nombre d'articles + sous-total
    const itemCountEl = document.getElementById('k-cart-item-count');
    const itemPluralEl = document.getElementById('k-cart-item-plural');
    const subtotalEl = document.getElementById('k-cart-subtotal-val');
    if (itemCountEl) itemCountEl.textContent = qty;
    if (itemPluralEl) itemPluralEl.textContent = qty > 1 ? 's' : '';
    if (subtotalEl) subtotalEl.textContent = fmt(total, 'KMF');

    // Total
    dom.cartTotalVal.textContent = fmt(total, 'KMF');
    if (_currency === 'EUR') {
      dom.cartTotalConv.textContent = '≈ ' + fmt(total, 'EUR');
    } else {
      dom.cartTotalConv.textContent = '';
    }
  }

  /* ── SHARE CART WHATSAPP ────────────────────────────────── */
  /* ── SHARED CART — API v2 ──────────────────────────────────── */

  async function buildCartShareURL() {
    // Appel API → POST /api/shares → retourne share_url courte
    const items = state.cart.map(function(item) {
      return { product_id: item.product.id, qty: item.qty };
    });
    const res = await apiPost('/api/shares', { items: items });
    if (res && res.share_url) return res.share_url;
    throw new Error('share_url manquante');
  }

  function _buildFallbackCartURL() {
    // Fallback legacy URL si l'API échoue
    const items = state.cart.map(function(item) {
      return item.product.id + ':' + item.qty;
    });
    return window.location.origin + '/Komerce_Boutique.html?cart=' + encodeURIComponent(items.join(','));
  }

  async function shareCartWhatsApp() {
    if (state.cart.length === 0) { showToast('Votre panier est vide.', 'error'); return; }

    showToast('⏳ Génération du lien…', 'info');
    var cartURL;
    try {
      cartURL = await buildCartShareURL();
    } catch(e) {
      console.warn('share API error, using fallback URL:', e);
      cartURL = _buildFallbackCartURL();
    }

    var lines = [];
    lines.push('🧺 *Mon panier Komerce*');
    lines.push('━━━━━━━━━━━━━━━━');
    lines.push('');

    state.cart.forEach(function(item, idx) {
      var name = item.product.name || 'Produit';
      var priceKMF = (item.product.price_kmf || 0) * item.qty;
      var line = (idx + 1) + '. ' + name;
      if (item.qty > 1) line += ' x' + item.qty;
      line += ' — ' + fmt(priceKMF, 'KMF');
      lines.push(line);
    });

    lines.push('');
    lines.push('━━━━━━━━━━━━━━━━');
    lines.push('💰 *Total : ' + fmt(cartTotal(), 'KMF') + '* (≈ ' + fmt(cartTotal(), 'EUR') + ')');
    lines.push('📦 Livraison incluse · 3-5 semaines');
    lines.push('');
    lines.push('👉 Voir le panier et commander :');
    lines.push(cartURL);

    var msg = lines.join('\n');
    window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
  }

  /* ── AUTO-POPULATE CART FROM SHARED URL ──────────────────── */
  function loadSharedCart() {
    var params = new URLSearchParams(window.location.search);

    // Nouveau : ?share=token → API
    var shareToken = params.get('share');
    if (shareToken) {
      state.shareToken = shareToken;
      _loadSharedCartFromAPI(shareToken);
      return;
    }

    // Legacy : ?cart=id1:qty1,id2:qty2
    var cartParam = params.get('cart');
    if (!cartParam) return;

    var entries = cartParam.split(',').map(function(e) {
      var parts = e.split(':');
      return { id: parts[0], qty: parseInt(parts[1]) || 1 };
    }).filter(function(e) { return e.id; });

    if (entries.length === 0) return;

    var checkProducts = setInterval(function() {
      if (!state.products || state.products.length === 0) return;
      clearInterval(checkProducts);

      state.cart = [];
      entries.forEach(function(entry) {
        var product = state.products.find(function(p) { return p.id === entry.id; });
        if (product) state.cart.push({ product: product, qty: entry.qty });
      });

      if (state.cart.length > 0) {
        saveCart();
        renderCartBody();
        setTimeout(function() {
          dom.cartDrawer.classList.add('open');
          dom.cartOverlay.classList.add('open');
          document.body.classList.add('cart-open');
          showToast('🧺 Panier partagé chargé ! ' + state.cart.length + ' article(s)', 'success');
        }, 500);
      }
      window.history.replaceState({}, '', window.location.pathname);
    }, 200);
    setTimeout(function() { clearInterval(checkProducts); }, 10000);
  }

  async function _loadSharedCartFromAPI(token) {
    // GET /api/shares/:token → { sharer_name, items:[{product_id,qty,product:{...}}] }
    try {
      const data = await apiGet('/api/shares/' + encodeURIComponent(token));

      var checkProducts = setInterval(function() {
        if (!state.products || state.products.length === 0) return;
        clearInterval(checkProducts);

        state.cart = [];
        var items = data.items || data.cart_items || [];
        items.forEach(function(item) {
          // Le back peut retourner product_id ou product.id
          var pid = item.product_id || (item.product && item.product.id);
          var product = state.products.find(function(p) { return p.id === pid; });
          if (product) state.cart.push({ product: product, qty: item.qty || 1 });
        });

        if (state.cart.length > 0) {
          saveCart();
          renderCartBody();
          setTimeout(function() {
            dom.cartDrawer.classList.add('open');
            dom.cartOverlay.classList.add('open');
            document.body.classList.add('cart-open');
            var sharerName = data.sharer_name || data.shared_by || null;
            var msg = sharerName
              ? '🎁 ' + sharerName + " t'a partagé son panier !"
              : '🧺 Panier partagé chargé !';
            showToast(msg, 'success');
            if (sharerName && dom.cartHeaderTitle) {
              dom.cartHeaderTitle.textContent = '🎁 Panier de ' + sharerName;
            }
          }, 500);
        }
        window.history.replaceState({}, '', window.location.pathname);
      }, 200);
      setTimeout(function() { clearInterval(checkProducts); }, 10000);
    } catch(e) {
      console.warn('[share] API error:', e);
    }
  }

  /* ══════════════════════════════════════════════════════════
     CHECKOUT / ORDER
     ══════════════════════════════════════════════════════════ */

  function checkoutCart() {
    if (state.cart.length === 0) { showToast('Votre panier est vide.', 'error'); return; }
    closeCart();
    state.orderData = { payment_mode: 'cash_relais' };
    renderCheckout();
    dom.orderModal.classList.add('open');
    window._savedScrollY = window.scrollY;
    document.body.classList.add('cart-open');
    // FIX : masquer bnav pour voir bouton Payer
    const bnav = document.getElementById('k-bnav');
    if (bnav) {
      bnav.dataset.savedDisplay = bnav.style.display || '';
      bnav.style.display = 'none';
    }
  }

  function closeOrderModal() {
    dom.orderModal.classList.remove('open');
    document.body.classList.remove('cart-open');
    // FIX : restaurer bnav
    const bnav = document.getElementById('k-bnav');
    if (bnav) {
      bnav.style.display = bnav.dataset.savedDisplay || '';
      delete bnav.dataset.savedDisplay;
    }
    if (typeof window._savedScrollY === 'number') {
      window.scrollTo(0, window._savedScrollY);
      window._savedScrollY = 0;
    }
  }

  function renderCheckout() {
    const body = dom.orderBody;
    body.innerHTML = '';
    body.parentElement.querySelectorAll('.ck-confirm-btn').forEach(b => b.remove());
    dom.orderTitle.textContent = '🛒 Commander';

    const od = state.orderData;

    /* ── Bouton retour panier ── */
    const backBtn = document.createElement('button');
    backBtn.className = 'ck-back-btn';
    backBtn.type = 'button';
    backBtn.innerHTML = '← Retour au panier';
    backBtn.addEventListener('click', () => {
      closeOrderModal();
      setTimeout(() => { if (typeof openCart === 'function') openCart(); }, 150);
    });
    body.appendChild(backBtn);

    /* ── 2. Bénéficiaire ── */
    const s1 = document.createElement('div');
    s1.className = 'ck-label';
    s1.textContent = '📦 Bénéficiaire';
    body.appendChild(s1);
    body.appendChild(makeInput('of-beneficiary-name',  'Nom *',         'text', 'Prénom Nom',  od, 'beneficiary_name'));
    body.appendChild(makePhoneInput('of-beneficiary-phone', 'Tél. (+269) *', od, 'beneficiary_phone'));

    /* ── 3. Paiement ── */
    const s2 = document.createElement('div');
    s2.className = 'ck-label';
    s2.textContent = '💳 Paiement';
    body.appendChild(s2);

    const payGrid = document.createElement('div');
    payGrid.className = 'ck-pay-grid';
    payGrid.innerHTML =
      '<label class="ck-pay-chip" id="ck-chip-cash">'
      + '<input type="radio" name="payment_mode" value="cash_relais" checked>'
      + '<span class="ck-chip-icon">🏪</span><span class="ck-chip-lbl">Cash</span>'
      + '</label>'
      + '<label class="ck-pay-chip ck-pay-chip--off">'
      + '<input type="radio" name="payment_mode" value="mvola" disabled>'
      + '<span class="ck-chip-icon">📱</span>'
      + '<span class="ck-chip-lbl">MVola<br><em class="ck-soon">Bientôt</em></span>'
      + '</label>'
      + '<label class="ck-pay-chip" id="ck-chip-stripe">'
      + '<input type="radio" name="payment_mode" value="stripe_eur">'
      + '<span class="ck-chip-icon">💳</span><span class="ck-chip-lbl">Carte</span>'
      + '</label>';
    body.appendChild(payGrid);

    // Stripe card wrap : inline dans le scroll, juste sous les chips paiement
    // FIX: supprimer tout ancien wrap (sinon doublons => Stripe casse en silence)
    document.querySelectorAll('#stripe-card-wrap').forEach(el => el.remove());
    if (_stripeCard) { try { _stripeCard.unmount(); } catch(e){} _stripeCard = null; _stripeElements = null; }
    const stripeCardWrap = document.createElement('div');
    stripeCardWrap.id = 'stripe-card-wrap';
    stripeCardWrap.className = 'k-stripe-wrap';
    stripeCardWrap.innerHTML = '<div class="k-stripe-title">🔒 Informations de carte</div>'
      + '<div id="stripe-card-element" class="k-stripe-element"></div>'
      + '<div id="stripe-card-error" class="k-stripe-error"></div>'
      + '<div id="stripe-eur-display" class="k-stripe-eur"></div>';
    body.appendChild(stripeCardWrap);

    /* ── 4. Suivi SMS accordion ── */
    const trackRow = document.createElement('div');
    trackRow.className = 'ck-track-row';
    trackRow.innerHTML = '<label class="k-ck-track-label">📲 Votre tél. pour le suivi (optionnel)</label>';
    body.appendChild(trackRow);

    const trackExtra = document.createElement('div');
    trackExtra.id = 'ck-track-extra';
    trackExtra.className = 'ck-track-extra';
    // Toujours visible — plus besoin de cocher une case
    const senderGroup = makeIntlPhoneInput('of-sender-phone', '', od, 'sender_phone');
    const trkHint = document.createElement('div');
    trkHint.className = 'ck-track-hint';
    trkHint.textContent = 'Notifié(e) par WhatsApp dès que la commande arrive au relais';
    trackExtra.appendChild(senderGroup);
    trackExtra.appendChild(trkHint);
    body.appendChild(trackExtra);

    /* ── 5. Wallet ── */
    checkWalletBalance();
    const walletSection = document.createElement('div');
    walletSection.id = 'wallet-section';
    walletSection.className = 'k-wallet-section';
    walletSection.innerHTML = '<label class="k-wallet-label">'
      + '<input type="checkbox" id="cb-use-wallet" class="k-wallet-cb">'
      + '<div class="k-wallet-info"><div class="k-wallet-title">💰 Utiliser mon crédit</div>'
      + '<div id="wallet-balance-text" class="k-wallet-balance">Chargement…</div></div></label>'
      + '<div id="wallet-deduction" class="k-wallet-ded"></div>';
    body.appendChild(walletSection);

    /* ── 6. Confirm (sticky) ── */
    // FIX: supprimer tout ancien bouton confirm
    document.querySelectorAll('#btn-confirm-order').forEach(el => el.remove());
    const confirmBtn = document.createElement('button');
    confirmBtn.id = 'btn-confirm-order';
    confirmBtn.className = 'ck-confirm-btn';
    confirmBtn.textContent = '✅ Confirmer — ' + fmt(cartTotal(), 'KMF');
    // Bouton confirm HORS du scroll area → toujours visible en bas du modal
    body.parentElement.appendChild(confirmBtn);

    /* ── Payment switching ── */
    // stripeCardWrap reste dans body (inline sous les chips)

    function updatePaymentUI() {
      const mode = document.querySelector('input[name="payment_mode"]:checked');
      const isStripe = mode && mode.value === 'stripe_eur';
      od.payment_mode = mode ? mode.value : 'cash_relais';

      document.querySelectorAll('.ck-pay-chip').forEach(chip => {
        const r = chip.querySelector('input[type=radio]');
        if (r && !r.disabled) chip.classList.toggle('ck-pay-chip--active', r.checked);
      });

      const wrap = document.getElementById('stripe-card-wrap');
      if (wrap) {
        wrap.classList.toggle('is-visible', isStripe);
        if (isStripe) { const ed = document.getElementById('stripe-eur-display'); if (ed) ed.classList.add('is-visible'); }
      }

      if (isStripe && _stripe && !_stripeCard) {
        _stripeElements = _stripe.elements();
        _stripeCard = _stripeElements.create('card', {
          style: { base: { fontSize: '15px', color: '#1e293b', '::placeholder': { color: '#94a3b8' } }, invalid: { color: '#dc2626' } },
          hidePostalCode: true
        });
        _stripeCard.mount('#stripe-card-element');
        _stripeCard.on('change', ev => {
          const errEl = document.getElementById('stripe-card-error');
          if (errEl) { errEl.textContent = ev.error ? ev.error.message : ''; errEl.classList.toggle('is-visible', !!ev.error); }
        });
      }

      const btn = document.getElementById('btn-confirm-order');
      if (btn) btn.textContent = isStripe ? '💳 Payer ' + fmt(cartTotal(), 'KMF') : '✅ Confirmer — ' + fmt(cartTotal(), 'KMF');
    }

    payGrid.addEventListener('change', updatePaymentUI);
    updatePaymentUI(); // init état chip cash

    setTimeout(() => {
      const cb = document.getElementById('cb-use-wallet');
      if (cb) cb.addEventListener('change', function() { od.use_wallet = this.checked; updateWalletDisplay(); });
    }, 0);

    confirmBtn.addEventListener('click', () => submitOrder(confirmBtn));
  }

    /* ── Checkout form helpers ── */
  function makeSection(text) {
    const div = document.createElement('div');
    div.className = 'k-ck-section';
    div.textContent = text;
    return div;
  }

  function makeInput(id, label, type, placeholder, dataObj, key) {
    const group = document.createElement('div');
    group.className = 'k-ck-group';
    const lbl = document.createElement('label');
    lbl.className = 'k-ck-label';
    lbl.textContent = label;
    group.appendChild(lbl);
    const input = document.createElement('input');
    input.type = type;
    input.id = id;
    input.className = 'k-ck-input';
    input.placeholder = placeholder;
    input.value = dataObj[key] || '';
    input.addEventListener('input', () => { dataObj[key] = input.value; });
    group.appendChild(input);
    return group;
  }


  function makeIntlPhoneInput(id, label, dataObj, key) {
  const COUNTRIES = [
    { code: '+33',  flag: '🇫🇷', name: 'France',          digits: 9,  max: 10, ph: '06 12 34 56 78' },
    { code: '+269', flag: '🇰🇲', name: 'Comores',         digits: 7,  max: 7,  ph: '321 12 34' },
    { code: '+262', flag: '🇷🇪', name: 'Réunion',         digits: 9,  max: 10, ph: '0692 12 34 56' },
    { code: '+32',  flag: '🇧🇪', name: 'Belgique',        digits: 9,  max: 10, ph: '0470 12 34 56' },
    { code: '+41',  flag: '🇨🇭', name: 'Suisse',          digits: 9,  max: 10, ph: '076 123 45 67' },
    { code: '+44',  flag: '🇬🇧', name: 'Royaume-Uni',     digits: 10, max: 11, ph: '07911 123456' },
    { code: '+1',   flag: '🇺🇸', name: 'USA / Canada',    digits: 10, max: 10, ph: '202 555 0147' },
    { code: '+971', flag: '🇦🇪', name: 'Émirats',         digits: 9,  max: 10, ph: '050 123 4567' },
    { code: '+966', flag: '🇸🇦', name: 'Arabie Saoudite', digits: 9,  max: 10, ph: '055 123 4567' },
    { code: '+60',  flag: '🇲🇾', name: 'Malaisie',        digits: 9,  max: 10, ph: '012 345 6789' },
    { code: '+212', flag: '🇲🇦', name: 'Maroc',           digits: 9,  max: 10, ph: '0612 345678' },
  ];

  function digitsOnly(v) {
    return String(v || '').replace(/\D+/g, '');
  }

  function normalizeLocal(code, digits) {
    // On accepte le 0 national saisi par l'utilisateur pour certains pays
    if (
      ['+33', '+262', '+32', '+41', '+44', '+971', '+966', '+60', '+212'].includes(code) &&
      digits.startsWith('0')
    ) {
      return digits.slice(1);
    }
    return digits;
  }

  function prettifyLocal(raw, country) {
    const d = digitsOnly(raw).slice(0, country.max);
    if (!d) return '';
    // formatage léger visuel seulement
    if (country.code === '+33' || country.code === '+262' || country.code === '+32' || country.code === '+41') {
      return d.replace(/(\d{2})(?=\d)/g, '$1 ').trim();
    }
    if (country.code === '+44') {
      return d.replace(/(\d{5})(\d{0,6})/, function(_, a, b){ return b ? a + ' ' + b : a; }).trim();
    }
    if (country.code === '+1') {
      return d.replace(/(\d{3})(\d{0,3})(\d{0,4})/, function(_, a, b, c){
        return [a, b, c].filter(Boolean).join(' ');
      }).trim();
    }
    return d.replace(/(\d{3})(?=\d)/g, '$1 ').trim();
  }

  function buildE164(code, raw) {
    let digits = digitsOnly(raw);
    if (!digits) return '';
    digits = normalizeLocal(code, digits);
    return code + digits;
  }

  const group = document.createElement('div');
  group.className = 'k-ck-group';

  const lbl = document.createElement('label');
  lbl.className = 'k-ck-label';
  lbl.textContent = label;
  group.appendChild(lbl);

  const wrap = document.createElement('div');
  wrap.className = 'k-ck-phone-wrap';

  const sel = document.createElement('select');
  sel.id = id + '-country';
  sel.className = 'k-ck-phone-select';
  COUNTRIES.forEach(function(c) {
    const opt = document.createElement('option');
    opt.value = c.code;
    opt.textContent = c.flag + ' ' + c.code;
    if (c.code === '+33') opt.selected = true; // défaut FR
    sel.appendChild(opt);
  });

  const input = document.createElement('input');
  input.type = 'tel';
  input.id = id;
  input.inputMode = 'numeric';
  input.autocomplete = 'tel';
  input.placeholder = '06 12 34 56 78';
  input.className = 'k-ck-phone-input';

  const help = document.createElement('div');
  help.className = 'k-ck-phone-help';
  help.textContent = 'Exemple France : 06 12 34 56 78';

  function currentCountry() {
    return COUNTRIES.find(c => c.code === sel.value) || COUNTRIES[0];
  }

  function sync() {
    const country = currentCountry();
    input.placeholder = country.ph;

    let rawDigits = digitsOnly(input.value).slice(0, country.max);
    input.value = prettifyLocal(rawDigits, country);

    const e164 = buildE164(country.code, rawDigits);
    dataObj[key] = e164 || '';
  }

  sel.addEventListener('change', function() {
    const c = currentCountry();
    help.textContent = 'Exemple ' + c.name + ' : ' + c.ph;
    sync();
  });

  input.addEventListener('blur', sync);
  input.addEventListener('input', sync);

  // Pré-remplissage depuis dataObj si déjà existant
  if (dataObj[key]) {
    const existing = String(dataObj[key]).trim();
    const found = COUNTRIES.find(c => existing.startsWith(c.code));
    if (found) {
      sel.value = found.code;
      const local = existing.slice(found.code.length);
      input.value = prettifyLocal(local, found);
    }
  }

  wrap.appendChild(sel);
  wrap.appendChild(input);
  group.appendChild(wrap);
  group.appendChild(help);

  // Sync initial
  sync();

  return group;
}

  function makePhoneInput(id, label, dataObj, key) {
    const group = document.createElement('div');
    group.className = 'k-ck-group';
    if (label) {
      const lbl = document.createElement('label');
      lbl.className = 'k-ck-label k-ck-label--sm';
      lbl.textContent = label;
      group.appendChild(lbl);
    }
    const wrap = document.createElement('div');
    wrap.className = 'k-ck-km-wrap';
    const prefix = document.createElement('div');
    prefix.className = 'k-ck-km-prefix';
    prefix.innerHTML = '🇰🇲 <span class="k-ck-km-code">+269</span>';
    wrap.appendChild(prefix);
    const input = document.createElement('input');
    input.type = 'tel';
    input.id = id;
    input.className = 'k-ck-km-input';
    input.placeholder = '321 12 34';
    input.value = dataObj[key] || '';
    input.maxLength = 10;
    input.addEventListener('input', () => {
      let raw = input.value.replace(/[^0-9]/g, '');
      if (raw.length > 7) raw = raw.substring(0, 7);
      if (raw.length >= 4) raw = raw.substring(0,3) + ' ' + raw.substring(3);
      if (raw.length >= 7) raw = raw.substring(0,6) + ' ' + raw.substring(6);
      input.value = raw;
      dataObj[key] = raw;
    });
    wrap.appendChild(input);
    group.appendChild(wrap);
    return group;
  }

  function makePaymentOption(value, title, subtitle, checked) {
    const wrapper = document.createElement('label');
    wrapper.className = 'k-pay-option' + (checked ? ' is-selected' : '');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'payment_mode';
    radio.value = value;
    radio.checked = checked;
    radio.className = 'k-pay-radio';
    wrapper.appendChild(radio);
    const info = document.createElement('div');
    info.innerHTML = '<div class="k-pay-title">' + title + '</div><div class="k-pay-subtitle">' + subtitle + '</div>';
    wrapper.appendChild(info);
    return { wrapper, radio };
  }

  /* ── Wallet ── */
  async function checkWalletBalance() {
    try {
      const res = await fetch('/api/wallet', { credentials: 'same-origin' });
      if (res.ok) {
        const data = await res.json();
        state.walletBalance = data.balance_kmf || 0;
        const section = document.getElementById('wallet-section');
        if (section && state.walletBalance > 0) {
          section.classList.add('is-visible');
          const balText = document.getElementById('wallet-balance-text');
          if (balText) balText.textContent = 'Solde disponible : ' + fmt(state.walletBalance, 'KMF');
        }
      }
    } catch(e) { console.log('wallet check:', e); }
  }

  function updateWalletDisplay() {
    const ded = document.getElementById('wallet-deduction');
    if (!ded) return;
    const cb = document.getElementById('cb-use-wallet');
    if (cb && cb.checked && state.walletBalance > 0) {
      const total = cartTotal();
      const applied = Math.min(state.walletBalance, total);
      const remaining = total - applied;
      ded.classList.add('is-visible');
      ded.innerHTML = '<div class="k-wal-row"><span>💰 Crédit appliqué</span><span class="k-wal-value">-' + fmt(applied, 'KMF') + '</span></div>' +
        (remaining > 0 ? '<div class="k-wal-row"><span>Reste à payer</span><span class="k-wal-bold">' + fmt(remaining, 'KMF') + '</span></div>' : '<div class="k-wal-success">✅ Entièrement couvert par votre crédit !</div>');
    } else {
      ded.classList.remove('is-visible');
    }
  }

  /* ── Submit Order ── */
async function submitOrder(btn) {
  const od = state.orderData;
  const recipName  = (document.getElementById('of-beneficiary-name')?.value || '').trim();
  const recipPhone = (document.getElementById('of-beneficiary-phone')?.value || '').trim();

  // sender_phone : priorité à od.sender_phone, fallback DOM
  let senderPhone = (od.sender_phone || '').trim();
  if (senderPhone.length < 8) {
    const _phoneInput = document.getElementById('of-sender-phone');
    const _countrySel = document.getElementById('of-sender-phone-country');
    const _code = _countrySel?.value || '+33';

    const RULES = {
      '+33': 9,
      '+269': 7,
      '+262': 9,
      '+32': 9,
      '+41': 9,
      '+44': 10,
      '+1': 10,
      '+971': 9,
      '+966': 9,
      '+60': 9,
      '+212': 9
    };

    let _digits = String(_phoneInput?.value || '').replace(/\D/g, '');

    if (['+33', '+262', '+32', '+41', '+44', '+971', '+966', '+60', '+212'].includes(_code) && _digits.startsWith('0')) {
      _digits = _digits.slice(1);
    }

    if (_digits.length > 0) {
      const expected = RULES[_code] || 9;
      if (_digits.length !== expected) {
        showToast(`Numéro invalide pour ${_code}. ${expected} chiffres attendus.`, 'error');
        return;
      }
      senderPhone = _code + _digits;
    }
  }

  const clientName = recipName;
  const recipDigits = recipPhone.replace(/\D/g, '');
  const fullRecipPhone = '+269' + recipDigits;
  const clientEmail = undefined;

  if (!recipName) {
    showToast('Indiquez le nom de la personne qui récupère.', 'error');
    return;
  }
  if (!recipPhone) {
    showToast('Indiquez le téléphone du bénéficiaire (+269).', 'error');
    return;
  }
  if (recipDigits.length !== 7) {
    showToast(`Téléphone +269 invalide : 7 chiffres attendus (vous en avez ${recipDigits.length}).`, 'error');
    return;
  }

  const isStripe = od.payment_mode === 'stripe_eur';
  const trackingPhone = senderPhone && senderPhone.length >= 8 ? senderPhone : null;

  // Anti double-clic / anti race
  if (btn.dataset.busy === '1') return;
  btn.dataset.busy = '1';
  btn.disabled = true;
  btn.textContent = isStripe ? '⏳ Paiement en cours…' : '⏳ Envoi en cours…';
  btn.style.opacity = '0.7';

  try {
    const items = state.cart.map(i => ({
      product_id: String(i.product.id),
      quantity: i.qty,
      confection_type: 'aucun'
    }));

    let orderData = null;
    let apiResult = null;

    // CASH : comportement inchangé
    // STRIPE : créer la commande UNE seule fois par tentative
    if (isStripe) {
      if (!state.checkoutAttemptKey) {
        state.checkoutAttemptKey = genIdempotencyKey();
      }

      if (!state.pendingStripeOrderRef) {
        apiResult = await apiPost('/api/orders', {
          items,
          relais_id: state.relais.length > 0 ? state.relais[0].id : undefined,
          recipient_name: recipName,
          recipient_phone: fullRecipPhone,
          payment_mode: od.payment_mode,
          use_wallet: od.use_wallet || false,
          tracking_phone: trackingPhone || undefined,
          share_token: state.shareToken || undefined
        }, {
          idempotencyKey: state.checkoutAttemptKey
        });

        orderData = apiResult.order || apiResult;
        state.pendingStripeOrderRef = orderData.reference;
      } else {
        // Retry Stripe : on réutilise la même commande
        orderData = { reference: state.pendingStripeOrderRef };
      }
    } else {
      apiResult = await apiPost('/api/orders', {
        items,
        relais_id: state.relais.length > 0 ? state.relais[0].id : undefined,
        recipient_name: recipName,
        recipient_phone: fullRecipPhone,
        payment_mode: od.payment_mode,
        use_wallet: od.use_wallet || false,
        tracking_phone: trackingPhone || undefined,
        share_token: state.shareToken || undefined
      });

      orderData = apiResult.order || apiResult;
    }

    // Stripe payment
    if (isStripe) {
      if (!_stripe || !_stripeCard) {
        throw new Error('Stripe non chargé. Rechargez la page.');
      }

      btn.textContent = '🔒 Sécurisation du paiement…';

      const intentResult = await apiPost('/api/payments/stripe/intent', {
        order_reference: orderData.reference
      });

      btn.textContent = '💳 Validation en cours…';

      const stripeResult = await _stripe.confirmCardPayment(intentResult.client_secret, {
        payment_method: {
          card: _stripeCard,
          billing_details: {
            name: clientName,
            email: clientEmail || undefined
          }
        }
      });

      if (stripeResult.error) {
        const errEl = document.getElementById('stripe-card-error');
        if (errEl) {
          errEl.textContent = stripeResult.error.message;
          errEl.classList.remove('u-hidden');
        }
        // IMPORTANT :
        // on garde pendingStripeOrderRef et checkoutAttemptKey
        // pour que le retry réutilise la même commande
        throw new Error(stripeResult.error.message);
      }

      showToast('🎉 Paiement accepté !', 'success');

      // paiement OK => on nettoie l’état de tentative
      state.checkoutAttemptKey = null;
      state.pendingStripeOrderRef = null;
    }

    // clear cart
    state.cart = [];
    saveCart();
    renderCartBody();

    // success screen
    renderOrderSuccess(orderData, recipName, clientEmail, apiResult || orderData);
    showToast('Commande confirmée !', 'success');

    btn.dataset.busy = '0';
  } catch (e) {
    console.error('submitOrder:', e);
    showToast(e.message || 'Erreur lors de la commande.', 'error');

    btn.disabled = false;
    btn.dataset.busy = '0';
    btn.textContent = isStripe
      ? '💳 Payer ' + fmt(cartTotal(), 'KMF')
      : '✅ Confirmer — ' + fmt(cartTotal(), 'KMF');
    btn.style.opacity = '1';
  }
}

  /* ── Order Success ── */
  function renderOrderSuccess(order, recipientName, clientEmail, fullResult) {
    const body = dom.orderBody;
    body.innerHTML = '';
    dom.orderTitle.textContent = '✅ Commande confirmée';

    // Retirer tout bouton Confirmer sticky résiduel
    body.parentElement.querySelectorAll('.ck-confirm-btn').forEach(b => b.remove());

    // Masquer le bouton retour panier s'il existe encore
    body.querySelectorAll('.ck-back-btn').forEach(b => b.remove());

    const wrap = document.createElement('div');
    wrap.className = 'k-confirm-wrap k-confirm-simple';

    // Émoji + titre
    const emoji = document.createElement('div');
    emoji.className = 'k-confirm-emoji';
    emoji.textContent = '🎉';
    wrap.appendChild(emoji);

    const title = document.createElement('h3');
    title.className = 'k-confirm-title';
    title.textContent = 'Commande confirmée !';
    wrap.appendChild(title);

    // Référence (élément central de l'écran)
    const refBlock = document.createElement('div');
    refBlock.className = 'k-confirm-ref-block';
    refBlock.innerHTML =
      '<div class="k-confirm-ref-label">Votre référence</div>' +
      '<div class="k-confirm-ref">' + sanitize(order.reference || '—') + '</div>' +
      '<button id="k-copy-ref-btn" class="k-confirm-copy">📋 Copier</button>';
    wrap.appendChild(refBlock);

    // NOUVEAU : ligne récap "N articles — XXX KMF"
    // On lit depuis order (renvoyé par l'API) ou depuis l'état sauvegardé
    const orderQty = order.items_count || (order.items && order.items.length) || null;
    const orderTotal = order.total_kmf != null ? order.total_kmf : null;
    if (orderQty && orderTotal) {
      const recapLine = document.createElement('div');
      recapLine.className = 'k-confirm-recap';
      recapLine.innerHTML =
        '<span class="k-confirm-recap-qty">' + orderQty + ' article' + (orderQty > 1 ? 's' : '') + '</span>' +
        '<span class="k-confirm-recap-sep">•</span>' +
        '<span class="k-confirm-recap-amount">' + fmt(orderTotal, 'KMF') + '</span>';
      wrap.appendChild(recapLine);
    }

    // Code cash (seulement si paiement cash)
    if (order.cash_ref_code && order.payment_mode === 'cash_relais') {
      const cashBlock = document.createElement('div');
      cashBlock.className = 'k-confirm-cash-block';
      cashBlock.innerHTML =
        '<div class="k-confirm-cash-label">🏪 Code à présenter au relais</div>' +
        '<div class="k-confirm-cash-code">' + sanitize(order.cash_ref_code) + '</div>';
      wrap.appendChild(cashBlock);
    }

    // 2 consignes courtes
    const notices = document.createElement('div');
    notices.className = 'k-confirm-notices';
    notices.innerHTML =
      '<div class="k-confirm-notice-row">📲 Vous allez recevoir un WhatsApp de confirmation</div>' +
      '<div class="k-confirm-notice-row">🏪 Rendez-vous au relais avec cette référence</div>';
    wrap.appendChild(notices);

    // Actions : Suivre + Continuer
    const actions = document.createElement('div');
    actions.className = 'k-confirm-actions';
    actions.innerHTML =
      '<button id="k-order-track-btn" class="k-confirm-btn k-confirm-btn-primary">📍 Suivre ma commande</button>' +
      '<button id="k-order-close-btn" class="k-confirm-btn k-confirm-btn-secondary">🛍️ Continuer mes achats</button>';
    wrap.appendChild(actions);

    body.appendChild(wrap);

    // Bindings
    setTimeout(() => {
      const copyBtn = document.getElementById('k-copy-ref-btn');
      if (copyBtn) {
        copyBtn.addEventListener('click', () => {
          if (navigator.clipboard) {
            navigator.clipboard.writeText(order.reference || '').then(() => {
              showToast('📋 Référence copiée !', 'success');
              copyBtn.textContent = '✓ Copié';
              setTimeout(() => { copyBtn.textContent = '📋 Copier'; }, 2000);
            });
          }
        });
      }

      const closeBtn = document.getElementById('k-order-close-btn');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          closeOrderModal();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      }

      const trackBtn = document.getElementById('k-order-track-btn');
      if (trackBtn) {
        trackBtn.addEventListener('click', () => {
          closeOrderModal();
          if (typeof renderTrackView === 'function') renderTrackView();
          if (typeof switchView === 'function') switchView('track');
          const navItems = document.querySelectorAll('.k-bnav-item');
          navItems.forEach(i => i.classList.remove('active'));
          const trackNav = document.querySelector('.k-bnav-item[data-tab="track"]');
          if (trackNav) trackNav.classList.add('active');
          setTimeout(() => {
            const refInput = document.getElementById('k-otp-ref');
            if (refInput) {
              refInput.value = order.reference || '';
              const refBtn = document.getElementById('k-otp-ref-btn');
              if (refBtn) refBtn.click();
            }
          }, 350);
        });
      }
    }, 0);
  }

    /* ── SETUP CART DRAWER ──────────────────────────────────── */
  function setupDrawer() {
    dom.cartBtn.addEventListener('click', openCart);
    dom.cartClose.addEventListener('click', closeCart);
    dom.cartOverlay.addEventListener('click', closeCart);
    dom.cartContinue.addEventListener('click', closeCart);
    dom.cartClear.addEventListener('click', () => {
      if (state.cart.length === 0) return;
      state.cart = [];
      saveCart();
      renderCartBody();
      showToast('🗑 Panier vidé');
    });
    dom.cartWhatsapp.addEventListener('click', shareCartWhatsApp);
    loadSharedCart();
    dom.cartCheckout.addEventListener('click', checkoutCart);

    // Order modal
    dom.orderClose.addEventListener('click', closeOrderModal);
    dom.orderModal.addEventListener('click', (e) => {
      if (e.target === dom.orderModal) closeOrderModal();
    });
  }

  /* ── INFINITE SCROLL ───────────────────────────────────── */
  function setupInfiniteScroll() {
    // Créer le sentinel + spinner
    const sentinel = document.createElement('div');
    sentinel.id = 'k-scroll-sentinel';
    const spinner = document.createElement('div');
    spinner.id = 'k-load-more-spinner';
    spinner.className = 'k-load-more-spinner';
    spinner.innerHTML = '<div class="k-spinner k-spinner--sm"></div>';
    const catalogSec = document.getElementById('k-catalog-section');
    if (catalogSec) {
      catalogSec.appendChild(spinner);
      catalogSec.appendChild(sentinel);
    }
    // Observer
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        spinner.classList.add('show');
        setTimeout(() => { appendNextPage(); applyMobileStyles(); }, 300);
      }
    }, { rootMargin: '200px' });
    observer.observe(sentinel);
  }

  /* ── VUE FAVORIS ────────────────────────────────────────── */
  function renderFavView() {
    let el = document.getElementById('k-fav-view');
    if (!el) {
      el = document.createElement('div');
      el.id = 'k-fav-view'; el.className = 'k-fav-view';
      document.getElementById('k-catalog-section').after(el);
    }
    const favProducts = state.products.filter(p => state.favs.includes(p.id));

    // FEATURE 1 : Détecter les produits en promo parmi les favoris
    const promoFavs = favProducts.filter(p => (p.promo_pct || 0) > 0);

    // FEATURE 2 : Mettre à jour le badge "🎉" sur l'icône Favoris de la bnav
    updateFavPromoBadge(promoFavs.length);

    if (!favProducts.length) {
      el.innerHTML = `<h2>❤️ Favoris</h2>
        <div class="k-fav-empty">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
          <p>Aucun favori pour l'instant</p>
          <p class="k-fav-hint">Appuie sur 🤍 sur un produit pour l'ajouter ici</p>
        </div>`;
    } else {
      const cardsHTML = favProducts.map(p => {
        const inCart = state.cart.find(i => String(i.product.id) === String(p.id));
        const qty = inCart ? inCart.qty : 0;
        return `<div class="k-card" data-id="${p.id}">
          <div class="k-card-img-wrap">
            ${renderProductCarousel(p, 400)}
            ${p.promo_pct ? `<span class="k-card-promo k-card-promo-fav">🎉 -${p.promo_pct}%</span>` : ''}
            <button class="k-card-fav liked" data-fav="${p.id}" aria-label="Retirer des favoris">❤️</button>
            <button class="k-card-add${qty > 0 ? ' in-cart' : ''}" data-add="${p.id}" aria-label="Ajouter">
              ${qty > 0
                ? `<span class="k-add-minus" data-pid="${p.id}">−</span><span class="k-add-qty">${qty}</span><span class="k-add-plus-ic">+</span>`
                : '<span class="k-card-add-plus">+</span>'}
            </button>
          </div>
          <div class="k-card-info">
            <div class="k-card-name">${sanitize(p.name)}</div>
            <div class="k-card-bottom k-card-prices-row">
              <span class="k-card-price">${fmtPrice(p.price_kmf)}</span>
              ${p.promo_pct ? `<span class="k-card-old-price">${fmtPrice(Math.round(p.price_kmf / (1 - p.promo_pct / 100)))}</span>` : ''}
            </div>

          </div>
        </div>`;
      }).join('');

      // FEATURE 1 bis : Banner "X produits en promo !" si applicable
      const promoBanner = promoFavs.length > 0
        ? `<div class="k-fav-promo-banner">
             <span class="k-fav-promo-icon">🎉</span>
             <div class="k-fav-promo-text">
               <strong>${promoFavs.length} de vos favori${promoFavs.length > 1 ? 's sont' : ' est'} en promo !</strong>
               <span>Profitez des réductions avant qu'elles disparaissent</span>
             </div>
           </div>`
        : '';

      // FEATURE 3 : Bouton partager la wishlist
      const shareBtn = `<button class="k-fav-share-btn" id="k-fav-share-btn">
        <span class="k-fav-share-icon">📲</span>
        <span>Envoyer ma liste de souhaits</span>
      </button>`;

      el.innerHTML = `<h2>❤️ Favoris <span class="k-fav-count">${favProducts.length} produit${favProducts.length > 1 ? 's' : ''}</span></h2>
        ${promoBanner}
        ${shareBtn}
        <div class="k-grid" id="k-fav-grid">${cardsHTML}</div>`;

      const favGrid = document.getElementById('k-fav-grid');
      if (favGrid) {
        favGrid.querySelectorAll('.k-card').forEach(card => {
        bindCarouselDots(card);
          card.addEventListener('click', (e) => {
            if (e.target.closest('.k-card-fav') || e.target.closest('.k-card-add') || e.target.closest('.k-card-tab')) return;
            openModal(card.dataset.id);
          });
        });
        favGrid.querySelectorAll('.k-card-fav').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFav(btn.dataset.fav, btn);
            // Rafraîchir la vue après retrait
            setTimeout(() => renderFavView(), 100);
          });
        });
        favGrid.querySelectorAll('.k-card-add').forEach(btn => {
          btn.dataset.bound = '1';
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (e.target.closest('.k-add-minus')) { quickRemove(btn.dataset.add, btn); }
            else { quickAdd(btn.dataset.add, btn); }
          });
        });
      }

      // FEATURE 3 : Click sur "Envoyer ma liste de souhaits"
      const shareWishlistBtn = document.getElementById('k-fav-share-btn');
      if (shareWishlistBtn) {
        shareWishlistBtn.addEventListener('click', shareWishlistWhatsApp);
      }
    }
  }

  // FEATURE 2 : Badge "🎉" sur l'icône Favoris de la bnav quand promos actives
  function updateFavPromoBadge(promoCount) {
    const favNavItem = document.querySelector('.k-bnav-item[data-tab="fav"]');
    if (!favNavItem) return;
    let badge = favNavItem.querySelector('.k-bnav-promo-badge');
    if (promoCount > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'k-bnav-promo-badge';
        favNavItem.appendChild(badge);
      }
      badge.textContent = '🎉';
      badge.title = promoCount + ' favori' + (promoCount > 1 ? 's' : '') + ' en promo !';
    } else if (badge) {
      badge.remove();
    }
  }

  // FEATURE 3 : Partage wishlist via WhatsApp
  async function shareWishlistWhatsApp() {
    const favProducts = state.products.filter(p => state.favs.includes(p.id));
    if (favProducts.length === 0) {
      showToast('Aucun favori à partager.', 'error');
      return;
    }

    showToast('⏳ Génération du lien…', 'info');

    // Utilise l'API /api/shares existante pour créer un lien court partageable
    // (comme le partage panier mais avec qty=1 pour chaque favori)
    let shareURL;
    try {
      const items = favProducts.map(p => ({ product_id: p.id, qty: 1 }));
      const res = await apiPost('/api/shares', { items: items });
      shareURL = (res && res.share_url) || (window.location.origin + '/Komerce_Boutique.html');
    } catch (e) {
      console.warn('[wishlist] share API error:', e);
      // Fallback : URL simple de la boutique
      shareURL = window.location.origin + '/Komerce_Boutique.html';
    }

    // Construire le message WhatsApp
    const lines = [];
    lines.push('💝 *Ma liste de souhaits Komerce*');
    lines.push('━━━━━━━━━━━━━━━━');
    lines.push('');

    favProducts.slice(0, 10).forEach((p, idx) => {
      const priceStr = fmt(p.price_kmf || 0, 'KMF');
      let line = (idx + 1) + '. ' + (p.name || 'Produit') + ' — ' + priceStr;
      if (p.promo_pct > 0) {
        line += ' 🎉 (-' + p.promo_pct + '%)';
      }
      lines.push(line);
    });

    if (favProducts.length > 10) {
      lines.push('');
      lines.push('... et ' + (favProducts.length - 10) + ' autre' + (favProducts.length > 11 ? 's' : ''));
    }

    lines.push('');
    lines.push('━━━━━━━━━━━━━━━━');
    lines.push('Tu peux m\'offrir l\'un d\'eux ? 🥰');
    lines.push('👉 Voir la liste :');
    lines.push(shareURL);

    const msg = lines.join('\n');
    window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
  }

  /* ── VUE SUIVI ───────────────────────────────────────────── */
  /* ── OTP helpers ────────────────────────────────────────────────────── */
  const TRACK_STEPS = [
    { key: 'pending',     label: 'Commande reçue',         icon: '✓',  sub: 'Enregistrée avec succès' },
    { key: 'preparing',   label: 'En préparation',          icon: '⚙️', sub: 'Nous préparons votre colis' },
    { key: 'in_transit',  label: 'En route vers le relais', icon: '🚚', sub: '' },
    { key: 'at_relay',    label: 'Disponible au relais',    icon: '🏪', sub: 'Prêt à être retiré' },
    { key: 'delivered',   label: 'Retiré',                  icon: '✅', sub: 'Commande clôturée' }
  ];

  function buildTimeline(status) {
    const idx = TRACK_STEPS.findIndex(s => s.key === status);
    return TRACK_STEPS.map((s, i) => {
      const done    = i < idx;
      const current = i === idx;
      const cls     = done ? 'done' : current ? 'current' : '';
      return `<div class="k-track-step">
        <div class="k-track-step-dot ${cls}">${done ? '✓' : s.icon}</div>
        <div class="k-track-step-info">
          <div class="k-track-step-label">${s.label}</div>
          <div class="k-track-step-sub">${s.sub}</div>
        </div>
      </div>`;
    }).join('');
  }

  function renderOrdersHistory(orders, container) {
    if (!orders.length) {
      container.innerHTML = '<div class="k-search-empty">Aucune commande trouvée.</div>';
      return;
    }
    container.innerHTML = orders.map(o => `
      <div class="k-order-card">
        <div class="k-order-card-head">
          <span class="k-order-ref">${o.reference || o.id}</span>
          <span class="k-order-date">${o.created_at ? new Date(o.created_at).toLocaleDateString('fr-FR') : ''}</span>
        </div>
        <div class="k-order-card-total">${fmt(o.total_amount || 0, 'KMF')}</div>
        <div class="k-track-steps k-track-steps--compact">${buildTimeline(o.status || 'pending')}</div>
      </div>`).join('');
  }

  function renderOrderDetail(order, container) {
    container.innerHTML = `
      <div class="k-order-card">
        <div class="k-order-card-head">
          <span class="k-order-ref">${order.reference || order.id}</span>
          <span class="k-order-date">${order.created_at ? new Date(order.created_at).toLocaleDateString('fr-FR') : ''}</span>
        </div>
        <div class="k-order-card-total">${fmt(order.total_amount || 0, 'KMF')}</div>
        <div class="k-track-steps">${buildTimeline(order.status || 'pending')}</div>
      </div>`;
  }

  function renderTrackView() {
    let el = document.getElementById('k-track-view');
    if (!el) {
      el = document.createElement('div');
      el.id = 'k-track-view'; el.className = 'k-track-view';
      const favEl = document.getElementById('k-fav-view') || document.getElementById('k-catalog-section');
      favEl.after(el);
    }

    // ── NOUVEAU : Tentative auto-chargement via cookie JWT ──
    // Si le user a un cookie valide (= a déjà commandé), on affiche ses commandes directement
    el.innerHTML = '<div class="k-track-loading"><div class="k-track-loading-spin"></div><p>Chargement de vos commandes…</p></div>';

    (async () => {
      try {
        const data = await apiGet('/api/orders?limit=20');
        // L'API retourne un tableau direct [{...}, {...}] ou parfois {orders:[...]}
        const orders = Array.isArray(data) ? data : ((data && data.orders) || []);
        if (orders.length > 0) {
          renderMyOrdersList(el, orders);
          return;
        }
        // 0 commande → on reste en mode recherche classique
        renderTrackViewSearchMode(el);
      } catch (err) {
        // 401 / 403 / erreur → mode recherche classique
        console.log('[track] pas de session, mode recherche :', err && err.message);
        renderTrackViewSearchMode(el);
      }
    })();
  }

  /* ── NOUVEAU : Affichage liste "Mes commandes" ──
     Si le user est connu via cookie JWT, on lui montre ses commandes
     directement, triées par date (plus récentes en premier).
  */
  function renderMyOrdersList(el, orders) {
    const header = '<h2>📦 Mes commandes</h2>' +
      '<p class="k-track-sub-hint">' + orders.length + ' commande' + (orders.length > 1 ? 's' : '') + ' trouvée' + (orders.length > 1 ? 's' : '') + '</p>';

    const cards = orders.map(function(o) {
      const statusInfo = getStatusDisplay(o.status || 'pending', o.payment_status);
      const totalStr = fmt(o.total_kmf || 0, 'KMF');
      const dateStr = formatOrderDate(o.created_at);
      // L'API liste retourne : product_name, product_image_url, items_count
      const productName = o.product_name || 'Commande';
      const productImg = o.product_image_url || null;
      const itemsCount = parseInt(o.items_count, 10) || 1;
      const imgHtml = productImg
        ? '<img src="' + sanitize(optimizeImgUrl(productImg, 100)) + '" alt="" loading="lazy">'
        : '<div class="k-myorder-emoji">📦</div>';
      const itemsSummary = itemsCount > 1
        ? productName + ' + ' + (itemsCount - 1) + ' autre' + (itemsCount > 2 ? 's' : '')
        : productName;

      return '<button class="k-myorder-card" data-ref="' + sanitize(o.reference || '') + '">' +
        '<div class="k-myorder-img">' + imgHtml + '</div>' +
        '<div class="k-myorder-body">' +
          '<div class="k-myorder-ref">' + sanitize(o.reference || '—') + '</div>' +
          '<div class="k-myorder-items">' + sanitize(itemsSummary) + '</div>' +
          '<div class="k-myorder-bottom">' +
            '<span class="k-myorder-status k-myorder-status--' + statusInfo.cls + '">' + statusInfo.emoji + ' ' + statusInfo.label + '</span>' +
            '<span class="k-myorder-total">' + totalStr + '</span>' +
          '</div>' +
          '<div class="k-myorder-date">' + dateStr + '</div>' +
        '</div>' +
        '<span class="k-myorder-arrow">›</span>' +
      '</button>';
    }).join('');

    el.innerHTML = header +
      '<div class="k-myorders-list">' + cards + '</div>' +
      '<button class="k-track-btn k-track-btn--ghost k-myorders-new-search" id="k-myorders-search-other">🔍 Chercher une autre commande</button>';

    // Clic sur une carte → ouvrir le détail
    el.querySelectorAll('.k-myorder-card').forEach(function(card) {
      card.addEventListener('click', async function() {
        const ref = card.dataset.ref;
        if (!ref) return;
        card.classList.add('k-myorder-loading');
        try {
          const data = await apiGet('/api/orders/' + encodeURIComponent(ref));
          const order = (data && data.order) || data;
          // On affiche le détail dans le même conteneur
          el.innerHTML = '';
          const backBtn = document.createElement('button');
          backBtn.className = 'k-track-btn k-track-btn--ghost';
          backBtn.innerHTML = '← Retour à mes commandes';
          backBtn.style.marginBottom = '12px';
          backBtn.addEventListener('click', function() { renderTrackView(); });
          el.appendChild(backBtn);
          const box = document.createElement('div');
          el.appendChild(box);
          renderOrderDetail(order, box);
        } catch (e) {
          showToast('Impossible de charger cette commande.', 'error');
          card.classList.remove('k-myorder-loading');
        }
      });
    });

    // Bouton "chercher une autre" → mode recherche classique
    const searchBtn = el.querySelector('#k-myorders-search-other');
    if (searchBtn) {
      searchBtn.addEventListener('click', function() {
        renderTrackViewSearchMode(el);
      });
    }
  }

  /* ── Helpers pour affichage liste commandes ── */
  function getStatusDisplay(status, paymentStatus) {
    // Map status → {emoji, label, cls}
    const map = {
      pending:     { emoji: '⏳', label: 'En attente',      cls: 'pending' },
      confirmed:   { emoji: '✅', label: 'Confirmée',       cls: 'confirmed' },
      paid:        { emoji: '💰', label: 'Payée',           cls: 'confirmed' },
      ordered:     { emoji: '🛒', label: 'En préparation',  cls: 'processing' },
      preparation: { emoji: '📦', label: 'En préparation',  cls: 'processing' },
      shipped:     { emoji: '🚢', label: 'Expédiée',        cls: 'shipped' },
      in_transit:  { emoji: '🚚', label: 'En transit',      cls: 'shipped' },
      available:   { emoji: '🏪', label: 'Au relais',       cls: 'available' },
      collected:   { emoji: '✅', label: 'Retirée',         cls: 'delivered' },
      delivered:   { emoji: '✅', label: 'Livrée',          cls: 'delivered' },
      cancelled:   { emoji: '❌', label: 'Annulée',         cls: 'cancelled' },
    };
    return map[status] || { emoji: '📦', label: status || 'Inconnu', cls: 'pending' };
  }

  function formatOrderDate(isoDate) {
    if (!isoDate) return '';
    try {
      const d = new Date(isoDate);
      const now = new Date();
      const diffMs = now - d;
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays === 0) return "Aujourd'hui";
      if (diffDays === 1) return 'Hier';
      if (diffDays < 7) return 'Il y a ' + diffDays + ' jours';
      return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch(e) { return ''; }
  }

  /* ── Mode recherche classique (renommé de l'ancien renderTrackView) ── */
  function renderTrackViewSearchMode(el) {
    const otpState = { phone: '', mode: 'quick' };

    el.innerHTML = `
      <h2>📦 Suivi de commande</h2>

      <!-- Mode 1 : Tracking rapide (4 derniers chiffres) -->
      <div id="k-track-quick">
        <p class="k-otp-hint">Entrez les 4 derniers chiffres de votre commande</p>
        <div class="k-track-form">
          <div class="k-track-ref-wrap">
            <span class="k-track-ref-prefix">KMR-2025-</span>
            <input class="k-track-input k-track-input--ref" id="k-track-digits" type="text" inputmode="numeric" placeholder="0042" maxlength="4" autocomplete="off">
          </div>
          <button class="k-track-btn" id="k-track-quick-btn">🔍 Suivre</button>
        </div>
        <div class="k-otp-divider"><span>ou</span></div>
        <button class="k-track-btn k-track-btn--ghost" id="k-track-history-toggle">📋 Voir tout mon historique</button>
      </div>

      <!-- Mode 2 : Historique complet (OTP WhatsApp) -->
      <div id="k-track-otp" class="u-hidden">
        <p class="k-otp-hint">Entrez votre numéro pour recevoir un code WhatsApp et voir toutes vos commandes.</p>
        <div class="k-track-form">
          <div class="k-track-phone-wrap">
            <select id="k-otp-country" class="k-track-country">
              <option value="+269">🇰🇲 +269</option>
              <option value="+33">🇫🇷 +33</option>
              <option value="+262">🇷🇪 +262</option>
              <option value="+32">🇧🇪 +32</option>
              <option value="+41">🇨🇭 +41</option>
              <option value="+44">🇬🇧 +44</option>
              <option value="+1">🇺🇸 +1</option>
              <option value="+971">🇦🇪 +971</option>
              <option value="+212">🇲🇦 +212</option>
            </select>
            <input class="k-track-input k-track-input--phone" id="k-otp-phone" type="tel" placeholder="321 12 34" autocomplete="tel" inputmode="tel">
          </div>
          <button class="k-track-btn" id="k-otp-request-btn">📲 Envoyer le code</button>
        </div>
        <button class="k-track-btn k-track-btn--ghost k-track-btn--mt" id="k-track-back-quick">← Suivi rapide</button>
      </div>

      <!-- OTP Step 2 : saisie code -->
      <div id="k-otp-step2" class="u-hidden">
        <div class="k-otp-sent-banner">
          📲 Code WhatsApp envoyé au <strong id="k-otp-phone-display"></strong><br>
          <small>Vérifiez vos messages WhatsApp. Code valable 10 min.</small>
        </div>
        <input class="k-otp-code-input" id="k-otp-code" type="text" inputmode="numeric" placeholder="_ _ _ _ _ _" maxlength="6" autocomplete="one-time-code">
        <button class="k-track-btn" id="k-otp-verify-btn">Vérifier</button>
        <button class="k-otp-resend-btn" id="k-otp-resend-btn">Renvoyer le code</button>
      </div>

      <!-- Résultats -->
      <div id="k-otp-step3" class="u-hidden">
        <div id="k-orders-list"></div>
        <button class="k-otp-resend-btn k-otp-back-btn" id="k-otp-back-btn">← Nouvelle recherche</button>
      </div>`;

    /* ── Tracking rapide : lookup par référence ── */
    const digitsInput = el.querySelector('#k-track-digits');

    // Auto-submit on 4 digits
    digitsInput.addEventListener('input', () => {
      digitsInput.value = digitsInput.value.replace(/\D/g, '').slice(0, 4);
      if (digitsInput.value.length === 4) {
        el.querySelector('#k-track-quick-btn').click();
      }
    });

    el.querySelector('#k-track-quick-btn').addEventListener('click', async () => {
      const digits = digitsInput.value.replace(/\D/g, '');
      if (digits.length !== 4) { showToast('Entrez 4 chiffres.', 'error'); return; }
      const ref = 'KMR-2025-' + digits.padStart(4, '0');
      const btn = el.querySelector('#k-track-quick-btn');
      btn.disabled = true; btn.textContent = '⏳ Recherche…';
      try {
        const data = await apiGet('/api/orders/' + encodeURIComponent(ref));
        el.querySelector('#k-track-quick').classList.add('u-hidden');
        el.querySelector('#k-otp-step3').classList.remove('u-hidden');
        renderOrderDetail(data.order || data, el.querySelector('#k-orders-list'));
      } catch(e) {
        showToast('Commande introuvable. Vérifiez les 4 chiffres.', 'error');
        btn.disabled = false; btn.textContent = '🔍 Suivre';
      }
    });

    /* ── Toggle entre tracking rapide et historique OTP ── */
    el.querySelector('#k-track-history-toggle').addEventListener('click', () => {
      el.querySelector('#k-track-quick').classList.add('u-hidden');
      el.querySelector('#k-track-otp').classList.remove('u-hidden');
    });

    el.querySelector('#k-track-back-quick').addEventListener('click', () => {
      el.querySelector('#k-track-otp').classList.add('u-hidden');
      el.querySelector('#k-track-quick').classList.remove('u-hidden');
    });

    /* ── OTP : request code ── */
    function getFullPhone() {
      const countryCode = el.querySelector('#k-otp-country').value;
      let digits = (el.querySelector('#k-otp-phone').value || '').replace(/\D/g, '');
      if (['+33','+262','+32','+41','+44','+971','+212'].includes(countryCode) && digits.startsWith('0')) {
        digits = digits.slice(1);
      }
      return countryCode + digits;
    }

    el.querySelector('#k-otp-request-btn').addEventListener('click', async () => {
      const phone = getFullPhone();
      const digits = phone.replace(/^\+\d+/, '');
      if (!digits || digits.length < 6) { showToast('Entrez un numéro de téléphone valide.', 'error'); return; }
      const btn = el.querySelector('#k-otp-request-btn');
      btn.disabled = true; btn.textContent = '⏳ Envoi…';
      try {
        await apiPost('/api/auth/otp/request', { phone });
        otpState.phone = phone;
        el.querySelector('#k-otp-phone-display').textContent = phone;
        el.querySelector('#k-track-otp').classList.add('u-hidden');
        el.querySelector('#k-otp-step2').classList.remove('u-hidden');
        showToast('📲 Code WhatsApp envoyé !', 'success');
      } catch(e) {
        const msg = e?.message || 'Erreur lors de l\'envoi.';
        showToast(msg, 'error');
        btn.disabled = false; btn.textContent = '📲 Envoyer le code';
      }
    });

    /* ── OTP : verify code ── */
    el.querySelector('#k-otp-verify-btn').addEventListener('click', async () => {
      const code = el.querySelector('#k-otp-code').value.replace(/\s/g, '');
      if (code.length < 4) { showToast('Entrez le code complet.', 'error'); return; }
      const btn = el.querySelector('#k-otp-verify-btn');
      btn.disabled = true; btn.textContent = '⏳ Vérification…';
      try {
        const verifyResult = await apiPost('/api/auth/otp/verify', { phone: otpState.phone, code });
        showToast('✅ Vérifié — chargement de vos commandes…', 'success');
        try {
          const trackingData = await apiGet('/api/client/tracking');
          el.querySelector('#k-otp-step2').classList.add('u-hidden');
          el.querySelector('#k-otp-step3').classList.remove('u-hidden');
          const orders = (trackingData.orders || []).map(o => ({
            ...o,
            total_amount: o.totalKmf || o.total_kmf || o.total_amount || 0,
            created_at: o.createdAt || o.created_at
          }));
          renderOrdersHistory(orders, el.querySelector('#k-orders-list'));
        } catch(trackErr) {
          el.querySelector('#k-otp-step2').classList.add('u-hidden');
          el.querySelector('#k-otp-step3').classList.remove('u-hidden');
          el.querySelector('#k-orders-list').innerHTML = `
            <div class="k-search-empty">
              <p>✅ Numéro vérifié ! Bienvenue <strong>${verifyResult.user?.name || ''}</strong></p>
              <p class="k-confirm-notice-item">Aucune commande trouvée pour ce numéro.</p>
            </div>`;
        }
      } catch(e) {
        const msg = e?.message || 'Code incorrect ou expiré.';
        showToast(msg, 'error');
        btn.disabled = false; btn.textContent = 'Vérifier';
      }
    });

    /* ── OTP : resend ── */
    let resendTimer = null;
    el.querySelector('#k-otp-resend-btn').addEventListener('click', async () => {
      const btn = el.querySelector('#k-otp-resend-btn');
      if (resendTimer) return;
      btn.disabled = true; btn.textContent = '⏳ Renvoi…';
      try {
        await apiPost('/api/auth/otp/request', { phone: otpState.phone });
        showToast('📲 Nouveau code WhatsApp envoyé !', 'success');
        let countdown = 30;
        resendTimer = setInterval(() => {
          countdown--;
          btn.textContent = `Renvoyer (${countdown}s)`;
          if (countdown <= 0) { clearInterval(resendTimer); resendTimer = null; btn.disabled = false; btn.textContent = 'Renvoyer le code'; }
        }, 1000);
      } catch(e) {
        showToast('Erreur lors du renvoi.', 'error');
        btn.disabled = false; btn.textContent = 'Renvoyer le code';
      }
    });

    /* ── Back button ── */
    el.querySelector('#k-otp-back-btn').addEventListener('click', () => renderTrackView());
  }

  /* ── VUE SWITCHER ───────────────────────────────────────── */
  function switchView(tab) {
    const catalog = document.getElementById('k-catalog-section');
    const favView = document.getElementById('k-fav-view');
    const trackView = document.getElementById('k-track-view');
    const heroWrap = document.getElementById('k-hero-fixed-wrap');
    const pageScroll = document.getElementById('k-page-scroll');
    // Show catalog by default
    if (catalog) catalog.classList.toggle('u-hidden', tab !== 'shop');
    if (favView) favView.classList.toggle('show', tab === 'fav');
    if (trackView) trackView.classList.toggle('show', tab === 'track');
    // Also hide promo section when not on shop
    const promoSec = document.getElementById('k-promos-section');
    if (promoSec) promoSec.classList.toggle('u-hidden', tab !== 'shop');
    // Hide hero+categories on non-shop tabs
    if (heroWrap) heroWrap.classList.toggle('u-hidden', tab !== 'shop');
    // Adjust scroll container: on shop = below hero, on other tabs = below header only
    if (pageScroll) {
      pageScroll.dataset.tab = tab;
      // FIX : sur vues non-shop, effacer le top inline mis par _updateMobileScrollTop
      // pour que la règle CSS #k-page-scroll[data-tab="track"]{top:44px} prenne effet
      if (tab !== 'shop') {
        pageScroll.style.top = '';
      } else {
        // Retour sur shop : re-calculer le top selon la hauteur du hero
        if (typeof _updateMobileScrollTop === 'function') _updateMobileScrollTop();
      }
    }
    // Close cart drawer if open
    const cartOverlay = document.getElementById('k-cart-overlay');
    const cartDrawer = document.getElementById('k-cart-drawer');
    if (cartOverlay) cartOverlay.classList.remove('open');
    if (cartDrawer) cartDrawer.classList.remove('open');
    document.body.classList.remove('cart-open');
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ── BOTTOM NAV ─────────────────────────────────────────── */
  function setupBnav() {
    $$('.k-bnav-item').forEach(item => {
      item.addEventListener('click', () => {
        const tab = item.dataset.tab;
        $$('.k-bnav-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        if (tab === 'cart') { openCart(); return; }
        if (tab === 'fav') { renderFavView(); switchView('fav'); return; }
        if (tab === 'track') { renderTrackView(); switchView('track'); return; }
        switchView('shop');
      });
    });
  }

  /* ── SEE ALL PROMOS ─────────────────────────────────────── */
  function setupSeeAll() {
    const btn = $('#k-see-all-promos');
    if (btn) {
      btn.addEventListener('click', () => {
        state.filtered = state.products.filter(p => p.promo_pct > 0);
        state.activeCat = 'all';
        $$('.k-chip').forEach(c => c.classList.remove('active'));
        $$('.k-chip')[0].classList.add('active');
        renderGrid();
        (function(){ var s=document.getElementById('k-page-scroll'); var g=document.querySelector('.k-grid'); if(s&&g){ s.scrollTo({top:g.offsetTop-8,behavior:'smooth'}); } else if(g){ g.scrollIntoView({behavior:'smooth'}); } })();
      });
    }
  }

  /* ── LOAD RELAIS ────────────────────────────────────────── */
  async function loadRelais() {
    try {
      const data = await apiGet('/api/relais/public');
      state.relais = data.relais || data || [];
    } catch (e) { state.relais = []; }
  }

  /* ── INIT ───────────────────────────────────────────────── */
  // Note: setupStickyBar est géré par le script inline dans le HTML
  // pour éviter le double IntersectionObserver (scintillement).

  function init() {
    updateCartBadge();
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

  window.addEventListener('resize', applyMobileStyles);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }


// FIX 2.3 : Rendre les carousel dots de la modal cliquables
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
//  OPTION C : Long-press sur panier tressé → stepper flottant
//  - Tap court : +1 au panier (comportement normal)
//  - Long-press (400ms) : ouvre un stepper flottant [- qty +] au-dessus
//  - Tap ailleurs : ferme le stepper
//  - Pas d'activité 3s : ferme le stepper automatiquement
// ═══════════════════════════════════════════════════════════════════════
(function setupLongPressSteppers() {
  const LONG_PRESS_MS = 400;
  const STEPPER_AUTOCLOSE_MS = 3000;
  let pressTimer = null;
  let activeStepperBtn = null;
  let autoCloseTimer = null;
  let isLongPress = false;

  function closeActiveStepper() {
    if (!activeStepperBtn) return;
    const stepper = activeStepperBtn.querySelector('.k-card-add-stepper');
    if (stepper) {
      stepper.classList.add('k-stepper-closing');
      setTimeout(() => stepper.remove(), 250);
    }
    activeStepperBtn.classList.remove('stepper-open');
    activeStepperBtn = null;
    if (autoCloseTimer) { clearTimeout(autoCloseTimer); autoCloseTimer = null; }
  }

  function resetAutoClose() {
    if (autoCloseTimer) clearTimeout(autoCloseTimer);
    autoCloseTimer = setTimeout(closeActiveStepper, STEPPER_AUTOCLOSE_MS);
  }

  function openStepper(btn) {
    // Fermer tout autre stepper ouvert
    closeActiveStepper();

    const pid = btn.dataset.add;
    if (!pid) return;
    const item = window.state?.cart?.find(i => String(i.product.id) === String(pid));
    if (!item) return;

    // Vibration haptic sur iOS/Android si disponible
    if (navigator.vibrate) { try { navigator.vibrate(15); } catch(e){} }

    // Construire le stepper flottant
    const stepper = document.createElement('div');
    stepper.className = 'k-card-add-stepper';
    stepper.innerHTML =
      '<button class="k-stepper-minus" aria-label="Moins">−</button>' +
      '<span class="k-stepper-qty">' + item.qty + '</span>' +
      '<button class="k-stepper-plus" aria-label="Plus">+</button>';

    // Positionner au-dessus du panier tressé
    btn.appendChild(stepper);
    btn.classList.add('stepper-open');
    activeStepperBtn = btn;

    // Bind les +/- du stepper
    stepper.querySelector('.k-stepper-minus').addEventListener('click', function(e) {
      e.stopPropagation();
      e.preventDefault();
      const curItem = window.state?.cart?.find(i => String(i.product.id) === String(pid));
      if (!curItem) return closeActiveStepper();
      if (curItem.qty <= 1) {
        // Retirer du panier → ferme le stepper
        document.dispatchEvent(new CustomEvent('cart:setqty', { detail: { pid: pid, qty: 0 } }));
        closeActiveStepper();
      } else {
        document.dispatchEvent(new CustomEvent('cart:setqty', { detail: { pid: pid, qty: curItem.qty - 1 } }));
        stepper.querySelector('.k-stepper-qty').textContent = curItem.qty - 1;
        resetAutoClose();
      }
    });

    stepper.querySelector('.k-stepper-plus').addEventListener('click', function(e) {
      e.stopPropagation();
      e.preventDefault();
      const curItem = window.state?.cart?.find(i => String(i.product.id) === String(pid));
      if (!curItem) return;
      document.dispatchEvent(new CustomEvent('cart:setqty', { detail: { pid: pid, qty: curItem.qty + 1 } }));
      stepper.querySelector('.k-stepper-qty').textContent = curItem.qty + 1;
      resetAutoClose();
    });

    resetAutoClose();
  }

  function startPress(e) {
    const btn = e.target.closest('.k-card-add.in-cart');
    if (!btn) return;

    isLongPress = false;
    btn.classList.add('is-long-pressing');

    pressTimer = setTimeout(() => {
      isLongPress = true;
      btn.classList.remove('is-long-pressing');
      openStepper(btn);
    }, LONG_PRESS_MS);
  }

  function endPress(e) {
    const btn = e.target.closest('.k-card-add.in-cart');
    if (btn) btn.classList.remove('is-long-pressing');

    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    // Si long-press déclenché, on bloque le click normal (qui ferait +1)
    if (isLongPress) {
      e.preventDefault();
      e.stopPropagation();
    }
    isLongPress = false;
  }

  function cancelPress() {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    document.querySelectorAll('.k-card-add.is-long-pressing').forEach(b => {
      b.classList.remove('is-long-pressing');
    });
    isLongPress = false;
  }

  // Bindings globaux (delegation car les cartes sont dynamiques)
  document.addEventListener('mousedown', startPress);
  document.addEventListener('touchstart', startPress, { passive: true });

  document.addEventListener('mouseup', endPress);
  document.addEventListener('touchend', endPress);

  document.addEventListener('mouseleave', cancelPress);
  document.addEventListener('touchcancel', cancelPress);

  // Click ailleurs → ferme le stepper
  document.addEventListener('click', function(e) {
    if (!activeStepperBtn) return;
    // Si on tape DANS le stepper, on ne ferme pas
    if (e.target.closest('.k-card-add-stepper')) return;
    // Si on tape sur le panier tressé qui a le stepper, on ne ferme pas (géré par le bouton lui-même)
    if (e.target.closest('.k-card-add.stepper-open')) return;
    closeActiveStepper();
  });

  // Si un click normal sur .k-card-add se déclenche ET qu'un long-press vient de finir,
  // on bloque (sinon le +1 s'ajoute en plus du stepper ouvert)
  document.addEventListener('click', function(e) {
    const btn = e.target.closest('.k-card-add');
    if (btn && btn.classList.contains('stepper-open')) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);  // capture phase pour intercepter avant le handler normal

  // Exposer closeActiveStepper pour que d'autres parties du code (ouvrir modal, etc.) puissent fermer
  window.closeCartStepper = closeActiveStepper;
})();



// ═══════════════════════════════════════════════════════════════════════
// Placeholder adaptatif sur la barre de recherche (évite troncature)
// ═══════════════════════════════════════════════════════════════════════
(function adaptivePlaceholder() {
  const updatePlaceholder = () => {
    const input = document.getElementById('k-search-input');
    if (!input) return;
    const w = window.innerWidth;
    if (w < 380) {
      input.placeholder = 'Rechercher...';
    } else if (w < 768) {
      input.placeholder = 'Rechercher un produit...';
    } else {
      input.placeholder = 'Rechercher un produit dans le catalogue...';
    }
  };
  // À l'init et au redimensionnement
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updatePlaceholder);
  } else {
    updatePlaceholder();
  }
  window.addEventListener('resize', updatePlaceholder);
})();



  /* ── Capture-phase listener REMOVED — handled by setupCats v2 ── */

    // ── Index flottant vertical à droite (sauts rapides entre sections) ──
  // Apparaît uniquement en mode "Tout" (sections verticales actives).
  // Se met à jour à chaque re-render de la grille sectionnée.
  function _renderFloatingIndex() {
    const existing = document.getElementById('k-section-index');
    if (existing) existing.remove();

    // Uniquement en mode sections
    if (state.activeCat !== 'all' || state.activeSubcat) return;

    // Récupérer toutes les sections actuellement dans le DOM
    const headers = document.querySelectorAll('.k-sec-header');
    if (headers.length < 2) return; // inutile s'il n'y a qu'une section

    const EMOJI_CAT = {
      'Mode': '👕',
      'Beauté': '🌸',
      'Tech': '📱',
      'Enfant': '🧒',
      'Maison': '🏠',
      'Sport': '⚽',
      'Sur-mesure': '✨',
      'Autres': '📦',
    };

    const nav = document.createElement('nav');
    nav.id = 'k-section-index';
    nav.setAttribute('aria-label', 'Index des catégories');

    headers.forEach(function(h) {
      const cat = h.getAttribute('data-cat');
      const emoji = EMOJI_CAT[cat] || '📦';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'k-section-index-btn';
      btn.setAttribute('data-cat', cat);
      btn.setAttribute('aria-label', cat);
      btn.title = cat;
      btn.innerHTML = '<span class="k-section-index-emoji">' + emoji + '</span><span class="k-section-index-label">' + cat + '</span>';
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof window.scrollToCategorySection === 'function') {
          window.scrollToCategorySection(cat);
        }
      });
      nav.appendChild(btn);
    });

    document.body.appendChild(nav);

    // ── IntersectionObserver — sync pills with visible section (vertical scroll) ──
    if (_sectionObserver) _sectionObserver.disconnect();
    // Skip on mobile pager (horizontal scroll handles sync)
    if (window.innerWidth < 900 && document.getElementById('k-page-scroll') &&
        document.getElementById('k-page-scroll').classList.contains('k-pager-active')) return;
    var scroller = document.getElementById('k-page-scroll');
    if (scroller) {
      _sectionObserver = new IntersectionObserver(function(entries) {
        if (window._scrollingToSection) return;
        entries.forEach(function(entry) {
          if (!entry.isIntersecting) return;
          var cat = entry.target.dataset.cat;
          if (!cat) return;
          // Floating index buttons
          document.querySelectorAll('.k-section-index-btn').forEach(function(b) {
            b.classList.toggle('active', b.dataset.cat === cat);
          });
          // Main nav chips
          if (state.activeCat === 'all') {
            document.querySelectorAll('.k-chip').forEach(function(c) {
              c.classList.toggle('active', c.dataset.cat === cat);
            });
            var activeChip = document.querySelector('.k-chip.active');
            if (activeChip && typeof centerActiveChip === 'function') centerActiveChip(activeChip);
          }
        });
      }, { root: scroller, threshold: 0.3 });
      var sections = document.querySelectorAll('.k-cat-section');
      sections.forEach(function(sec) { _sectionObserver.observe(sec); });
    }
  }
  let _sectionObserver = null;

  /* ══════════════════════════════════════════════════════════════════ */
  /* ── TEMU-STYLE MOBILE PAGER — horizontal category page sync ───── */
  /* ══════════════════════════════════════════════════════════════════ */
  let _pagerScrollTimer = null;

  function _setupMobilePager() {
    var grid = document.getElementById('k-grid');
    if (!grid || window.innerWidth >= 900) return;
    // ── Calculate pager height: viewport minus header/hero/cats ──
    var hdr = document.querySelector('.k-header');
    var hero = document.getElementById('k-hero');
    var cats = document.querySelector('.k-cats-shell');
    var usedH = (hdr ? hdr.offsetHeight : 0)
              + (hero ? hero.offsetHeight : 0)
              + (cats ? cats.offsetHeight : 0);
    document.documentElement.style.setProperty('--pager-h', (window.innerHeight - usedH) + 'px');
    // Disconnect vertical observer (horizontal scroll handles sync)
    if (_sectionObserver) { _sectionObserver.disconnect(); _sectionObserver = null; }
    // Remove old listener, add new
    grid.removeEventListener('scroll', _onPagerScroll);
    grid.addEventListener('scroll', _onPagerScroll, { passive: true });
    // Recalc on resize/orientation change
    window.removeEventListener('resize', _setupMobilePager);
    window.addEventListener('resize', _setupMobilePager);
  }

  function _onPagerScroll() {
    clearTimeout(_pagerScrollTimer);
    _pagerScrollTimer = setTimeout(function() {
      if (window._scrollingToSection) return;
      var grid = document.getElementById('k-grid');
      if (!grid) return;
      var sections = grid.querySelectorAll('.k-cat-section');
      var scrollCenter = grid.scrollLeft + grid.clientWidth / 2;
      // ── Trouver la section dont le centre est le plus proche du scroll ──
      var bestIdx = 0;
      var bestDist = Infinity;
      for (var i = 0; i < sections.length; i++) {
        var secCenter = sections[i].offsetLeft + sections[i].offsetWidth / 2;
        var dist = Math.abs(scrollCenter - secCenter);
        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
      }
      if (sections[bestIdx]) {
        var cat = sections[bestIdx].dataset.cat;
        document.querySelectorAll('.k-chip').forEach(function(c) {
          c.classList.toggle('active', c.dataset.cat === cat);
        });
        var activeChip = document.querySelector('.k-chip.active');
        if (activeChip && typeof centerActiveChip === 'function') centerActiveChip(activeChip);
      }
    }, 150);
  }

  function _scrollPagerToCat(cat) {
    var grid = document.getElementById('k-grid');
    if (!grid) return;
    var section = grid.querySelector('.k-cat-section[data-cat="' + cat + '"]');
    if (!section) return;
    window._scrollingToSection = true;
    grid.scrollTo({ left: section.offsetLeft, behavior: 'smooth' });
    setTimeout(function() { window._scrollingToSection = false; }, 700);
  }

  // Appeler _renderFloatingIndex après chaque render de la grille en mode sections
  // On enveloppe _bindGridEvents pour appeler _renderFloatingIndex à la suite
  const __origBindGridEvents = (typeof _bindGridEvents === 'function') ? _bindGridEvents : null;


})();
