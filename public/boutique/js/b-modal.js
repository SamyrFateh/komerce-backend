/* ═══════════════════════════════════════════════════════════
   KOMERCE BOUTIQUE — b-modal.js
   Product modal, suggestions rail, swipe + keyboard nav
   Depends on: b-config.js, b-state.js, b-ui.js, b-cart.js
   ═══════════════════════════════════════════════════════════ */
(function (K) {
  'use strict';

  // ── OPEN MODAL ────────────────────────────────────────────
  K.openModal = function (id, pushHistory) {
    const product = K.state.products.find(p => String(p.id) === String(id));
    if (!product) return;

    K.state.modalProduct = product;
    K.state.modalQty     = 1;
    window._catalogScrollY = window.scrollY;

    const dom = K.dom;

    // Image
    if (dom.modalImg) {
      dom.modalImg.src = K.optimizeImgUrl(product.image_url, 700);
      dom.modalImg.alt = product.name;
    }

    // Promo badge
    if (dom.modalPromoBadge) {
      if (product.promo_pct > 0) {
        dom.modalPromoBadge.textContent = '-' + product.promo_pct + '%';
        dom.modalPromoBadge.style.display = '';
      } else {
        dom.modalPromoBadge.style.display = 'none';
      }
    }

    // Info
    if (dom.modalName)  dom.modalName.textContent  = product.name;
    if (dom.modalDesc)  dom.modalDesc.textContent  = product.description || '';
    if (dom.modalPrice) dom.modalPrice.textContent = K.fmtPrice(product.price_kmf);

    if (dom.modalOldPrice) {
      if (product.promo_pct > 0) {
        const old = Math.round(product.price_kmf / (1 - product.promo_pct / 100));
        dom.modalOldPrice.textContent = K.fmtPrice(old);
        dom.modalOldPrice.style.display = '';
      } else {
        dom.modalOldPrice.style.display = 'none';
      }
    }

    // Category badge
    if (dom.modalCat) {
      dom.modalCat.textContent = (product.category || '').toUpperCase();
    }

    // Stock badge — impactful
    if (dom.modalStock) {
      const st = (product.stock_status || '').toLowerCase();
      const stockNum = parseInt(product.stock_qty, 10);
      if (st.includes('rupture') || st.includes('épuisé')) {
        dom.modalStock.innerHTML = '<span class="k-stock-badge k-stock-out">✗ Rupture de stock</span>';
      } else if (!isNaN(stockNum) && stockNum <= 5 && stockNum > 0) {
        dom.modalStock.innerHTML = '<span class="k-stock-badge k-stock-low">🔥 Plus que ' + stockNum + ' !</span>';
      } else {
        dom.modalStock.innerHTML = '<span class="k-stock-badge k-stock-ok">✓ Disponible</span>';
      }
    }

    // EUR price equivalent
    let eurEl = document.getElementById('k-modal-eur');
    if (!eurEl) {
      eurEl = document.createElement('div');
      eurEl.id = 'k-modal-eur';
      eurEl.className = 'k-modal-eur';
      const priceRow = document.querySelector('.k-modal-price-row');
      if (priceRow) priceRow.insertAdjacentElement('afterend', eurEl);
    }
    eurEl.textContent = '≈ ' + K.fmtEur(product.price_kmf) + ' · Livraison incluse 🛵';
    eurEl.style.display = '';

    // ── Stars rating ──────────────────────────────────────────
    let starsEl = document.getElementById('k-modal-stars');
    if (!starsEl) {
      starsEl = document.createElement('div');
      starsEl.id = 'k-modal-stars';
      starsEl.className = 'k-modal-stars';
      const nameEl = document.getElementById('k-modal-name');
      if (nameEl && nameEl.parentNode) nameEl.parentNode.insertBefore(starsEl, nameEl.nextSibling);
    }
    if (product.rating > 0) {
      starsEl.innerHTML = '<span class="k-stars-filled">' + K.renderStars(product.rating) + '</span>' +
        (product.rating_count > 0 ? '<span class="k-stars-count">(' + product.rating_count + ' avis)</span>' : '') +
        '<span class="k-stars-score">' + Number(product.rating).toFixed(1) + '</span>';
      starsEl.style.display = '';
    } else {
      starsEl.style.display = 'none';
    }

    // Qty
    if (dom.modalQtyVal) dom.modalQtyVal.textContent = '1';

    // Back label
    if (dom.modalBackLabel) dom.modalBackLabel.textContent = 'Catalogue';

    // Cart button state
    K._updateModalCartBtn();

    // Suggestions
    const catProducts = K.state.products.filter(p =>
      String(p.id) !== String(id) &&
      (K.state.activeCat === 'all' || (p.category || '') === (product.category || ''))
    ).slice(0, 10);
    K.renderSuggestions(catProducts);

    // Nav arrows (prev/next in list)
    const list = K._getDisplayProducts ? K._getDisplayProducts() : K.state.filtered;
    const idx  = list.findIndex(p => String(p.id) === String(id));
    K._updateModalNavArrows(list, idx);

    // Show
    dom.modalOverlay?.classList.add('open');
    dom.modal?.classList.add('open');
    document.body.style.overflow = 'hidden';

    // History
    if (pushHistory !== false) {
      history.pushState({ modal: id }, '', '#product-' + id);
    }
  };

  // ── CLOSE MODAL ───────────────────────────────────────────
  K.closeModal = function () {
    K.dom.modalOverlay?.classList.remove('open');
    K.dom.modal?.classList.remove('open');
    document.body.style.overflow = '';
    K.state.modalProduct = null;
    if (history.state && history.state.modal) history.back();
    if (typeof window._catalogScrollY === 'number') {
      setTimeout(() => window.scrollTo(0, window._catalogScrollY), 0);
    }
  };

  // ── CART BUTTON STATE ─────────────────────────────────────
  K._updateModalCartBtn = function () {
    const btn  = K.dom.addCartBtn;
    const prod = K.state.modalProduct;
    if (!btn || !prod) return;
    const inCart = K.state.cart.find(i => String(i.product.id) === String(prod.id));
    if (inCart) {
      btn.innerHTML = '✓ Dans le panier | Voir (' + K.cartQty() + ') →';
      btn.style.background = 'var(--ivoire-dark)';
      btn.style.color      = 'var(--ink-2)';
    } else {
      btn.innerHTML = '<img src="/images/panier_tresse.png" width="20" height="20" alt="" style="vertical-align:middle;margin-right:6px">Ajouter';
      btn.style.background = '';
      btn.style.color      = '';
    }
    btn.disabled = false;
  };

  // ── SUGGESTIONS RAIL ──────────────────────────────────────
  K.renderSuggestions = function (items) {
    const rail = K.dom.sugRail;
    if (!rail) return;

    const section = K.$('#k-modal-suggestions');
    if (!items.length) {
      if (section) section.style.display = 'none';
      return;
    }
    if (section) section.style.display = '';

    rail.innerHTML = items.map(p =>
      '<div class="k-sug-card" data-id="' + p.id + '">' +
        '<img class="k-sug-card-img" src="' + K.optimizeImgUrl(p.image_url, 220) + '" alt="' + K.sanitize(p.name) + '" loading="lazy">' +
        '<div class="k-sug-card-info">' +
          '<div class="k-sug-card-name">' + K.sanitize(p.name) + '</div>' +
          '<div class="k-sug-card-price">' + K.fmtPrice(p.price_kmf) + '</div>' +
          '<button class="k-card-add" style="margin-top:4px" data-add="' + p.id + '">+</button>' +
        '</div>' +
      '</div>'
    ).join('');

    rail.querySelectorAll('.k-sug-card').forEach(card => {
      card.addEventListener('click', e => {
        if (!e.target.closest('.k-card-add')) K.openModal(card.dataset.id);
      });
    });
    rail.querySelectorAll('[data-add]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        K.quickAdd(btn.dataset.add, btn);
      });
    });

    // Arrows
    K._syncSugArrows();
    rail.addEventListener('scroll', K._syncSugArrows, { passive: true });
  };

  K._syncSugArrows = function () {
    const rail  = K.dom.sugRail;
    const left  = K.$('#k-sug-arrow-left');
    const right = K.$('#k-sug-arrow-right');
    if (!rail) return;
    if (left)  left.classList.toggle('hidden', rail.scrollLeft <= 10);
    if (right) right.classList.toggle('hidden', rail.scrollLeft >= rail.scrollWidth - rail.clientWidth - 10);
  };

  // ── NAV ARROWS (prev/next product) ───────────────────────
  K._updateModalNavArrows = function (list, idx) {
    const prev = K.$('#k-modal-prev');
    const next = K.$('#k-modal-next');
    if (prev) {
      prev.style.display = idx > 0 ? '' : 'none';
      prev.onclick = () => K.navigateModal('prev');
    }
    if (next) {
      next.style.display = idx < list.length - 1 ? '' : 'none';
      next.onclick = () => K.navigateModal('next');
    }
  };

  K.navigateModal = function (direction) {
    const prod = K.state.modalProduct;
    if (!prod) return;
    const list = K._getDisplayProducts ? K._getDisplayProducts() : K.state.filtered;
    const idx  = list.findIndex(p => String(p.id) === String(prod.id));
    const next = direction === 'next' ? idx + 1 : idx - 1;
    if (next < 0 || next >= list.length) return;
    K.openModal(list[next].id, false);
  };

  // ── SETUP MODAL ───────────────────────────────────────────
  K.setupModal = function () {
    const dom = K.dom;

    // Close
    dom.modalClose?.addEventListener('click', K.closeModal);
    dom.modalBack?.addEventListener('click', K.closeModal);
    dom.modalOverlay?.addEventListener('click', e => {
      if (e.target === dom.modalOverlay) K.closeModal();
    });

    // Qty
    dom.qtyMinus?.addEventListener('click', () => {
      if (K.state.modalQty > 1) {
        K.state.modalQty--;
        if (dom.modalQtyVal) dom.modalQtyVal.textContent = K.state.modalQty;
      }
    });
    dom.qtyPlus?.addEventListener('click', () => {
      K.state.modalQty++;
      if (dom.modalQtyVal) dom.modalQtyVal.textContent = K.state.modalQty;
    });

    // Add to cart
    dom.addCartBtn?.addEventListener('click', () => {
      const prod   = K.state.modalProduct;
      if (!prod) return;
      const inCart = K.state.cart.find(i => String(i.product.id) === String(prod.id));
      if (inCart) { K.closeModal(); K.openCart(); return; }
      dom.addCartBtn.disabled = true;
      K.addToCart(prod, K.state.modalQty, dom.addCartBtn);
      setTimeout(() => {
        K._updateModalCartBtn();
      }, 300);
    });

    // Buy now
    dom.buyNowBtn?.addEventListener('click', () => {
      const prod = K.state.modalProduct;
      if (!prod) return;
      const inCart = K.state.cart.find(i => String(i.product.id) === String(prod.id));
      if (!inCart) K.addToCart(prod, K.state.modalQty);
      K.closeModal();
      K.openCart();
    });

    // Suggestion arrows
    const arrowLeft  = K.$('#k-sug-arrow-left');
    const arrowRight = K.$('#k-sug-arrow-right');
    if (arrowLeft)  arrowLeft.addEventListener('click',  () => { K.dom.sugRail?.scrollBy({ left: -200, behavior: 'smooth' }); });
    if (arrowRight) arrowRight.addEventListener('click', () => { K.dom.sugRail?.scrollBy({ left:  200, behavior: 'smooth' }); });

    // Keyboard nav
    document.addEventListener('keydown', e => {
      if (!K.state.modalProduct) return;
      if (e.key === 'Escape')     K.closeModal();
      if (e.key === 'ArrowLeft')  K.navigateModal('prev');
      if (e.key === 'ArrowRight') K.navigateModal('next');
    });

    // Browser back
    window.addEventListener('popstate', e => {
      if (K.state.modalProduct) K.closeModal();
    });

    // Swipe (mobile)
    K._setupModalSwipe();

    // Order modal close
    dom.orderClose?.addEventListener('click', K.closeOrderModal);

    // Listen for cart updates to refresh btn
    K.on('cart:updated', () => { if (K.state.modalProduct) K._updateModalCartBtn(); });
  };

  K._setupModalSwipe = function () {
    const modal = K.dom.modal;
    if (!modal) return;
    let startY = 0, startX = 0;
    modal.addEventListener('touchstart', e => {
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
    }, { passive: true });
    modal.addEventListener('touchend', e => {
      const dy = e.changedTouches[0].clientY - startY;
      const dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dy) > Math.abs(dx) && dy > 80) { K.closeModal(); return; }
      if (Math.abs(dx) > 60 && Math.abs(dy) < 40) {
        K.navigateModal(dx < 0 ? 'next' : 'prev');
      }
    }, { passive: true });
  };

})(window.K = window.K || {});
