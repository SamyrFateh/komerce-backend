/* ═══════════════════════════════════════════════════════════
   KOMERCE BOUTIQUE — b-catalog.js
   Product loading, grid rendering, soldes rail, fly-to-cart
   Depends on: b-config.js, b-state.js, b-ui.js
   ═══════════════════════════════════════════════════════════ */
(function (K) {
  'use strict';

  // ── LOAD PRODUCTS ─────────────────────────────────────────
  K.loadProducts = async function () {
    K.showSkeletons(K.state.pageSize);
    try {
      const data = await K.apiGet('/api/products');
      K.state.products = (data.products || data || []).map(p => ({
        ...p,
        id: String(p.id),
      }));
      K.state.filtered = [...K.state.products];
      K.hideSkeletons();
      K.renderPromos();
      K.renderGrid();
      K.markAllCartButtons();
      K.updateChipImages();
    } catch (e) {
      K.hideSkeletons();
      K.showToast('Erreur lors du chargement des produits.', 'error');
    }
  };

  // ── FILTER + SORT ─────────────────────────────────────────
  K._getDisplayProducts = function () {
    let list = [...K.state.filtered];

    // Category filter
    if (K.state.activeCat && K.state.activeCat !== 'all') {
      list = list.filter(p => (p.category || '') === K.state.activeCat);
    }

    // Sort
    switch (K.state.sortMode) {
      case 'price_asc':  list.sort((a, b) => (a.price_kmf || 0) - (b.price_kmf || 0)); break;
      case 'price_desc': list.sort((a, b) => (b.price_kmf || 0) - (a.price_kmf || 0)); break;
      case 'promo':      list.sort((a, b) => (b.promo_pct || 0) - (a.promo_pct || 0)); break;
      default: break;
    }
    return list;
  };

  // ── RENDER GRID ───────────────────────────────────────────
  K.renderGrid = function () {
    const grid = K.dom.grid;
    if (!grid) return;
    K.state.page = 0;
    grid.innerHTML = '';
    K._appendCards(K._getDisplayProducts());
  };

  K._appendCards = function (list) {
    const grid = K.dom.grid;
    if (!grid) return;
    const start = K.state.page * K.state.pageSize;
    const items = list.slice(start, start + K.state.pageSize);

    const fragment = document.createDocumentFragment();
    items.forEach(p => {
      const card = K._buildCard(p);
      fragment.appendChild(card);
    });
    grid.appendChild(fragment);
  };

  K._buildCard = function (p) {
    const inCart  = K.state.cart.find(i => String(i.product.id) === String(p.id));
    const imgUrl  = K.optimizeImgUrl(p.image_url, 400);
    const hasPromo = p.promo_pct > 0;
    const oldPrice = hasPromo ? Math.round(p.price_kmf / (1 - p.promo_pct / 100)) : 0;
    const catLabel = (p.category || '').toUpperCase();

    const card = document.createElement('div');
    card.className = 'k-card';
    card.dataset.id = p.id;

    card.innerHTML =
      '<div class="k-card-img-wrap">' +
        '<img class="k-card-img" src="' + imgUrl + '" alt="' + K.sanitize(p.name) + '" loading="lazy">' +
        (hasPromo ? '<span class="k-card-promo-badge">-' + p.promo_pct + '%</span>' : '') +
      '</div>' +
      '<div class="k-card-body">' +
        (catLabel ? '<div class="k-card-cat">' + catLabel + '</div>' : '') +
        (p.rating > 0 ? '<div class="k-card-stars">' + K.renderStars(p.rating) + '<span class="k-card-rating-count">' + (p.rating_count > 0 ? '(' + p.rating_count + ')' : '') + '</span></div>' : '') +
        '<div class="k-card-name">' + K.sanitize(p.name) + '</div>' +
        '<div class="k-card-price-row">' +
          '<div>' +
            '<span class="k-card-price">' + K.fmtPrice(p.price_kmf) + '</span>' +
            (hasPromo ? '<span class="k-card-old"> ' + K.fmtPrice(oldPrice) + '</span>' : '') +
            '<div class="k-card-eur">' + K.fmtEur(p.price_kmf) + '</div>' +
          '</div>' +
          '<button class="k-card-add' + (inCart ? ' in-cart' : '') + '" data-add="' + p.id + '" aria-label="Ajouter au panier">' +
            (inCart ? '✓' : '+') +
          '</button>' +
        '</div>' +
        '<div class="k-badge-dispo">✓ Dispo</div>' +
      '</div>';

    // Open modal on card click (not on add button)
    card.addEventListener('click', e => {
      if (!e.target.closest('.k-card-add')) K.openModal(p.id);
    });

    // Quick-add
    card.querySelector('.k-card-add').addEventListener('click', e => {
      e.stopPropagation();
      K.quickAdd(p.id, e.currentTarget);
    });

    return card;
  };

  // ── PROMO RAIL ────────────────────────────────────────────
  K.renderPromos = function () {
    const rail = K.dom.promoRail;
    if (!rail) return;
    const promos = K.state.products.filter(p => p.promo_pct > 0).slice(0, 10);
    if (!promos.length) {
      const sec = K.$('#k-promos-section');
      if (sec) sec.style.display = 'none';
      return;
    }
    rail.innerHTML = promos.map(p => {
      const imgUrl = K.promoImgUrl(p.image_url, 280);
      return '<div class="k-promo-card" data-id="' + p.id + '">' +
        '<img class="k-promo-card-img" src="' + imgUrl + '" alt="' + K.sanitize(p.name) + '" loading="lazy">' +
        '<div class="k-promo-card-info">' +
          '<div class="k-promo-card-name">' + K.sanitize(p.name) + '</div>' +
          '<div style="display:flex;align-items:center;gap:6px;margin-top:2px;">' +
            '<span class="k-promo-card-price">' + K.fmtPrice(p.price_kmf) + '</span>' +
            '<span class="k-promo-card-badge">-' + p.promo_pct + '%</span>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    rail.querySelectorAll('.k-promo-card').forEach(card => {
      card.addEventListener('click', () => K.openModal(card.dataset.id));
    });
  };

  // ── INFINITE SCROLL ───────────────────────────────────────
  K.setupInfiniteScroll = function () {
    const sentinel = K.$('#k-scroll-sentinel');
    if (!sentinel) return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        const list = K._getDisplayProducts();
        const total = list.length;
        const loaded = (K.state.page + 1) * K.state.pageSize;
        if (loaded < total) {
          K.state.page++;
          K._appendCards(list);
        }
      }
    }, { rootMargin: '200px' });
    observer.observe(sentinel);
  };

  // ── SEE ALL PROMOS ────────────────────────────────────────
  K.setupSeeAll = function () {
    const btn = K.$('#k-see-all-promos');
    if (!btn) return;
    btn.addEventListener('click', () => {
      K.state.filtered = K.state.products.filter(p => p.promo_pct > 0);
      K.state.activeCat = 'all';
      K.$$('.k-chip').forEach(c => c.classList.remove('active'));
      const first = K.$('.k-chip');
      if (first) first.classList.add('active');
      K.state.sortMode = 'promo';
      K.renderGrid();
      K.dom.grid?.scrollIntoView({ behavior: 'smooth' });
    });
  };

  // ── FLY-TO-CART ANIMATION ─────────────────────────────────
  K.flyToCart = function (sourceEl, product) {
    if (!sourceEl) return;
    const cartBtn = K.dom.cartBtn;
    if (!cartBtn) return;

    const srcRect  = sourceEl.getBoundingClientRect();
    const destRect = cartBtn.getBoundingClientRect();

    // Sparkles
    const emojis = ['✨', '🛍️', '💫'];
    emojis.forEach((em, i) => {
      const sp = document.createElement('span');
      sp.className = 'k-sparkle';
      sp.textContent = em;
      sp.style.cssText = 'left:' + (srcRect.left + srcRect.width / 2 + (i - 1) * 20) + 'px;top:' + (srcRect.top + srcRect.height / 2) + 'px;';
      document.body.appendChild(sp);
      setTimeout(() => sp.remove(), 600);
    });

    // Arc dot
    const dot = document.createElement('div');
    dot.className = 'k-fly-dot';
    dot.style.cssText = 'left:' + (srcRect.left + srcRect.width / 2) + 'px;top:' + (srcRect.top + srcRect.height / 2) + 'px;';
    document.body.appendChild(dot);

    const startX = srcRect.left + srcRect.width / 2;
    const startY = srcRect.top + srcRect.height / 2;
    const endX   = destRect.left + destRect.width / 2;
    const endY   = destRect.top + destRect.height / 2;
    const cpX    = (startX + endX) / 2 - 60;
    const cpY    = Math.min(startY, endY) - 120;

    let t = 0;
    const duration = 600;
    const start = performance.now();

    function animate(ts) {
      t = Math.min((ts - start) / duration, 1);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      const x = (1 - ease) * (1 - ease) * startX + 2 * (1 - ease) * ease * cpX + ease * ease * endX;
      const y = (1 - ease) * (1 - ease) * startY + 2 * (1 - ease) * ease * cpY + ease * ease * endY;
      dot.style.left = (x - 4) + 'px';
      dot.style.top  = (y - 4) + 'px';
      dot.style.opacity = String(1 - ease * 0.7);
      if (t < 1) requestAnimationFrame(animate);
      else dot.remove();
    }
    requestAnimationFrame(animate);
  };

  // ── CHIP IMAGES ─────────────────────────────────────────
  K.updateChipImages = function () {
    // Build map: category → first product image
    const catImg = {};
    K.state.products.forEach(p => {
      if (p.image_url && p.category && !catImg[p.category]) {
        catImg[p.category] = p.image_url;
      }
    });
    K.$$('.k-chip').forEach(chip => {
      const cat = chip.dataset.cat;
      if (cat === 'all') return; // keep fire emoji on "Tout"
      const url = catImg[cat];
      if (!url) return;
      const span = chip.querySelector('.k-chip-emoji');
      if (!span || span.classList.contains('has-img')) return;
      const src = K.optimizeImgUrl(url, 80);
      span.innerHTML = '<img src="' + src + '" alt="' + cat + '" loading="lazy">';
      span.classList.add('has-img');
    });
  };

  // ── MARK CART BUTTONS ────────────────────────────────────
  K.markAllCartButtons = function () {
    K.$$('.k-card-add').forEach(btn => {
      const inCart = K.state.cart.find(i => String(i.product.id) === String(btn.dataset.add));
      btn.classList.toggle('in-cart', !!inCart);
      btn.textContent = inCart ? '✓' : '+';
    });
  };

})(window.K = window.K || {});
