/* ═══════════════════════════════════════════════════════════
   KOMERCE — Boutique JS v2.0 "Archipel"
   Full cart/checkout mechanism ported from original
   Depends on: komerce-api.js (K global), Stripe (optional)
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── HELPERS ───────────────────────────────────────────── */
  function optimizeImgUrl(url, w) {
    if (!url || url.indexOf('res.cloudinary.com') === -1) return url;
    if (url.indexOf('f_auto') !== -1) return url;
    return url.replace('/upload/', '/upload/f_auto,q_auto' + (w ? ',w_' + w : '') + '/');
  }

  function promoImgUrl(url, w) {
    // Essaie l'image détourée (uploadée par le trigger rembg) → fallback original
    if (!url || url.indexOf('res.cloudinary.com') === -1) return url;
    try {
      // Extrait le basename : "mod_034" depuis ".../komerce/products/mode/mod_034.jpg"
      const parts = url.split('/upload/');
      if (parts.length < 2) return optimizeImgUrl(url, w);
      const pathPart = parts[1].replace(/^v\d+\//, ''); // retire version
      const basename = pathPart.split('/').pop().replace(/\.[^.]+$/, ''); // sans ext
      const wParam = w ? ',w_' + w : '';
      return 'https://res.cloudinary.com/dloffvvdz/image/upload/f_auto,q_auto' + wParam + '/komerce/promos_bg/' + basename + '.png';
    } catch(e) {
      return optimizeImgUrl(url, w);
    }
  }

  window.promoImgFallback = function(el, url, w) {
    // Appelé via onerror si l'image détourée n'existe pas encore
    el.onerror = null;
    el.src = url.indexOf('res.cloudinary.com') !== -1
      ? url.replace('/upload/', '/upload/f_auto,q_auto' + (w ? ',w_' + w : '') + '/')
      : url;
  };

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

  async function apiPost(path, body) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    } finally { clearTimeout(t); }
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
    cart: initialCart,        // [{product: {...}, qty: N}]
    favs: JSON.parse(localStorage.getItem('k_favs') || '[]'),
    activeCat: 'all',
    modalProduct: null,
    modalQty: 1,
    modalHistory: [],
    searchTimeout: null,
    relais: [],
    orderData: { payment_mode: 'cash_relais' },
    walletBalance: 0,
    page: 0,
    pageSize: 16,
  };

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
    buyNowBtn: $('#k-buy-now-btn'),
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
  /* ── RICH TOAST (after cart add) ────────────────────────────── */
  function showRichToast(product) {
    const qty = cartQty();
    const imgSrc = product.image_url ? optimizeImgUrl(product.image_url, 80) : '';
    const emoji = product.emoji || '🛍';
    dom.toast.innerHTML = `
      <div class="k-toast-inner k-toast-rich">
        ${imgSrc
          ? `<img class="k-toast-thumb" src="${imgSrc}" alt="" onerror="this.style.display='none'">`
          : `<span class="k-toast-emoji">${emoji}</span>`}
        <div class="k-toast-body">
          <span class="k-toast-label">✓ Ajouté</span>
          <span class="k-toast-name">${product.name}</span>
        </div>
        <button class="k-toast-cta" id="k-toast-cta-btn">Voir&nbsp;(${qty})&nbsp;→</button>
      </div>`;
    dom.toast.className = 'k-toast show';
    clearTimeout(dom.toast._t);
    dom.toast._t = setTimeout(() => dom.toast.classList.remove('show'), 3500);
    const cta = document.getElementById('k-toast-cta-btn');
    if (cta) cta.addEventListener('click', () => { dom.toast.classList.remove('show'); openCart(); });
  }

  /* ── MODAL ADD BUTTON TRANSFORM ─────────────────────────────── */
  function transformAddBtn() {
    const qty = cartQty();
    dom.addCartBtn.classList.add('confirmed');
    dom.addCartBtn.innerHTML =
      '<span class="k-btn-done">✓ Dans le panier</span>' +
      '<span class="k-btn-sep">|</span>' +
      '<span class="k-btn-see">Voir (' + qty + ') →</span>';
  }

  /* ── BUY NOW (add + go straight to checkout) ─────────────────── */
  function buyNow(product, qty) {
    addToCart(product, qty || 1, null, { skipFeedback: true });
    closeModal();
    setTimeout(() => { openCart(); }, 200);
  }

    function showToast(msg, type) {
    type = type || '';
    dom.toast.innerHTML = '<div class="k-toast-inner k-toast-simple"><span>' + msg + '</span></div>';
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
    const list = state.activeCat === 'all'
      ? state.filtered
      : state.filtered.filter(p => p.category === state.activeCat);
    const start = (state.page + 1) * state.pageSize;
    if (start >= list.length) {
      if (spinner) spinner.classList.remove('show');
      return;
    }
    state.page += 1;
    const nextItems = list.slice(start, start + state.pageSize);
    const fragment = nextItems.map(p => buildCardHTML(p)).join('');
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
    showSkeletons(16);
    dom.loading.classList.add('show');
    try {
      const data = await K.products.list();
      state.products = (Array.isArray(data) ? data : data.products || [])
        .filter(p => p.is_available);
      state.filtered = [...state.products];
      renderPromos();
      hideSkeletons();
      renderGrid();
    } catch (e) {
      showToast('Erreur de chargement', 'error');
      console.error(e);
    } finally {
      dom.loading.classList.remove('show');
    }
  }

  /* ── RENDER PROMOS ──────────────────────────────────────── */
  function renderPromos() {
    const promos = state.products.filter(p => p.promo_pct > 0).slice(0, 10);
    dom.promoRail.innerHTML = promos.map(p => {
      const oldPrice = Math.round(p.price_kmf / (1 - p.promo_pct / 100));
      return `
        <div class="k-promo-card" data-id="${p.id}">
          <img class="k-promo-card-img" src="${promoImgUrl(p.image_url, 400)}" onerror="promoImgFallback(this,'${p.image_url}',400)" alt="${p.name}" loading="lazy">
          <span class="k-promo-badge">-${p.promo_pct}%</span>
          <div class="k-promo-card-info">
            <div class="k-promo-card-name">${p.name}</div>
            <div>
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

  /* ── CARD BUILDER (helper partagé renderGrid + appendNextPage) ── */
  const KMF_TO_EUR = 491.97;
  function buildCardHTML(p) {
    const inCart = state.cart.find(i => String(i.product.id) === String(p.id));
    const qty    = inCart ? inCart.qty : 0;
    const catLabel = p.category ? p.category.replace(/_/g,' ').toUpperCase() : '';
    const eurPrice = Math.round(p.price_kmf / KMF_TO_EUR);
    const oldKmf   = p.promo_pct ? Math.round(p.price_kmf / (1 - p.promo_pct / 100)) : 0;
    return `
      <div class="k-card" data-id="${p.id}">
        <div class="k-card-img-wrap">
          <img class="k-card-img" src="${optimizeImgUrl(p.image_url, 400)}" alt="${p.name}" loading="lazy">
          ${p.promo_pct ? `<span class="k-card-promo">-${p.promo_pct}%</span>` : ''}
          <button class="k-card-fav${isFav(p.id) ? ' liked' : ''}" data-fav="${p.id}" aria-label="Favori">
            ${isFav(p.id) ? '❤️' : '🤍'}
          </button>
          <button class="k-card-add${qty > 0 ? ' in-cart' : ''}" data-add="${p.id}" aria-label="Ajouter">
            ${qty > 0
              ? `<span class="k-add-minus" data-pid="${p.id}">−</span><span class="k-add-qty">${qty}</span><span class="k-add-plus-ic">+</span>`
              : '<span class="k-card-add-plus">+</span>'}
          </button>
        </div>
        <div class="k-card-info">
          ${catLabel ? `<div class="k-card-category">${catLabel}</div>` : ''}
          <div class="k-card-name">${p.name}</div>
          <div class="k-card-bottom">
            <div class="k-card-prices">
              <span class="k-card-price">${fmtPrice(p.price_kmf)}</span>
              ${p.promo_pct ? `<span class="k-card-old-price">${fmtPrice(oldKmf)}</span>` : ''}
              <span class="k-card-eur">≈ ${eurPrice} €</span>
            </div>
            <span class="k-card-avail">✓ Dispo</span>
          </div>
        </div>
      </div>`;
  }

  /* ── RENDER GRID ────────────────────────────────────────── */
  function renderGrid() {
    state.page = 0;
    const list = state.activeCat === 'all'
      ? state.filtered
      : state.filtered.filter(p => p.category === state.activeCat);
    const pageItems = list.slice(0, state.pageSize);

    dom.grid.innerHTML = pageItems.map(p => buildCardHTML(p)).join('');

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
      'border-radius:50%', 'background:var(--coral)',
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
  function addToCart(product, qty, sourceBtn, opts) {
    qty = qty || 1;
    const existing = state.cart.find(i => String(i.product.id) === String(product.id));
    if (existing) {
      existing.qty += qty;
    } else {
      state.cart.push({ product: product, qty: qty });
    }

    // Fly animation
    if (sourceBtn) {
      flyToCart(sourceBtn, product);
    }

    saveCart();

    // Mark button feedback
    if (sourceBtn) {
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

    // Ring pulse on cart icon
    dom.cartBtn.classList.remove('ring-pulse');
    void dom.cartBtn.offsetWidth;
    dom.cartBtn.classList.add('ring-pulse');
    setTimeout(() => dom.cartBtn.classList.remove('ring-pulse'), 1500);

    // Smart feedback — no drawer interrupt
    if (opts && opts.fromModal) {
      transformAddBtn();
    } else if (!opts || !opts.skipFeedback) {
      showRichToast(product);
    }
  }

  function removeFromCart(productId) {
    const pid = String(productId);
    state.cart = state.cart.filter(i => String(i.product.id) !== pid);
    saveCart();
    renderCartBody();
    // Un-mark grid buttons
    document.querySelectorAll(`.k-card-add[data-add="${pid}"]`).forEach(btn => {
      btn.classList.remove('in-cart');
      btn.innerHTML = '<span class="k-card-add-plus">+</span>';
    });
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
    state.cart.forEach(item => {
      document.querySelectorAll(`.k-card-add[data-add="${item.product.id}"]`).forEach(btn => {
        btn.classList.add('in-cart');
        btn.innerHTML = '<span class="k-add-minus" data-pid="' + item.product.id + '">−</span><span class="k-add-qty">' + item.qty + '</span><span class="k-add-plus-ic">+</span>';
      });
    });
  }

  /* ── QUICK ADD FROM GRID ────────────────────────────────── */
  function quickAdd(productId, btnEl) {
    const product = state.products.find(p => p.id === productId);
    if (!product) return;
    addToCart(product, 1, btnEl);  // showRichToast called inside
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
        $$('.k-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        state.activeCat = chip.dataset.cat;
        renderGrid();
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

    if (pushHistory !== false && state.modalProduct) {
      state.modalHistory.push(state.modalProduct.id);
    }

    state.modalProduct = product;
    state.modalQty = 1;

    // Reset add button to default state
    dom.addCartBtn.classList.remove('confirmed');
    dom.addCartBtn.innerHTML = '<img src="/images/panier_tresse.png" width="20" height="20" alt="" style="vertical-align:middle"> Ajouter';

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

    // If product already in cart, show confirmed state
    if (state.cart.find(i => String(i.product.id) === String(product.id))) {
      transformAddBtn();
    }

    const suggestions = state.products
      .filter(p => p.category === product.category && p.id !== product.id)
      .slice(0, 8);
    renderSuggestions(suggestions);

    dom.modal.querySelector('.k-modal-scroll').scrollTop = 0;
    dom.modalOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function modalGoBack() {
    if (state.modalHistory.length === 0) { closeModal(); return; }
    const prevId = state.modalHistory.pop();
    openModal(prevId, false);
  }

  function closeModal() {
    dom.modalOverlay.classList.remove('open');
    document.body.style.overflow = '';
    state.modalProduct = null;
    state.modalHistory = [];
  }

  function renderSuggestions(items) {
    dom.sugRail.innerHTML = items.map(p => `
      <div class="k-sug-card" data-id="${p.id}">
        <img src="${optimizeImgUrl(p.image_url, 200)}" alt="${p.name}" loading="lazy">
        <button class="k-sug-add" data-add="${p.id}">+</button>
        <div class="k-sug-card-name">${p.name}</div>
        <div class="k-sug-card-price">${fmtPrice(p.price_kmf)}</div>
      </div>
    `).join('');

    dom.sugRail.querySelectorAll('.k-sug-card').forEach(card => {
      card.querySelector('img').addEventListener('click', () => openModal(card.dataset.id));
    });

    dom.sugRail.querySelectorAll('.k-sug-add').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const product = state.products.find(p => p.id === btn.dataset.add);
        if (!product) return;
        addToCart(product, 1, btn);
        showToast(`${product.emoji || '✓'} ${product.name} ajouté`);
      });
    });

    // Flèches navigation
    const wrap = dom.sugRail.closest('.k-sug-wrap') || dom.sugRail.parentElement;
    wrap.classList.add('k-sug-wrap');
    // Supprimer anciennes flèches si re-render
    wrap.querySelectorAll('.k-sug-arrow').forEach(a => a.remove());

    const scrollStep = 240;
    const btnPrev = document.createElement('button');
    btnPrev.className = 'k-sug-arrow prev';
    btnPrev.innerHTML = '&#8249;';
    btnPrev.setAttribute('aria-label', 'Précédent');
    const btnNext = document.createElement('button');
    btnNext.className = 'k-sug-arrow next';
    btnNext.innerHTML = '&#8250;';
    btnNext.setAttribute('aria-label', 'Suivant');

    const updateArrows = () => {
      btnPrev.hidden = dom.sugRail.scrollLeft <= 4;
      btnNext.hidden = dom.sugRail.scrollLeft + dom.sugRail.clientWidth >= dom.sugRail.scrollWidth - 4;
    };

    btnPrev.addEventListener('click', () => {
      dom.sugRail.scrollBy({left: -scrollStep, behavior: 'smooth'});
    });
    btnNext.addEventListener('click', () => {
      dom.sugRail.scrollBy({left: scrollStep, behavior: 'smooth'});
    });
    dom.sugRail.addEventListener('scroll', updateArrows, {passive: true});

    wrap.appendChild(btnPrev);
    wrap.appendChild(btnNext);
    updateArrows();
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
      if (!state.modalProduct) return;
      if (dom.addCartBtn.classList.contains('confirmed')) {
        // "Voir" zone clicked → go to cart
        closeModal();
        setTimeout(openCart, 150);
        return;
      }
      addToCart(state.modalProduct, state.modalQty, dom.addCartBtn, { fromModal: true });
    });

    dom.buyNowBtn && dom.buyNowBtn.addEventListener('click', () => {
      if (!state.modalProduct) return;
      buyNow(state.modalProduct, state.modalQty);
    });
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
  function buildCartShareURL() {
    // Encode cart as URL: ?cart=id1:qty1,id2:qty2
    const items = state.cart.map(function(item) {
      return item.product.id + ':' + item.qty;
    });
    return window.location.origin + '/Komerce_Boutique.html?cart=' + encodeURIComponent(items.join(','));
  }

  function shareCartWhatsApp() {
    if (state.cart.length === 0) { showToast('Votre panier est vide.', 'error'); return; }

    var cartURL = buildCartShareURL();
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
    var cartParam = params.get('cart');
    if (!cartParam) return;

    // Parse cart=id1:qty1,id2:qty2
    var entries = cartParam.split(',').map(function(e) {
      var parts = e.split(':');
      return { id: parts[0], qty: parseInt(parts[1]) || 1 };
    }).filter(function(e) { return e.id; });

    if (entries.length === 0) return;

    // Wait for products to load, then populate cart
    var checkProducts = setInterval(function() {
      if (!state.products || state.products.length === 0) return;
      clearInterval(checkProducts);

      // Clear existing cart
      state.cart = [];

      entries.forEach(function(entry) {
        var product = state.products.find(function(p) { return p.id === entry.id; });
        if (product) {
          state.cart.push({ product: product, qty: entry.qty });
        }
      });

      if (state.cart.length > 0) {
        saveCart();
        renderCartBody();
        // Open the cart drawer automatically
        setTimeout(function() {
          dom.cartDrawer.classList.add('open');
          dom.cartOverlay.classList.add('open');
          document.body.style.overflow = 'hidden';
          showToast('🧺 Panier partagé chargé ! ' + state.cart.length + ' article(s)', 'success');
        }, 500);
      }

      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    }, 200);

    // Timeout after 10s
    setTimeout(function() { clearInterval(checkProducts); }, 10000);
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

    /* ── 1. Mini résumé ── */
    const summary = document.createElement('div');
    summary.className = 'ck-summary';
    const qtyLabel = cartQty() + ' article' + (cartQty() > 1 ? 's' : '');
    summary.innerHTML = '<span class="ck-sum-qty">' + qtyLabel + '</span>'
      + '<span class="ck-sum-sep">·</span>'
      + '<span class="ck-sum-total">' + fmt(cartTotal(), 'KMF') + '</span>';
    body.appendChild(summary);

    /* ── 2. Bénéficiaire ── */
    const s1 = document.createElement('div');
    s1.className = 'ck-label';
    s1.textContent = '📦 Bénéficiaire';
    body.appendChild(s1);
    body.appendChild(makeInput('of-beneficiary-name',  'Nom *',         'text', 'Prénom Nom',  od, 'beneficiary_name'));
    body.appendChild(makePhoneInput('of-beneficiary-phone', 'Tél. *', od, 'beneficiary_phone'));

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

    const stripeCardWrap = document.createElement('div');
    stripeCardWrap.id = 'stripe-card-wrap';
    stripeCardWrap.style.cssText = 'display:none;margin-bottom:10px;padding:10px 12px;border:2px solid var(--coral);border-radius:8px;background:rgba(255,107,53,0.03);';
    stripeCardWrap.innerHTML = '<div style="font-size:0.78rem;font-weight:600;margin-bottom:8px;">🔒 Informations de carte</div>'
      + '<div id="stripe-card-element" style="padding:10px;border:1px solid rgba(0,0,0,0.1);border-radius:6px;background:white;"></div>'
      + '<div id="stripe-card-error" style="color:#dc2626;font-size:0.75rem;margin-top:6px;display:none;"></div>'
      + '<div id="stripe-eur-display" style="display:none;text-align:center;font-size:0.82rem;color:var(--coral);font-weight:700;margin-top:8px;">≈ ' + fmt(cartTotal(), 'EUR') + ' seront débités</div>';
    body.appendChild(stripeCardWrap);

    /* ── 4. Suivi SMS accordion ── */
    const trackRow = document.createElement('div');
    trackRow.className = 'ck-track-row';
    trackRow.innerHTML = '<label class="ck-track-toggle">'
      + '<input type="checkbox" id="cb-want-tracking">'
      + '<span>📲 Recevoir aussi le suivi SMS</span></label>';
    body.appendChild(trackRow);

    const trackExtra = document.createElement('div');
    trackExtra.id = 'ck-track-extra';
    trackExtra.className = 'ck-track-extra';
    trackExtra.style.display = 'none';
    const senderGroup = makeIntlPhoneInput('of-sender-phone', 'Votre tél. (pour le suivi)', od, 'sender_phone');
    const trkHint = document.createElement('div');
    trkHint.className = 'ck-track-hint';
    trkHint.textContent = 'Notifié dès que la commande arrive au relais';
    trackExtra.appendChild(senderGroup);
    trackExtra.appendChild(trkHint);
    body.appendChild(trackExtra);

    /* ── 5. Wallet ── */
    checkWalletBalance();
    const walletSection = document.createElement('div');
    walletSection.id = 'wallet-section';
    walletSection.style.cssText = 'margin-top:8px;padding:10px 12px;border:2px dashed var(--coral);border-radius:8px;background:rgba(255,107,53,0.04);display:none;';
    walletSection.innerHTML = '<label style="display:flex;align-items:center;gap:10px;cursor:pointer;">'
      + '<input type="checkbox" id="cb-use-wallet" style="width:18px;height:18px;accent-color:var(--coral);flex-shrink:0;">'
      + '<div style="flex:1;"><div style="font-weight:700;font-size:0.85rem;color:var(--coral);">💰 Utiliser mon crédit</div>'
      + '<div id="wallet-balance-text" style="font-size:0.72rem;color:#888;margin-top:1px;">Chargement…</div></div></label>'
      + '<div id="wallet-deduction" style="margin-top:6px;padding:6px 8px;background:white;border-radius:6px;font-size:0.82rem;display:none;"></div>';
    body.appendChild(walletSection);

    /* ── 6. Confirm (sticky) ── */
    const confirmBtn = document.createElement('button');
    confirmBtn.id = 'btn-confirm-order';
    confirmBtn.className = 'ck-confirm-btn';
    confirmBtn.textContent = '✅ Confirmer — ' + fmt(cartTotal(), 'KMF');
    // Bouton confirm HORS du scroll area → toujours visible en bas du modal
    body.parentElement.appendChild(confirmBtn);

    /* ── Payment switching ── */
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
      if (btn) btn.textContent = isStripe ? '💳 Payer ' + fmt(cartTotal(), 'EUR') : '✅ Confirmer — ' + fmt(cartTotal(), 'KMF');
    }

    payGrid.addEventListener('change', updatePaymentUI);
    updatePaymentUI(); // init état chip cash

    setTimeout(() => {
      const cbTrack = document.getElementById('cb-want-tracking');
      if (cbTrack) cbTrack.addEventListener('change', function() {
        const extra = document.getElementById('ck-track-extra');
        if (extra) extra.style.display = this.checked ? 'block' : 'none';
      });
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
      { code: '+33',  flag: '🇫🇷', name: 'France',         max: 10, ph: '06 12 34 56 78' },
      { code: '+269', flag: '🇰🇲', name: 'Comores',        max: 7,  ph: '321 12 34' },
      { code: '+32',  flag: '🇧🇪', name: 'Belgique',       max: 10, ph: '0470 12 34 56' },
      { code: '+41',  flag: '🇨🇭', name: 'Suisse',         max: 10, ph: '076 123 45 67' },
      { code: '+44',  flag: '🇬🇧', name: 'Royaume-Uni',    max: 11, ph: '07911 123456' },
      { code: '+1',   flag: '🇺🇸', name: 'USA / Canada',   max: 11, ph: '202 555 0147' },
      { code: '+971', flag: '🇦🇪', name: 'Émirats',        max: 9,  ph: '050 123 4567' },
      { code: '+966', flag: '🇸🇦', name: 'Arabie Saoudite',max: 9,  ph: '055 123 4567' },
      { code: '+60',  flag: '🇲🇾', name: 'Malaisie',       max: 10, ph: '012 345 6789' },
      { code: '+212', flag: '🇲🇦', name: 'Maroc',          max: 9,  ph: '0612 345678' },
    ];
    let currentCountry = COUNTRIES[0];

    const group = document.createElement('div');
    group.style.cssText = 'margin-bottom:8px;';

    const lbl = document.createElement('label');
    lbl.style.cssText = 'display:block;font-size:0.8rem;font-weight:600;margin-bottom:3px;';
    lbl.textContent = label;
    group.appendChild(lbl);

    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;gap:0;position:relative;';

    /* selector */
    const sel = document.createElement('select');
    sel.id = id + '-country';
    sel.style.cssText = 'appearance:none;-webkit-appearance:none;background:#eef2e4;border:2px solid rgba(0,0,0,0.1);border-right:none;border-radius:8px 0 0 8px;padding:9px 8px 9px 10px;font-weight:700;font-size:0.88rem;color:#555;cursor:pointer;outline:none;min-width:72px;text-align:center;';
    COUNTRIES.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.code;
      opt.textContent = c.flag + ' ' + c.code;
      sel.appendChild(opt);
    });
    wrap.appendChild(sel);

    /* number input */
    const input = document.createElement('input');
    input.type = 'tel';
    input.id = id;
    input.placeholder = currentCountry.ph;
    input.value = dataObj[key] || '';
    input.style.cssText = 'flex:1;border-radius:0 8px 8px 0;padding:9px 12px;border:2px solid rgba(0,0,0,0.1);outline:none;font-size:0.9rem;transition:border-color 0.2s;min-width:0;';

    const sync = () => {
      dataObj[key] = currentCountry.code + input.value.replace(/\s/g,'');
    };

    sel.addEventListener('change', () => {
      currentCountry = COUNTRIES.find(c => c.code === sel.value) || COUNTRIES[0];
      input.placeholder = currentCountry.ph;
      input.maxLength = currentCountry.max + 4; /* allow spaces */
      sync();
    });
    input.addEventListener('focus', () => { input.style.borderColor = 'var(--coral)'; });
    input.addEventListener('blur',  () => { input.style.borderColor = 'rgba(0,0,0,0.1)'; });
    input.addEventListener('input', sync);

    input.maxLength = currentCountry.max + 4;
    wrap.appendChild(input);
    group.appendChild(wrap);
    return group;
  }

  function makePhoneInput(id, label, dataObj, key) {
    const group = document.createElement('div');
    group.style.cssText = 'margin-bottom:8px;';
    const lbl = document.createElement('label');
    lbl.style.cssText = 'display:block;font-size:0.8rem;font-weight:600;margin-bottom:3px;';
    lbl.textContent = label;
    group.appendChild(lbl);
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;gap:0;';
    const prefix = document.createElement('div');
    prefix.style.cssText = 'background:#eef2e4;border:2px solid rgba(0,0,0,0.1);border-right:none;border-radius:8px 0 0 8px;padding:9px 8px 9px 10px;font-weight:700;font-size:0.88rem;color:var(--coral);white-space:nowrap;display:flex;align-items:center;min-width:58px;justify-content:center;';
    prefix.textContent = '+269';
    wrap.appendChild(prefix);
    const input = document.createElement('input');
    input.type = 'tel';
    input.id = id;
    input.placeholder = '321 12 34';
    input.value = dataObj[key] || '';
    input.maxLength = 10;
    input.style.cssText = 'flex:1;border-radius:0 8px 8px 0;padding:9px 12px;border:2px solid rgba(0,0,0,0.1);outline:none;font-size:0.9rem;transition:border-color 0.2s;';
    input.addEventListener('focus', () => { input.style.borderColor = 'var(--coral)'; });
    input.addEventListener('blur', () => { input.style.borderColor = 'rgba(0,0,0,0.1)'; });
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
    wrapper.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 14px;border:2px solid ' + (checked ? 'var(--coral)' : 'rgba(0,0,0,0.08)') + ';border-radius:8px;margin-bottom:6px;cursor:pointer;background:' + (checked ? 'rgba(255,107,53,0.06)' : 'white') + ';';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'payment_mode';
    radio.value = value;
    radio.checked = checked;
    radio.style.cssText = 'width:16px;height:16px;accent-color:var(--coral);flex-shrink:0;';
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
      ded.innerHTML = '<div style="display:flex;justify-content:space-between;"><span>💰 Crédit appliqué</span><span style="font-weight:700;color:var(--coral)">-' + fmt(applied, 'KMF') + '</span></div>' +
        (remaining > 0 ? '<div style="display:flex;justify-content:space-between;margin-top:4px;"><span>Reste à payer</span><span style="font-weight:700">' + fmt(remaining, 'KMF') + '</span></div>' : '<div style="margin-top:4px;text-align:center;font-weight:700;color:#16a34a;">✅ Entièrement couvert par votre crédit !</div>');
    } else {
      ded.style.display = 'none';
    }
  }

  /* ── Submit Order ── */
  async function submitOrder(btn) {
    const od = state.orderData;
    const recipName   = (document.getElementById('of-beneficiary-name')?.value  || '').trim();
    const recipPhone  = (document.getElementById('of-beneficiary-phone')?.value || '').trim();
    const senderPhone = (document.getElementById('of-sender-phone')?.value || '').trim();
    const clientName  = recipName;
    const clientPhone = '+269' + recipPhone.replace(/\s/g, '');
    const clientEmail = undefined;

    if (!recipName)  { showToast('Indiquez le nom de la personne qui récupère.', 'error'); return; }
    if (!recipPhone) { showToast('Indiquez le téléphone du bénéficiaire (+269).', 'error'); return; }

    const fullRecipPhone = '+269' + recipPhone.replace(/\s/g, '');
    const isStripe = od.payment_mode === 'stripe_eur';

    btn.disabled = true;
    btn.textContent = isStripe ? '⏳ Paiement en cours…' : '⏳ Envoi en cours…';
    btn.style.opacity = '0.7';

    try {
      // Step 1: guest-checkout
      await apiPost('/api/auth/guest-checkout', {
        full_name: clientName,
        phone: clientPhone,
        email: clientEmail || undefined
      });

      // Step 2: create order
      const items = state.cart.map(i => ({
        product_id: String(i.product.id),
        quantity: i.qty,
        confection_type: 'aucun'
      }));

      const apiResult = await apiPost('/api/orders', {
        items: items,
        relais_id: state.relais.length > 0 ? state.relais[0].id : undefined,
        recipient_name: recipName,
        recipient_phone: fullRecipPhone,
        payment_mode: od.payment_mode,
        use_wallet: od.use_wallet || false,
        sender_phone: senderPhone || undefined
      });

      const orderData = apiResult.order || apiResult;

      // Step 3: Stripe payment
      if (isStripe) {
        if (!_stripe || !_stripeCard) throw new Error('Stripe non chargé. Rechargez la page.');

        btn.textContent = '🔒 Sécurisation du paiement…';

        const intentResult = await apiPost('/api/payments/stripe/intent', {
          order_reference: orderData.reference
        });

        btn.textContent = '💳 Validation en cours…';

        const stripeResult = await _stripe.confirmCardPayment(intentResult.client_secret, {
          payment_method: {
            card: _stripeCard,
            billing_details: { name: clientName, email: clientEmail || undefined }
          }
        });

        if (stripeResult.error) {
          const errEl = document.getElementById('stripe-card-error');
          if (errEl) { errEl.textContent = stripeResult.error.message; errEl.style.display = 'block'; }
          throw new Error(stripeResult.error.message);
        }

        showToast('🎉 Paiement accepté !', 'success');
      }

      // Step 4: clear cart
      state.cart = [];
      saveCart();
      renderCartBody();

      // Step 5: success screen
      renderOrderSuccess(orderData, recipName, clientEmail, apiResult, fullRecipPhone, senderPhone);
      showToast('Commande confirmée !', 'success');

    } catch (e) {
      console.error('submitOrder:', e);
      showToast(e.message || 'Erreur lors de la commande.', 'error');
      btn.disabled = false;
      btn.textContent = isStripe ? '💳 Payer ' + fmt(cartTotal(), 'EUR') : '✅ Confirmer — ' + fmt(cartTotal(), 'KMF');
      btn.style.opacity = '1';
    }
  }

  /* ── Order Success ── */
  function renderOrderSuccess(order, recipientName, clientEmail, fullResult, recipientPhone, senderPhone) {
    const body = dom.orderBody;
    body.innerHTML = '';
    dom.orderTitle.textContent = '✅ Commande confirmée';
    // Retirer le bouton Confirmer sticky (⏳ Envoi en cours…)
    body.parentElement.querySelectorAll('.ck-confirm-btn').forEach(b => b.remove());

    const wrap = document.createElement('div');
    wrap.style.cssText = 'text-align:center;padding:14px 0;';

    wrap.innerHTML = '<div style="font-size:3.2rem;margin-bottom:8px;">🎉</div>' +
      '<h3 style="color:var(--coral);margin-bottom:6px;font-size:1.1rem;">Commande enregistrée !</h3>' +
      '<p style="color:#888;font-size:0.85rem;margin-bottom:2px;">Votre référence :</p>' +
      '<div style="display:inline-block;background:rgba(255,107,53,0.08);color:var(--coral);font-weight:800;font-size:1.15rem;padding:8px 20px;border-radius:10px;margin:6px 0;letter-spacing:2px;font-family:monospace;" id="k-order-ref-display">' + sanitize(order.reference || '—') + '</div>' +
      '<button onclick="navigator.clipboard.writeText(\'' + sanitize(order.reference || '') + '\').then(()=>showToast(\'✅ Référence copiée !\')).catch(()=>{})" style="margin-top:4px;padding:5px 14px;background:transparent;border:1.5px solid var(--coral);color:var(--coral);border-radius:20px;font-size:0.78rem;font-weight:700;cursor:pointer;letter-spacing:0.5px;">📋 Copier</button>';

    // Cash ref code
    if (order.cash_ref_code && order.payment_mode === 'cash_relais') {
      wrap.innerHTML += '<p style="margin-top:10px;font-weight:700;font-size:0.88rem;">🏪 Code de paiement au relais :</p>' +
        '<div style="display:inline-block;background:#fffbeb;color:#92400e;font-weight:800;font-size:1.15rem;padding:8px 22px;border-radius:10px;margin:6px 0;letter-spacing:2px;border:2px solid #fde68a;font-family:monospace;">' + sanitize(order.cash_ref_code) + '</div>';
    }

    // Discount
    if (fullResult && fullResult.discount_pct > 0) {
      wrap.innerHTML += '<div style="margin-top:10px;padding:8px 12px;background:#ecfdf5;border-radius:8px;border:1px solid #a7f3d0;font-size:0.82rem;color:#065f46;font-weight:600;">🎁 Fidélité ' + sanitize(fullResult.loyalty_label || '') + ' : -' + fullResult.discount_pct + '% (-' + fmt(fullResult.discount_kmf, 'KMF') + ')</div>';
    }

    // Wallet deduction
    if (fullResult && fullResult.credit_applied_kmf > 0) {
      wrap.innerHTML += '<div style="margin-top:6px;padding:8px 14px;background:rgba(255,107,53,0.06);border-radius:8px;font-size:0.85rem;text-align:center;">💰 Crédit boutique appliqué : <strong style="color:var(--coral)">-' + fmt(fullResult.credit_applied_kmf, 'KMF') + '</strong></div>';
    }

    // Info block
    wrap.innerHTML += '<div style="margin-top:12px;padding:10px 12px;background:#f5f5f2;border-radius:10px;font-size:0.82rem;color:#888;line-height:1.6;text-align:left;">' +
      '<div>🏪 Paiement en cash (KMF) au point relais lors du retrait.</div>' +
      '<div style="margin-top:4px;">📱 ' + sanitize(recipientName || '') + ' recevra un SMS de confirmation.</div>' +
      (clientEmail ? '<div style="margin-top:4px;">📧 Suivi envoyé à ' + sanitize(clientEmail) + '</div>' : '') +
      '<div style="margin-top:4px;">📍 Présentez la référence ou le code au point relais.</div></div>';

    // WhatsApp notice
    if (recipientPhone) {
      const waMsg = (senderPhone && senderPhone.trim())
        ? '📲 Le bénéficiaire et vous recevrez une confirmation WhatsApp'
        : '📲 Le bénéficiaire recevra une confirmation WhatsApp';
      wrap.innerHTML += '<div style="margin-top:10px;padding:9px 12px;background:#e7f9ef;border-radius:10px;font-size:0.82rem;color:#1a7a3e;font-weight:600;">'+waMsg+'</div>';
    }

    // Buttons
    wrap.innerHTML += '<button id="k-order-track-btn" style="margin-top:12px;width:100%;padding:11px;border-radius:8px;font-weight:700;font-size:0.9rem;background:var(--coral);color:white;border:none;cursor:pointer;">📍 Suivre ma commande</button>' +
      '<button id="k-order-close-btn" style="margin-top:6px;width:100%;padding:10px;border-radius:8px;font-weight:600;font-size:0.85rem;background:#f5f5f2;color:#666;border:1px solid rgba(0,0,0,0.08);cursor:pointer;">Fermer</button>';

    body.appendChild(wrap);

    // Wire button events + auto-close countdown
    setTimeout(() => {
      const trackBtn = document.getElementById('k-order-track-btn');
      if (trackBtn) trackBtn.addEventListener('click', () => {
        clearInterval(countdownTimer);
        closeOrderModal();
        renderTrackView();
        switchView('track');
        setTimeout(() => {
          const refInput  = document.getElementById('k-track-ref');
          const telInput  = document.getElementById('k-track-phone');
          const searchBtn = document.getElementById('k-track-search-btn');
          if (refInput)  refInput.value  = order.reference || '';
          if (telInput && recipientPhone)  telInput.value  = recipientPhone;
          if (searchBtn && refInput && refInput.value) searchBtn.click();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }, 80);
      });
      const closeBtn = document.getElementById('k-order-close-btn');
      if (closeBtn) closeBtn.addEventListener('click', () => {
        clearInterval(countdownTimer);
        closeOrderModal();
        switchView('shop');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });

      // Auto-close après 7s avec compte à rebours sur le bouton Fermer
      let secs = 7;
      const updateLabel = () => { if (closeBtn) closeBtn.textContent = 'Fermer (' + secs + 's)'; };
      updateLabel();
      var countdownTimer = setInterval(() => {
        secs--;
        updateLabel();
        if (secs <= 0) {
          clearInterval(countdownTimer);
          closeOrderModal();
          switchView('shop');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }, 1000);
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
        setTimeout(() => appendNextPage(), 300);
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
      el.innerHTML = `<h2>❤️ Favoris <span style="font-size:14px;font-weight:400;color:var(--text-muted)">${favProducts.length} produit${favProducts.length > 1 ? 's' : ''}</span></h2>
        <div class="k-grid" id="k-fav-grid">${favProducts.map(buildCardHTML).join('')}</div>`;
      const favGrid = document.getElementById('k-fav-grid');
      if (favGrid) bindCardEvents(favGrid);
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

    el.innerHTML = `
      <h2>📦 Suivi de commande</h2>

      <!-- Formulaire ref + tél -->
      <div id="k-track-form-step">
        <p class="k-otp-hint">Entrez votre référence commande et le téléphone du bénéficiaire pour accéder au suivi.</p>
        <div class="k-track-form" style="margin-bottom:8px;">
          <input class="k-track-input" id="k-track-ref" type="text"
            placeholder="Référence : KMR-2025-0042"
            autocomplete="off" style="text-transform:uppercase">
        </div>
        <div class="k-track-form">
          <input class="k-track-input" id="k-track-phone" type="tel"
            placeholder="Tél. bénéficiaire : +269 321 45 67"
            autocomplete="tel" inputmode="tel">
          <button class="k-track-btn" id="k-track-search-btn">Suivre →</button>
        </div>
      </div>

      <!-- Résultats -->
      <div id="k-track-results-step" style="display:none">
        <div id="k-orders-list"></div>
        <button class="k-otp-resend-btn" id="k-track-reset-btn" style="margin-top:16px">← Nouvelle recherche</button>
      </div>`;

    /* ── Recherche ref + tél ── */
    el.querySelector('#k-track-search-btn').addEventListener('click', async () => {
      const ref   = el.querySelector('#k-track-ref').value.trim().toUpperCase();
      const phone = el.querySelector('#k-track-phone').value.trim();
      if (!ref)   { showToast('Entrez votre référence commande.', 'error'); return; }
      if (!phone) { showToast('Entrez le téléphone du bénéficiaire.', 'error'); return; }
      const btn = el.querySelector('#k-track-search-btn');
      btn.disabled = true; btn.textContent = '⏳ Recherche…';
      try {
        const data = await apiGet('/api/orders/public/' + encodeURIComponent(ref) + '?phone=' + encodeURIComponent(phone));
        el.querySelector('#k-track-form-step').style.display = 'none';
        el.querySelector('#k-track-results-step').style.display = 'block';
        renderOrderDetail(data.order || data, el.querySelector('#k-orders-list'));
      } catch(e) {
        showToast('Référence ou téléphone incorrect.', 'error');
        btn.disabled = false; btn.textContent = 'Suivre →';
      }
    });

    /* ── Retour ── */
    el.querySelector('#k-track-reset-btn').addEventListener('click', () => renderTrackView());
  }

  /* ── VUE SWITCHER ───────────────────────────────────────── */
  function switchView(tab) {
    const catalog = document.getElementById('k-catalog-section');
    const favView = document.getElementById('k-fav-view');
    const trackView = document.getElementById('k-track-view');
    // Show catalog by default
    if (catalog) catalog.style.display = tab === 'shop' ? '' : 'none';
    if (favView) favView.classList.toggle('show', tab === 'fav');
    if (trackView) trackView.classList.toggle('show', tab === 'track');
    // Also hide promo section when not on shop
    const promoSec = document.getElementById('k-promos-section');
    if (promoSec) promoSec.style.display = tab === 'shop' ? '' : 'none';
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
        document.querySelector('.k-grid')?.scrollIntoView({ behavior: 'smooth' });
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
