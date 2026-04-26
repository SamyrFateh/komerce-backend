/* ═══════════════════════════════════════════════════════════
   KOMERCE BOUTIQUE — b-ui.js
   Toast, skeleton, cart badge, scroll-to-top
   Depends on: b-config.js, b-state.js
   ═══════════════════════════════════════════════════════════ */
(function (K) {
  'use strict';

  // ── TOAST ─────────────────────────────────────────────────
  K.showToast = function (msg, type, duration) {
    const toast = K.dom.toast;
    if (!toast) return;
    toast.innerHTML = '<div class="k-toast-simple">' + (msg || '') + '</div>';
    toast.className = 'k-toast show' + (type ? ' ' + type : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.classList.remove('show'), duration || 2800);
  };

  K.showRichToast = function (product) {
    const toast = K.dom.toast;
    if (!toast) return;
    const imgUrl = K.optimizeImgUrl(product.image_url, 80);
    const name   = K.sanitize(product.name || '');
    const qty    = K.cartQty();
    toast.innerHTML =
      '<div class="k-rich-toast">' +
        '<img class="k-rich-toast-img" src="' + imgUrl + '" alt="' + name + '" loading="lazy">' +
        '<div class="k-rich-toast-info">' +
          '<div class="k-rich-toast-name">' + name + '</div>' +
          '<div class="k-rich-toast-cta" id="k-toast-view-cart">🛒 Voir (' + qty + ') →</div>' +
        '</div>' +
      '</div>';
    toast.className = 'k-toast show rich';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.classList.remove('show'), 3000);
    const viewBtn = document.getElementById('k-toast-view-cart');
    if (viewBtn) viewBtn.addEventListener('click', () => { toast.classList.remove('show'); K.openCart(); });
  };

  // ── SKELETONS ─────────────────────────────────────────────
  K.showSkeletons = function (n) {
    const grid = K.dom.grid;
    if (!grid) return;
    let html = '';
    for (let i = 0; i < (n || 8); i++) {
      html += '<div class="k-skeleton-card">' +
        '<div class="k-skeleton k-skeleton-img"></div>' +
        '<div class="k-skeleton k-skeleton-line"></div>' +
        '<div class="k-skeleton k-skeleton-line short"></div>' +
        '</div>';
    }
    grid.innerHTML = html;
  };

  K.hideSkeletons = function () {
    if (K.dom.grid) K.dom.grid.querySelectorAll('.k-skeleton-card').forEach(el => el.remove());
  };

  // ── CART BADGE ────────────────────────────────────────────
  K.updateCartBadge = function () {
    const qty = K.cartQty();
    const badge = K.dom.cartBadge;
    if (badge) {
      badge.textContent = qty;
      badge.classList.toggle('show', qty > 0);
    }
    const modalBadge = K.dom.modalCartBadge;
    if (modalBadge) {
      modalBadge.textContent = qty > 0 ? qty : '';
      modalBadge.style.display = qty > 0 ? '' : 'none';
    }
  };

  K.ringCartBtn = function () {
    const btn = K.dom.cartBtn;
    if (!btn) return;
    btn.classList.remove('ring');
    void btn.offsetWidth;
    btn.classList.add('ring');
    setTimeout(() => btn.classList.remove('ring'), 1000);
  };

  // ── SCROLL TO TOP ─────────────────────────────────────────
  K.setupScrollToTop = function () {
    const btn = K.dom.scrollTop;
    if (!btn) return;
    window.addEventListener('scroll', () => {
      btn.classList.toggle('show', window.scrollY > 400);
    }, { passive: true });
    btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  };

})(window.K = window.K || {});
