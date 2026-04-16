/* ═══════════════════════════════════════════════════════════
   KOMERCE BOUTIQUE — b-cart.js
   Cart CRUD, cart drawer, WhatsApp share, quick-add/remove
   Depends on: b-config.js, b-state.js, b-ui.js
   ═══════════════════════════════════════════════════════════ */
(function (K) {
  'use strict';

  // ── ADD TO CART ───────────────────────────────────────────
  K.addToCart = function (product, qty, sourceBtn) {
    qty = qty || 1;
    const existing = K.state.cart.find(i => String(i.product.id) === String(product.id));
    if (existing) {
      existing.qty += qty;
    } else {
      K.state.cart.push({ product, qty });
    }
    K.saveCart();
    K.updateCartBadge();
    K.markAllCartButtons();
    K.ringCartBtn();
    if (sourceBtn) K.flyToCart(sourceBtn, product);
    K.showRichToast(product);
    K.emit('cart:updated', K.state.cart);
  };

  K.removeFromCart = function (productId) {
    const pid = String(productId);
    K.state.cart = K.state.cart.filter(i => String(i.product.id) !== pid);
    K.saveCart();
    K.updateCartBadge();
    K.markAllCartButtons();
    K.emit('cart:updated', K.state.cart);
  };

  K.setQty = function (productId, newQty) {
    const pid  = String(productId);
    const item = K.state.cart.find(i => String(i.product.id) === pid);
    if (!item) return;
    if (newQty <= 0) { K.removeFromCart(pid); return; }
    item.qty = newQty;
    K.saveCart();
    K.updateCartBadge();
    K.emit('cart:updated', K.state.cart);
  };

  // ── QUICK ADD (from card '+' button) ─────────────────────
  K.quickAdd = function (productId, btnEl) {
    const product = K.state.products.find(p => String(p.id) === String(productId));
    if (!product) return;
    const inCart = K.state.cart.find(i => String(i.product.id) === String(productId));
    if (inCart) {
      K.openCart();
      return;
    }
    K.addToCart(product, 1, btnEl);
  };

  K.quickRemove = function (productId) {
    K.removeFromCart(productId);
    K.renderCartBody();
  };

  // ── FAVS ─────────────────────────────────────────────────
  K.toggleFav = function (id, btnEl) {
    const idx = K.state.favs.indexOf(id);
    if (idx === -1) {
      K.state.favs.push(id);
      K.showToast('❤️ Ajouté aux favoris');
    } else {
      K.state.favs.splice(idx, 1);
      K.showToast('💔 Retiré des favoris');
    }
    K.saveFavs();
    if (btnEl) btnEl.classList.toggle('active', idx === -1);
    K.emit('favs:updated', K.state.favs);
  };

  // ── OPEN / CLOSE DRAWER ───────────────────────────────────
  K.openCart = function () {
    K.renderCartBody();
    K.dom.cartOverlay?.classList.add('open');
    K.dom.cartDrawer?.classList.add('open');
    document.body.style.overflow = 'hidden';
  };

  K.closeCart = function () {
    K.dom.cartOverlay?.classList.remove('open');
    K.dom.cartDrawer?.classList.remove('open');
    document.body.style.overflow = '';
  };

  K.openCartWithHighlight = function (productId) {
    K.openCart();
    setTimeout(() => {
      const item = K.dom.cartBody?.querySelector('[data-id="' + productId + '"]');
      if (item) {
        item.scrollIntoView({ behavior: 'smooth', block: 'center' });
        item.style.transition = 'background 0.3s';
        item.style.background = 'var(--prairie-light)';
        setTimeout(() => { item.style.background = ''; }, 1000);
      }
    }, 200);
  };

  // ── RENDER CART BODY ──────────────────────────────────────
  K.renderCartBody = function (highlightId) {
    const body   = K.dom.cartBody;
    const footer = K.dom.cartFooter;
    if (!body) return;

    const title = K.dom.cartHeaderTitle;
    if (title) title.textContent = K.cartQty() > 0
      ? 'Mon Panier (' + K.cartQty() + ')'
      : 'Mon Panier';

    if (!K.state.cart.length) {
      body.innerHTML =
        '<div class="k-cart-empty">' +
          '<span style="font-size:48px;display:block;margin-bottom:12px;">🛒</span>' +
          '<span style="font-size:15px;font-weight:500;color:var(--ink-3);">Votre panier est vide</span>' +
        '</div>';
      if (footer) footer.style.display = 'none';
      return;
    }

    body.innerHTML = K.state.cart.map(item => {
      const p      = item.product;
      const imgUrl = K.optimizeImgUrl(p.image_url, 120);
      const isHl   = highlightId && String(p.id) === String(highlightId);
      return '<div class="k-cart-item' + (isHl ? ' highlighted' : '') + '" data-id="' + p.id + '">' +
        '<img class="k-cart-item-img" src="' + imgUrl + '" alt="' + K.sanitize(p.name) + '" loading="lazy">' +
        '<div class="k-cart-item-info">' +
          '<div class="k-cart-item-name">' + K.sanitize(p.name) + '</div>' +
          '<div class="k-cart-item-price">' + K.fmtPrice(p.price_kmf * item.qty) + '</div>' +
          '<div class="k-cart-item-actions">' +
            '<div class="k-cart-item-qty">' +
              '<button class="k-qty-btn" data-action="dec" data-id="' + p.id + '">−</button>' +
              '<span style="min-width:24px;text-align:center;font-size:13px;font-weight:700;">' + item.qty + '</span>' +
              '<button class="k-qty-btn" data-action="inc" data-id="' + p.id + '">+</button>' +
            '</div>' +
            '<button class="k-cart-item-remove" data-remove="' + p.id + '">🗑</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    // Qty buttons
    body.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const pid  = btn.dataset.id;
        const item = K.state.cart.find(i => String(i.product.id) === pid);
        if (!item) return;
        K.setQty(pid, item.qty + (btn.dataset.action === 'inc' ? 1 : -1));
        K.renderCartBody();
      });
    });

    // Remove buttons
    body.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', () => { K.quickRemove(btn.dataset.remove); });
    });

    if (footer) {
      footer.style.display = '';
      const tv  = K.dom.cartTotalVal;
      const tc  = K.dom.cartTotalConv;
      const tot = K.cartTotal();
      if (tv) tv.textContent = K.fmtPrice(tot);
      if (tc) tc.textContent = K.fmtEur(tot);
    }
  };

  // ── WHATSAPP SHARE ────────────────────────────────────────
  K.buildCartShareURL = function () {
    const items = K.state.cart.map(item =>
      encodeURIComponent(item.product.name) + ' x' + item.qty
    ).join('%0A');
    const total = encodeURIComponent(K.fmtPrice(K.cartTotal()));
    return K.KOMERCE_WA_URL + '?text=Bonjour%20Komerce%20!%20Je%20voudrais%20commander%20:%0A' + items + '%0A%0ATotal%20:%20' + total;
  };

  K.shareCartWhatsApp = function () {
    window.open(K.buildCartShareURL(), '_blank', 'noopener');
  };

  // ── SHARED CART (URL param) ───────────────────────────────
  K.loadSharedCart = function () {
    try {
      const params = new URLSearchParams(window.location.search);
      const shared = params.get('cart');
      if (!shared) return;
      const items = JSON.parse(atob(shared));
      if (!Array.isArray(items)) return;
      items.forEach(({ id, qty }) => {
        const product = K.state.products.find(p => String(p.id) === String(id));
        if (product && qty > 0) {
          const existing = K.state.cart.find(i => String(i.product.id) === String(id));
          if (!existing) K.state.cart.push({ product, qty });
        }
      });
      K.saveCart();
      K.updateCartBadge();
      K.showToast('🛒 Panier partagé chargé !', 'success');
    } catch (e) {}
  };

  // ── CHECKOUT ──────────────────────────────────────────────
  K.checkoutCart = function () {
    if (!K.state.cart.length) { K.showToast('Votre panier est vide.', 'error'); return; }
    K.closeCart();
    K.state.orderData = { payment_mode: 'cash_relais' };
    K.renderCheckout();
    K.dom.orderModal?.classList.add('open');
    window._savedScrollY = window.scrollY;
    document.body.style.overflow = 'hidden';
  };

  // ── SETUP DRAWER ──────────────────────────────────────────
  K.setupDrawer = function () {
    K.dom.cartBtn?.addEventListener('click', K.openCart);
    K.dom.cartClose?.addEventListener('click', K.closeCart);
    K.dom.cartOverlay?.addEventListener('click', K.closeCart);
    K.dom.cartContinue?.addEventListener('click', K.closeCart);
    K.dom.cartCheckout?.addEventListener('click', K.checkoutCart);
    K.dom.cartWhatsapp?.addEventListener('click', K.shareCartWhatsApp);
    K.dom.cartClear?.addEventListener('click', () => {
      K.state.cart = [];
      K.saveCart();
      K.updateCartBadge();
      K.markAllCartButtons();
      K.renderCartBody();
    });
    // Cart button in modal
    K.dom.modalCartBtn?.addEventListener('click', () => { K.closeModal(); K.openCart(); });
  };

})(window.K = window.K || {});
