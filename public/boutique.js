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
  const CART_VERSION = 2;
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
  modalProduct: null,
  modalQty: 1,
  modalHistory: [],
  searchTimeout: null,
  relais: [],
  orderData: { payment_mode: 'cash_relais' },
  walletBalance: 0,
  page: 0,
  pageSize: 16,
  checkoutAttemptKey: null,
  pendingStripeOrderRef: null,
};


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
  function renderSubcats(category) {
    var wrap = document.getElementById('k-subcats-wrap');
    if (!wrap) return;

    state.activeSubcat = null;

    /* "Tout" or no subcats → hide rail */
    if (category === 'all' || !SUBCATS[category]) {
      wrap.innerHTML = '';
      wrap.classList.remove('k-subcats-visible');
      _updateMobileScrollTop();
      return;
    }

    var subs = SUBCATS[category];

    /* No "Tout" chip — first chip auto-selected or none */
    var chips = subs.map(function(s) {
      return '<button class="k-subchip" data-subcat="' + s.key + '">'
        + '<span class="k-subchip-icon">' + s.icon + '</span>'
        + '<span class="k-subchip-label">' + s.label + '</span></button>';
    }).join('');

    wrap.innerHTML = '<div class="k-subcats-rail">' + chips + '</div>';
    wrap.classList.add('k-subcats-visible');

    wrap.querySelectorAll('.k-subchip').forEach(function(chip) {
      chip.addEventListener('click', function() {
        var wasActive = chip.classList.contains('active');
        wrap.querySelectorAll('.k-subchip').forEach(function(c) { c.classList.remove('active'); });
        if (wasActive) {
          /* Toggle off — show all products in this category */
          state.activeSubcat = null;
        } else {
          chip.classList.add('active');
          state.activeSubcat = chip.dataset.subcat;
        }
        renderGrid();
      });
    });

    _updateMobileScrollTop();
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
            <img class="k-card-img" src="${optimizeImgUrl(p.image_url, 400)}" alt="${p.name}" loading="lazy">
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
      card.addEventListener('click', (e) => {
        if (e.target.closest('.k-card-fav') || e.target.closest('.k-card-add')) return;
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
    let list = state.activeCat === 'all'
      ? state.filtered
      : state.filtered.filter(p => p.category === state.activeCat);
    // Subcategory filter
    if (state.activeSubcat) {
      const subF = list.filter(p => p.subcategory === state.activeSubcat);
      if (subF.length > 0) list = subF;
    }
    const pageItems = list.slice(0, state.pageSize);

    dom.grid.innerHTML = pageItems.map(p => {
      const inCart = state.cart.find(i => String(i.product.id) === String(p.id));
      const qty = inCart ? inCart.qty : 0;
      return `
        <div class="k-card" data-id="${p.id}">
          <div class="k-card-img-wrap">
            <img class="k-card-img" src="${optimizeImgUrl(p.image_url, 400)}" alt="${p.name}" loading="lazy">
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
      card.addEventListener('click', (e) => {
        if (e.target.closest('.k-card-fav') || e.target.closest('.k-card-add')) return;
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

  // Fix 7 : ring pulse coral ×2 sur l'icône panier
  if (dom.cartBtn) {
    dom.cartBtn.classList.remove('ring-pulse');
    void dom.cartBtn.offsetWidth;
    dom.cartBtn.classList.add('ring-pulse');
    setTimeout(() => dom.cartBtn.classList.remove('ring-pulse'), 1500);
  }

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
    const item = state.cart.find(i => String(i.product.id) === pid);
    if (item) {
      item.qty = newQty;
      saveCart();
      renderCartBody();
      markAllCartButtons();
    }
  }

  function markAllCartButtons() {
    // IDs actuellement dans le panier
    const inCartIds = new Set(state.cart.map(i => String(i.product.id)));

    // Pour chaque bouton "+" de la grille, soit on met le mini-contrôle ±, soit on réinitialise
    document.querySelectorAll('.k-card-add').forEach(btn => {
      const pid = String(btn.dataset.add);
      if (inCartIds.has(pid)) {
        const item = state.cart.find(i => String(i.product.id) === pid);
        btn.classList.add('in-cart');
        btn.innerHTML = '<span class="k-add-minus" data-pid="' + pid + '">−</span><span class="k-add-qty">' + item.qty + '</span><span class="k-add-plus-ic">+</span>';
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
        /* Toggle: re-click same category → back to "Tout" + hide subcats */
        if (cat === state.activeCat && cat !== 'all') {
          $$('.k-chip').forEach(c => c.classList.remove('active'));
          const allChip = document.querySelector('.k-chip[data-cat="all"]');
          if (allChip) allChip.classList.add('active');
          state.activeCat = 'all';
          state.activeSubcat = null;
          renderSubcats('all');
          renderGrid();
          return;
        }
        $$('.k-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        state.activeCat = cat;
        renderSubcats(state.activeCat);
        renderGrid();
        // Scroll vers le haut de la page pour voir le filtre appliqué (pattern B)
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
  }

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
      dom.searchDrop.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:14px">Aucun résultat</div>';
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

  /* ── PRODUCT MODAL ──────────────────────────────────────── */
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

    dom.modalImg.src = optimizeImgUrl(product.image_url, 600);
    dom.modalName.textContent = product.name;
    dom.modalDesc.textContent = product.description || '';
    dom.modalPrice.textContent = fmtPrice(product.price_kmf);
    dom.modalQtyVal.textContent = '1';

    if (product.promo_pct) {
      const old = Math.round(product.price_kmf / (1 - product.promo_pct / 100));
      dom.modalOldPrice.textContent = fmtPrice(old);
      dom.modalOldPrice.style.display = '';
      dom.modalPromoBadge.textContent = `-${product.promo_pct}%`;
      dom.modalPromoBadge.classList.add('show');
    } else {
      dom.modalOldPrice.style.display = 'none';
      dom.modalPromoBadge.classList.remove('show');
    }

    dom.modalCat.textContent = `${product.emoji || ''} ${product.category || ''}`;
    dom.modalStock.textContent = product.stock > 0 ? `✓ En stock (${product.stock})` : '✗ Rupture';
    dom.modalBackLabel.textContent = state.modalHistory.length > 0 ? 'Retour' : 'Catalogue';
    updateCartBadge();

    // Compteur de position dans la liste + boutons ← →
    const list = state.filtered.length ? state.filtered : state.products;
    const currentIdx = list.findIndex(p => p.id === product.id);
    updateModalNavArrows(list, currentIdx);

    const suggestions = state.products
      .filter(p => p.category === product.category && p.id !== product.id)
      .slice(0, 8);
    renderSuggestions(suggestions);

    dom.modal.querySelector('.k-modal-scroll').scrollTop = 0;
    dom.modalOverlay.classList.add('open');
    // Lock body scroll (iOS needs position:fixed)
    state._savedCatalogScrollY = window.scrollY;
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    document.body.style.top = `-${state._savedCatalogScrollY}px`;
  }

  // ── Boutons ← → dans la topbar de la modal
  function updateModalNavArrows(list, currentIdx) {
    let navEl = document.getElementById('k-modal-nav');
    if (!navEl) {
      navEl = document.createElement('div');
      navEl.id = 'k-modal-nav';
      navEl.style.cssText = 'display:flex;align-items:center;gap:4px;';

      const prevBtn = document.createElement('button');
      prevBtn.id = 'k-modal-prev';
      prevBtn.style.cssText = 'width:30px;height:30px;border-radius:50%;background:var(--sand);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:14px;transition:all .15s;';
      prevBtn.innerHTML = '←';
      prevBtn.addEventListener('click', () => navigateModal(-1));

      const counter = document.createElement('span');
      counter.id = 'k-modal-counter';
      counter.style.cssText = 'font-size:11px;color:var(--text-muted);font-weight:600;min-width:36px;text-align:center;';

      const nextBtn = document.createElement('button');
      nextBtn.id = 'k-modal-next';
      nextBtn.style.cssText = 'width:30px;height:30px;border-radius:50%;background:var(--sand);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:14px;transition:all .15s;';
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
    if (prevBtn) prevBtn.style.opacity = currentIdx <= 0 ? '0.3' : '1';
    if (nextBtn) nextBtn.style.opacity = currentIdx >= list.length - 1 ? '0.3' : '1';
  }

  function modalGoBack() {
    if (state.modalHistory.length === 0) { closeModal(); return; }
    const prevId = state.modalHistory.pop();
    openModal(prevId, false);
  }

  function closeModal() {
    dom.modalOverlay.classList.remove('open');
    // Unlock body scroll (reverse iOS fix)
    const scrollY = state._savedCatalogScrollY || 0;
    document.body.style.overflow = '';
    document.body.style.position = '';
    document.body.style.width = '';
    document.body.style.top = '';
    window.scrollTo(0, scrollY);
    state.modalProduct = null;
    state.modalHistory = [];
  }

  function renderSuggestions(items) {
    if (!items.length) {
      const sugSection = document.getElementById('k-modal-suggestions');
      if (sugSection) sugSection.style.display = 'none';
      return;
    }
    const sugSection = document.getElementById('k-modal-suggestions');
    if (sugSection) sugSection.style.display = '';

    dom.sugRail.innerHTML = items.map(p => `
      <div class="k-sug-card" data-id="${p.id}" style="cursor:pointer;">
        <div style="position:relative;">
          <img src="${optimizeImgUrl(p.image_url, 200)}" alt="${sanitize(p.name)}" loading="lazy">
          ${p.promo_pct ? `<span style="position:absolute;top:4px;left:4px;background:var(--coral);color:#fff;font-size:9px;font-weight:700;padding:2px 5px;border-radius:50px;">-${p.promo_pct}%</span>` : ''}
          <button class="k-sug-add" data-add="${p.id}" aria-label="Ajouter">+</button>
        </div>
        <div class="k-sug-card-name">${sanitize(p.name)}</div>
        <div class="k-sug-card-price">${fmtPrice(p.price_kmf)}</div>
      </div>
    `).join('');

    // Clic sur toute la carte → ouvrir le produit
    dom.sugRail.querySelectorAll('.k-sug-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.k-sug-add')) return;
        openModal(card.dataset.id);
      });
    });

    dom.sugRail.querySelectorAll('.k-sug-add').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const product = state.products.find(p => p.id === btn.dataset.add);
        if (!product) return;
        addToCart(product, 1, btn);
      });
    });

    // Fix 4 : flèches ◀▶ coral + masquage aux extrémités
    if (sugSection) {
      let wrapEl = sugSection.querySelector('.k-sug-wrap');
      if (!wrapEl) {
        wrapEl = document.createElement('div');
        wrapEl.className = 'k-sug-wrap';
        wrapEl.style.cssText = 'position:relative;';
        dom.sugRail.parentNode.insertBefore(wrapEl, dom.sugRail);
        wrapEl.appendChild(dom.sugRail);
      }
      wrapEl.querySelectorAll('.k-sug-arrow').forEach(a => a.remove());
      const prevArrow = document.createElement('button');
      prevArrow.className = 'k-sug-arrow prev';
      prevArrow.innerHTML = '◀';
      prevArrow.setAttribute('aria-label', 'Précédent');
      const nextArrow = document.createElement('button');
      nextArrow.className = 'k-sug-arrow next';
      nextArrow.innerHTML = '▶';
      nextArrow.setAttribute('aria-label', 'Suivant');
      wrapEl.appendChild(prevArrow);
      wrapEl.appendChild(nextArrow);
      function syncArrows() {
        prevArrow.hidden = dom.sugRail.scrollLeft <= 2;
        nextArrow.hidden = dom.sugRail.scrollLeft >= dom.sugRail.scrollWidth - dom.sugRail.clientWidth - 10;
      }
      prevArrow.addEventListener('click', () => { dom.sugRail.scrollBy({ left: -240, behavior: 'smooth' }); setTimeout(syncArrows, 350); });
      nextArrow.addEventListener('click', () => { dom.sugRail.scrollBy({ left: 240, behavior: 'smooth' }); setTimeout(syncArrows, 350); });
      dom.sugRail.addEventListener('scroll', syncArrows, { passive: true });
      requestAnimationFrame(syncArrows);
    }
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

    // ── Bouton "⚡ Acheter" — ajoute + ouvre directement le panier (sans animation fly)
    const buyNowBtn = document.getElementById('k-buy-now-btn');
    if (buyNowBtn) {
      buyNowBtn.addEventListener('click', () => {
        if (!state.modalProduct) return;
        // Pas de sourceBtn → pas d'animation fly, pas de setTimeout qui perturbe l'ouverture du panier
        addToCart(state.modalProduct, state.modalQty, null);
        closeModal();
        // Petit délai pour laisser la modal se fermer avant d'ouvrir le drawer
        setTimeout(openCart, 250);
      });
    }

    // ── Swipe down pour fermer (mobile)
    setupModalSwipe();

    // ── Navigation clavier ← → entre produits (desktop)
    document.addEventListener('keydown', (e) => {
      if (!dom.modalOverlay.classList.contains('open')) return;
      if (e.key === 'ArrowRight') navigateModal(1);
      if (e.key === 'ArrowLeft') navigateModal(-1);
      if (e.key === 'Escape') closeModal();
    });
  }

  // ── Swipe down pour fermer + swipe left/right pour naviguer (mobile)
  function setupModalSwipe() {
    const modal = dom.modal;
    let startY = 0, startX = 0, isDragging = false;

    modal.addEventListener('touchstart', (e) => {
      const scrollEl = modal.querySelector('.k-modal-scroll');
      if (scrollEl && scrollEl.scrollTop > 10) return;
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      isDragging = true;
    }, { passive: true });

    modal.addEventListener('touchmove', (e) => {
      if (!isDragging) return;
      const dy = e.touches[0].clientY - startY;
      const dx = e.touches[0].clientX - startX;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);

      // Swipe DOWN pour fermer (si plus vertical qu'horizontal)
      if (dy > 0 && ady > adx) {
        modal.style.transform = `translateY(${dy * 0.4}px)`;
        modal.style.transition = 'none';
        modal.style.opacity = String(Math.max(0.6, 1 - dy / 500));
      }
    }, { passive: true });

    modal.addEventListener('touchend', (e) => {
      if (!isDragging) return;
      isDragging = false;
      const dy = e.changedTouches[0].clientY - startY;
      const dx = e.changedTouches[0].clientX - startX;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);

      modal.style.transition = 'transform .25s var(--ease), opacity .25s';
      modal.style.opacity = '';

      // Swipe down → fermer
      if (dy > 100 && ady > adx) {
        modal.style.transform = 'translateY(100%)';
        setTimeout(() => { modal.style.transform = ''; closeModal(); }, 260);
      }
      // Swipe left → produit suivant
      else if (dx < -60 && adx > ady) {
        modal.style.transform = '';
        navigateModal(1);
      }
      // Swipe right → produit précédent
      else if (dx > 60 && adx > ady) {
        modal.style.transform = '';
        navigateModal(-1);
      }
      else {
        modal.style.transform = '';
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
    document.body.style.overflow = 'hidden';
  }

  function closeCart() {
    dom.cartOverlay.classList.remove('open');
    dom.cartDrawer.classList.remove('open');
    document.body.style.overflow = '';
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
    document.body.style.overflow = 'hidden';

    setTimeout(() => {
      const newItem = dom.cartBody.querySelector('.k-cart-item.new-item');
      if (newItem) newItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 120);
  }

  function renderCartBody(highlightId) {
    dom.cartBody.innerHTML = '';

    if (state.cart.length === 0) {
      dom.cartBody.innerHTML = `
        <div class="k-cart-empty">
          <div class="k-cart-empty-icon">🧺</div>
          <p>Votre panier est vide</p>
        </div>`;
      dom.cartFooter.style.display = 'none';
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
    dom.cartFooter.style.display = 'block';
    dom.cartTotalVal.textContent = fmt(cartTotal(), 'KMF');
    if (_currency === 'EUR') {
      dom.cartTotalConv.textContent = '≈ ' + fmt(cartTotal(), 'EUR');
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
          document.body.style.overflow = 'hidden';
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
            document.body.style.overflow = 'hidden';
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
    document.body.style.overflow = 'hidden';
  }

  function closeOrderModal() {
    dom.orderModal.classList.remove('open');
    document.body.style.overflow = '';
    if (typeof window._savedScrollY === 'number') {
      window.scrollTo(0, window._savedScrollY);
      window._savedScrollY = 0;
    }
  }

  function renderCheckout() {
    const body = dom.orderBody;
    body.innerHTML = '';
    // Supprimer tout bouton confirm précédent hors scroll area
    body.parentElement.querySelectorAll('.ck-confirm-btn').forEach(b => b.remove());
    dom.orderTitle.textContent = '🛒 Commander';

    const od = state.orderData;

    /* ── Récap retiré (mini résumé + miniatures) ── */

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
    stripeCardWrap.style.cssText = 'display:none;margin-top:8px;padding:10px 14px 10px;background:#fff;border:1px solid var(--sand-dark);border-radius:10px;';
    stripeCardWrap.innerHTML = '<div style="font-size:0.75rem;font-weight:700;color:var(--ocean);margin-bottom:6px;">🔒 Informations de carte</div>'
      + '<div id="stripe-card-element" style="padding:10px 12px;border:1.5px solid rgba(0,0,0,0.12);border-radius:8px;background:#fff;min-height:44px;cursor:text;"></div>'
      + '<div id="stripe-card-error" style="color:#dc2626;font-size:0.75rem;margin-top:5px;display:none;"></div>'
      + '<div id="stripe-eur-display" style="display:none;text-align:center;font-size:0.82rem;color:var(--ocean);font-weight:700;margin-top:6px;padding-bottom:4px;"></div>';
    body.appendChild(stripeCardWrap);

    /* ── 4. Suivi SMS accordion ── */
    const trackRow = document.createElement('div');
    trackRow.className = 'ck-track-row';
    trackRow.innerHTML = '<label class="ck-track-label" style="font-size:0.8rem;font-weight:600;display:block;margin-bottom:3px;">📲 Votre tél. pour le suivi (optionnel)</label>';
    body.appendChild(trackRow);

    const trackExtra = document.createElement('div');
    trackExtra.id = 'ck-track-extra';
    trackExtra.className = 'ck-track-extra';
    // Toujours visible — plus besoin de cocher une case
    trackExtra.style.display = 'block';
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
    walletSection.style.cssText = 'margin-top:8px;padding:10px 12px;border:2px dashed var(--ocean);border-radius:8px;background:linear-gradient(135deg,#f0f5e6,#e8eddb);display:none;';
    walletSection.innerHTML = '<label style="display:flex;align-items:center;gap:10px;cursor:pointer;">'
      + '<input type="checkbox" id="cb-use-wallet" style="width:18px;height:18px;accent-color:var(--ocean);flex-shrink:0;">'
      + '<div style="flex:1;"><div style="font-weight:700;font-size:0.85rem;color:var(--ocean);">💰 Utiliser mon crédit</div>'
      + '<div id="wallet-balance-text" style="font-size:0.72rem;color:#888;margin-top:1px;">Chargement…</div></div></label>'
      + '<div id="wallet-deduction" style="margin-top:6px;padding:6px 8px;background:white;border-radius:6px;font-size:0.82rem;display:none;"></div>';
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
        wrap.style.display = isStripe ? 'block' : 'none';
        if (isStripe) { const ed = document.getElementById('stripe-eur-display'); if (ed) ed.style.display = 'block'; }
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
          if (errEl) { errEl.textContent = ev.error ? ev.error.message : ''; errEl.style.display = ev.error ? 'block' : 'none'; }
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
    div.style.cssText = 'font-weight:700;font-size:0.85rem;margin-bottom:6px;margin-top:10px;';
    div.textContent = text;
    return div;
  }

  function makeInput(id, label, type, placeholder, dataObj, key) {
    const group = document.createElement('div');
    group.style.cssText = 'margin-bottom:8px;';
    const lbl = document.createElement('label');
    lbl.style.cssText = 'display:block;font-size:0.8rem;font-weight:600;margin-bottom:3px;';
    lbl.textContent = label;
    group.appendChild(lbl);
    const input = document.createElement('input');
    input.type = type;
    input.id = id;
    input.placeholder = placeholder;
    input.value = dataObj[key] || '';
    input.style.cssText = 'width:100%;padding:9px 12px;border:2px solid rgba(0,0,0,0.1);border-radius:8px;outline:none;font-size:0.9rem;transition:border-color 0.2s;box-sizing:border-box;';
    input.addEventListener('focus', () => { input.style.borderColor = 'var(--coral)'; });
    input.addEventListener('blur', () => { input.style.borderColor = 'rgba(0,0,0,0.1)'; });
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
  group.style.cssText = 'margin-bottom:8px;';

  const lbl = document.createElement('label');
  lbl.style.cssText = 'display:block;font-size:0.8rem;font-weight:600;margin-bottom:3px;';
  lbl.textContent = label;
  group.appendChild(lbl);

  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;height:40px;gap:6px;';

  const sel = document.createElement('select');
  sel.id = id + '-country';
  sel.style.cssText =
    'height:40px;flex:0 0 112px;border:2px solid rgba(0,0,0,0.1);border-radius:8px;' +
    'background:#fff;padding:0 8px;font-size:0.9rem;outline:none;';
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
  input.style.cssText =
    'height:40px;flex:1;border:2px solid rgba(0,0,0,0.1);border-radius:8px;' +
    'padding:0 12px;outline:none;font-size:0.9rem;box-sizing:border-box;background:#fff;';

  const help = document.createElement('div');
  help.style.cssText = 'font-size:0.72rem;color:#777;margin-top:4px;';
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

  input.addEventListener('focus', () => { input.style.borderColor = 'var(--coral)'; sel.style.borderColor = 'var(--coral)'; });
  input.addEventListener('blur',  () => { input.style.borderColor = 'rgba(0,0,0,0.1)'; sel.style.borderColor = 'rgba(0,0,0,0.1)'; sync(); });
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
    group.style.cssText = 'margin-bottom:8px;';
    if (label) {
      const lbl = document.createElement('label');
      lbl.style.cssText = 'display:block;font-size:0.75rem;font-weight:600;color:#666;margin-bottom:3px;';
      lbl.textContent = label;
      group.appendChild(lbl);
    }
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;height:40px;';
    const prefix = document.createElement('div');
    prefix.style.cssText = [
      'display:flex;align-items:center;gap:4px',
      'padding:0 10px',
      'background:#f5f5f2',
      'border:1.5px solid rgba(0,0,0,0.12)',
      'border-right:none',
      'border-radius:8px 0 0 8px',
      'font-size:12px;font-weight:700;color:#555',
      'white-space:nowrap;flex-shrink:0',
    ].join(';');
    prefix.innerHTML = '🇰🇲 <span style="color:#888">+269</span>';
    wrap.appendChild(prefix);
    const input = document.createElement('input');
    input.type = 'tel';
    input.id = id;
    input.placeholder = '321 12 34';
    input.value = dataObj[key] || '';
    input.maxLength = 10;
    input.style.cssText = [
      'flex:1;height:100%',
      'border:1.5px solid rgba(0,0,0,0.12)',
      'border-left:none',
      'border-radius:0 8px 8px 0',
      'padding:0 12px',
      'font-size:14px;font-family:inherit',
      'outline:none;background:#fff',
      'transition:border-color .15s',
    ].join(';');
    const focusBorder = () => { input.style.borderColor = 'var(--ocean)'; prefix.style.borderColor = 'var(--ocean)'; };
    const blurBorder = () => { input.style.borderColor = 'rgba(0,0,0,0.12)'; prefix.style.borderColor = 'rgba(0,0,0,0.12)'; };
    input.addEventListener('focus', focusBorder);
    input.addEventListener('blur', blurBorder);
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
    wrapper.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 14px;border:2px solid ' + (checked ? 'var(--ocean)' : 'rgba(0,0,0,0.08)') + ';border-radius:8px;margin-bottom:6px;cursor:pointer;background:' + (checked ? 'rgba(67,160,71,0.06)' : 'white') + ';';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'payment_mode';
    radio.value = value;
    radio.checked = checked;
    radio.style.cssText = 'width:16px;height:16px;accent-color:var(--ocean);flex-shrink:0;';
    wrapper.appendChild(radio);
    const info = document.createElement('div');
    info.innerHTML = '<div style="font-weight:700;font-size:0.88rem;">' + title + '</div><div style="font-size:0.75rem;color:#888;margin-top:1px;">' + subtitle + '</div>';
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
          section.style.display = 'block';
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
      ded.style.display = 'block';
      ded.innerHTML = '<div style="display:flex;justify-content:space-between;"><span>💰 Crédit appliqué</span><span style="font-weight:700;color:var(--ocean)">-' + fmt(applied, 'KMF') + '</span></div>' +
        (remaining > 0 ? '<div style="display:flex;justify-content:space-between;margin-top:4px;"><span>Reste à payer</span><span style="font-weight:700">' + fmt(remaining, 'KMF') + '</span></div>' : '<div style="margin-top:4px;text-align:center;font-weight:700;color:#16a34a;">✅ Entièrement couvert par votre crédit !</div>');
    } else {
      ded.style.display = 'none';
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
  const fullRecipPhone = '+269' + recipPhone.replace(/\s/g, '');
  const clientEmail = undefined;

  if (!recipName) {
    showToast('Indiquez le nom de la personne qui récupère.', 'error');
    return;
  }
  if (!recipPhone) {
    showToast('Indiquez le téléphone du bénéficiaire (+269).', 'error');
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
          errEl.style.display = 'block';
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

    // Fix 11 : retirer le bouton Confirmer sticky
    body.parentElement.querySelectorAll('.ck-confirm-btn').forEach(b => b.remove());

    // Fix 14 : notice WhatsApp simplifiée
    const hasDiaspora = state.orderData && (state.orderData.sender_phone || '').trim().length >= 8;
    const waNotice = hasDiaspora
      ? '📲 Le bénéficiaire et vous recevrez une confirmation WhatsApp'
      : '📲 Le bénéficiaire recevra une confirmation WhatsApp';

    const wrap = document.createElement('div');
    wrap.style.cssText = 'text-align:center;padding:14px 0;';

    wrap.innerHTML = '<div style="font-size:3.2rem;margin-bottom:8px;">🎉</div>'
      + '<h3 style="color:var(--ocean);margin-bottom:6px;font-size:1.1rem;">Commande enregistrée !</h3>'
      + '<p style="color:#888;font-size:0.85rem;margin-bottom:2px;">Votre référence :</p>'
      + '<div style="display:inline-block;background:rgba(67,160,71,0.08);color:var(--ocean);font-weight:800;font-size:1.15rem;padding:8px 20px;border-radius:10px;margin:6px 0;letter-spacing:2px;font-family:monospace;">' + sanitize(order.reference || '—') + '</div>'
      + '<div><button id="k-copy-ref-btn" style="margin-top:2px;background:none;border:none;color:var(--text-muted);font-size:0.75rem;cursor:pointer;text-decoration:underline;">📋 Copier la référence</button></div>';

    if (order.cash_ref_code && order.payment_mode === 'cash_relais') {
      wrap.innerHTML += '<p style="margin-top:10px;font-weight:700;font-size:0.88rem;">🏪 Code de paiement au relais :</p>'
        + '<div style="display:inline-block;background:#fffbeb;color:#92400e;font-weight:800;font-size:1.15rem;padding:8px 22px;border-radius:10px;margin:6px 0;letter-spacing:2px;border:2px solid #fde68a;font-family:monospace;">' + sanitize(order.cash_ref_code) + '</div>';
    }

    if (fullResult && fullResult.discount_pct > 0) {
      wrap.innerHTML += '<div style="margin-top:10px;padding:8px 12px;background:#ecfdf5;border-radius:8px;border:1px solid #a7f3d0;font-size:0.82rem;color:#065f46;font-weight:600;">🎁 Fidélité ' + sanitize(fullResult.loyalty_label || '') + ' : -' + fullResult.discount_pct + '% (-' + fmt(fullResult.discount_kmf, 'KMF') + ')</div>';
    }

    if (fullResult && fullResult.credit_applied_kmf > 0) {
      wrap.innerHTML += '<div style="margin-top:6px;padding:8px 14px;background:linear-gradient(135deg,#f0f5e6,#e8eddb);border-radius:8px;font-size:0.85rem;text-align:center;">💰 Crédit boutique appliqué : <strong style="color:var(--ocean)">-' + fmt(fullResult.credit_applied_kmf, 'KMF') + '</strong></div>';
    }

    wrap.innerHTML += '<div style="margin-top:12px;padding:10px 12px;background:#eef2e4;border-radius:10px;font-size:0.82rem;color:#555;line-height:1.6;text-align:left;">'
      + '<div>🏪 Paiement en cash (KMF) au point relais lors du retrait.</div>'
      + '<div style="margin-top:4px;">' + sanitize(waNotice) + '</div>'
      + '<div style="margin-top:4px;">📍 Présentez la référence au point relais.</div></div>';

    // Fix 12 : bouton Fermer avec countdown
    wrap.innerHTML += '<button id="k-order-track-btn" style="margin-top:12px;width:100%;padding:11px;border-radius:8px;font-weight:700;font-size:0.9rem;background:var(--ocean);color:white;border:none;cursor:pointer;">📍 Suivre ma commande</button>'
      + '<button id="k-order-close-btn" style="margin-top:6px;width:100%;padding:10px;border-radius:8px;font-weight:600;font-size:0.85rem;background:#eef2e4;color:var(--text);border:1px solid rgba(0,0,0,0.08);cursor:pointer;">Fermer (7)</button>';

    body.appendChild(wrap);

    setTimeout(() => {
      // Copier référence
      const copyBtn = document.getElementById('k-copy-ref-btn');
      if (copyBtn) {
        copyBtn.addEventListener('click', () => {
          if (navigator.clipboard) {
            navigator.clipboard.writeText(order.reference || '').then(() => showToast('📋 Référence copiée !'));
          }
        });
      }

      // Fix 12 : auto-fermeture 7s avec countdown visible
      const closeBtn = document.getElementById('k-order-close-btn');
      let countdown = 7;
      const autoTimer = setInterval(() => {
        countdown--;
        if (closeBtn) closeBtn.textContent = 'Fermer (' + countdown + ')';
        if (countdown <= 0) {
          clearInterval(autoTimer);
          closeOrderModal();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }, 1000);

      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          clearInterval(autoTimer);
          closeOrderModal();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      }

      // Fix 13 : "Suivre" → bascule onglet Track + pré-remplit + auto-search
      const trackBtn = document.getElementById('k-order-track-btn');
      if (trackBtn) {
        trackBtn.addEventListener('click', () => {
          clearInterval(autoTimer);
          closeOrderModal();
          renderTrackView();
          switchView('track');
          $$('.k-bnav-item').forEach(i => i.classList.remove('active'));
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
    spinner.innerHTML = '<div class="k-spinner" style="width:22px;height:22px"></div>';
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
    if (!favProducts.length) {
      el.innerHTML = `<h2>❤️ Favoris</h2>
        <div class="k-fav-empty">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
          <p>Aucun favori pour l'instant</p>
          <p style="font-size:12px">Appuie sur 🤍 sur un produit pour l'ajouter ici</p>
        </div>`;
    } else {
      const cardsHTML = favProducts.map(p => {
        const inCart = state.cart.find(i => String(i.product.id) === String(p.id));
        const qty = inCart ? inCart.qty : 0;
        return `<div class="k-card" data-id="${p.id}">
          <div class="k-card-img-wrap">
            <img class="k-card-img" src="${optimizeImgUrl(p.image_url, 400)}" alt="${sanitize(p.name)}" loading="lazy">
            ${p.promo_pct ? `<span class="k-card-promo">-${p.promo_pct}%</span>` : ''}
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

      el.innerHTML = `<h2>❤️ Favoris <span style="font-size:14px;font-weight:400;color:var(--text-muted)">${favProducts.length} produit${favProducts.length > 1 ? 's' : ''}</span></h2>
        <div class="k-grid" id="k-fav-grid">${cardsHTML}</div>`;

      const favGrid = document.getElementById('k-fav-grid');
      if (favGrid) {
        favGrid.querySelectorAll('.k-card').forEach(card => {
          card.addEventListener('click', (e) => {
            if (e.target.closest('.k-card-fav') || e.target.closest('.k-card-add')) return;
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
    }
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
      container.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-muted);">Aucune commande trouvée.</div>';
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

    const otpState = { phone: '' };

    el.innerHTML = `
      <h2>📦 Suivi & Historique</h2>

      <!-- Étape 1 : identification par téléphone -->
      <div id="k-otp-step1">
        <p class="k-otp-hint">Entrez votre numéro de téléphone pour recevoir un code par WhatsApp et accéder à vos commandes.</p>
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
        <div class="k-otp-divider"><span>ou</span></div>
        <div class="k-track-form">
          <input class="k-track-input" id="k-otp-ref" type="text" placeholder="Référence : KMR-2025-0042" autocomplete="off" style="text-transform:uppercase">
          <button class="k-track-btn k-track-btn--ghost" id="k-otp-ref-btn">Suivre sans code</button>
        </div>
      </div>

      <!-- Étape 2 : saisie OTP WhatsApp -->
      <div id="k-otp-step2" style="display:none">
        <div class="k-otp-sent-banner">
          📲 Code WhatsApp envoyé au <strong id="k-otp-phone-display"></strong><br>
          <small>Vérifiez vos messages WhatsApp. Code valable 10 min.</small>
        </div>
        <input class="k-otp-code-input" id="k-otp-code" type="text" inputmode="numeric" placeholder="_ _ _ _ _ _" maxlength="6" autocomplete="one-time-code">
        <button class="k-track-btn" id="k-otp-verify-btn">Vérifier</button>
        <button class="k-otp-resend-btn" id="k-otp-resend-btn">Renvoyer le code</button>
      </div>

      <!-- Étape 3 : résultats -->
      <div id="k-otp-step3" style="display:none">
        <div id="k-orders-list"></div>
        <button class="k-otp-resend-btn" id="k-otp-back-btn" style="margin-top:16px">← Nouvelle recherche</button>
      </div>`;

    /* Helper: build full E.164 phone from inputs */
    function getFullPhone() {
      const countryCode = el.querySelector('#k-otp-country').value;
      let digits = (el.querySelector('#k-otp-phone').value || '').replace(/\D/g, '');
      // Strip leading 0 for countries that use it
      if (['+33','+262','+32','+41','+44','+971','+212'].includes(countryCode) && digits.startsWith('0')) {
        digits = digits.slice(1);
      }
      return countryCode + digits;
    }

    /* ── Step 1a : request OTP by phone (WhatsApp) ── */
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
        el.querySelector('#k-otp-step1').style.display = 'none';
        el.querySelector('#k-otp-step2').style.display = 'block';
        showToast('📲 Code WhatsApp envoyé !', 'success');
      } catch(e) {
        const msg = e?.message || 'Erreur lors de l\'envoi.';
        showToast(msg, 'error');
        btn.disabled = false; btn.textContent = '📲 Envoyer le code';
      }
    });

    /* ── Step 1b : direct reference lookup (no auth) ── */
    el.querySelector('#k-otp-ref-btn').addEventListener('click', async () => {
      const ref = el.querySelector('#k-otp-ref').value.trim().toUpperCase();
      if (!ref) { showToast('Entrez une référence de commande.', 'error'); return; }
      const btn = el.querySelector('#k-otp-ref-btn');
      btn.disabled = true; btn.textContent = '⏳ Recherche…';
      try {
        const data = await apiGet('/api/orders/public/' + encodeURIComponent(ref));
        el.querySelector('#k-otp-step1').style.display = 'none';
        el.querySelector('#k-otp-step3').style.display = 'block';
        renderOrderDetail(data.order || data, el.querySelector('#k-orders-list'));
      } catch(e) {
        showToast('Référence introuvable.', 'error');
        btn.disabled = false; btn.textContent = 'Suivre sans code';
      }
    });

    /* ── Step 2 : verify OTP → then fetch orders from /client/tracking ── */
    el.querySelector('#k-otp-verify-btn').addEventListener('click', async () => {
      const code = el.querySelector('#k-otp-code').value.replace(/\s/g, '');
      if (code.length < 4) { showToast('Entrez le code complet.', 'error'); return; }
      const btn = el.querySelector('#k-otp-verify-btn');
      btn.disabled = true; btn.textContent = '⏳ Vérification…';
      try {
        // Verify OTP — sets kmrc_client cookie
        const verifyResult = await apiPost('/api/auth/otp/verify', { phone: otpState.phone, code });
        showToast('✅ Vérifié — chargement de vos commandes…', 'success');

        // Fetch orders using the JWT cookie
        try {
          const trackingData = await apiGet('/api/client/tracking');
          el.querySelector('#k-otp-step2').style.display = 'none';
          el.querySelector('#k-otp-step3').style.display = 'block';
          const orders = (trackingData.orders || []).map(o => ({
            ...o,
            total_amount: o.totalKmf || o.total_kmf || o.total_amount || 0,
            created_at: o.createdAt || o.created_at
          }));
          renderOrdersHistory(orders, el.querySelector('#k-orders-list'));
        } catch(trackErr) {
          // Fallback: show verification success even if tracking fails
          el.querySelector('#k-otp-step2').style.display = 'none';
          el.querySelector('#k-otp-step3').style.display = 'block';
          el.querySelector('#k-orders-list').innerHTML = `
            <div style="text-align:center;padding:24px;color:var(--text-muted);">
              <p>✅ Numéro vérifié ! Bienvenue <strong>${verifyResult.user?.name || ''}</strong></p>
              <p style="margin-top:8px;">Aucune commande trouvée pour ce numéro.</p>
            </div>`;
        }
      } catch(e) {
        const msg = e?.message || 'Code incorrect ou expiré.';
        showToast(msg, 'error');
        btn.disabled = false; btn.textContent = 'Vérifier';
      }
    });

    /* ── Step 2 : resend ── */
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

    /* ── Step 3 : back ── */
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
    if (catalog) catalog.style.display = tab === 'shop' ? '' : 'none';
    if (favView) favView.classList.toggle('show', tab === 'fav');
    if (trackView) trackView.classList.toggle('show', tab === 'track');
    // Also hide promo section when not on shop
    const promoSec = document.getElementById('k-promos-section');
    if (promoSec) promoSec.style.display = tab === 'shop' ? '' : 'none';
    // Hide hero+categories on non-shop tabs
    if (heroWrap) heroWrap.style.display = tab === 'shop' ? '' : 'none';
    // Adjust scroll container: on shop = below hero, on other tabs = below header only
    if (pageScroll) pageScroll.style.top = tab === 'shop' ? '' : '44px';
    // Close cart drawer if open
    const cartOverlay = document.getElementById('k-cart-overlay');
    const cartDrawer = document.getElementById('k-cart-drawer');
    if (cartOverlay) cartOverlay.classList.remove('open');
    if (cartDrawer) cartDrawer.classList.remove('open');
    document.body.style.overflow = '';
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
})();
