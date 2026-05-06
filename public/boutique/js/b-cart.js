/**
 * b-cart.js — Module ES · §7 CART INTERACTIONS + §10 CART PANEL & SHARE + §14 STEPPER
 * Extrait de boutique.js Sprint 2F — Option C
 *
 * §7  : addToCart, setQty, fly animation, cart badge sync
 * §10 : tiroir panier, partage WhatsApp, shareCartWhatsApp, showShareChoiceModal
 * §14 : stepper +/- haptic, renderStepper (setupLongPressSteppers IIFE)
 */

import { bus }           from './b-bus.js';
import {
  state, dom, $, $$, scroll,
}                         from './b-store.js';
import { scrollToCategorySection } from './b-catalog.js';
import {
  sanitize, fmt, fmtPrice, optimizeImgUrl,
  productEmoji, _currency, apiGet, apiPost,
}                         from './b-utils.js';
import {
  showToast, updateCartBadge, saveCart, cartQty, cartTotal, saveFavs,
}                         from './b-cart-core.js';

'use strict';

  // ║  §7 · CART INTERACTIONS — addToCart, setQty, fly animation       ║
  // ╚══════════════════════════════════════════════════════════════════╝
  //  → Futur module: b-cart.js

  /**
   * Animation "fly to cart" — produit vole de la carte vers l'avatar panier.
   * Clone l'image → arc de Bézier → burst sparkles → updateCartBadge.
   * Exception légitime : animation frame-by-frame (rAF).
   * @param {HTMLElement} btn - Bouton panier cliqué
   * @param {number} productId - ID du produit ajouté
   */
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

    /**
     * Frame d'animation rAF pour l'arc de vol panier (flyToCart).
     * Calcule la position courbe via Bézier quadratique.
     * @param {DOMHighResTimeStamp} timestamp - Horodatage fourni par requestAnimationFrame
     */
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
/**
 * Ajoute un produit au panier ou incrémente sa quantité.
 * @param {number|string} id - ID produit
 * @param {Object} [opts] - { fromModal, qty }
 */
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
      dom.addCartBtn.innerHTML = '✓ Ajouté';
      dom.addCartBtn.onclick = function() { bus.emit('modal:close'); setTimeout(openCart, 150); };
    }, 700);
  } else if (sourceBtn) {
    // Toast de confirmation (grid / rail)
    showToast('✓ ' + (product.name || 'Produit') + ' ajouté', 'success');
  }
}

  /**
   * @brief setQty — Met à jour la quantité d'un article dans le panier
   * Si newQty < 1 → supprime l'article (removeFromCart)
   * Met à jour le DOM stepper + badge + localStorage
   * @param {string|number} productId - ID du produit
   * @param {number} newQty - Nouvelle quantité cible
   */
    function setQty(productId, newQty) {
    const pid = String(productId);
    if (newQty < 1) { removeFromCart(pid); return; }
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

  /**
   * Synchronise l'état visuel de tous les boutons panier dans les grilles.
   * 🧺 → stepper si produit dans le panier, reset sinon.
   * Appelé après chaque modification du panier.
   */
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
        btn.innerHTML = '<img src="/images/panier_tresse_vert.png" class="k-card-add-basket" alt="+" width="20" height="20">';
      }
    });
  }

  /* ── REMOVE FROM CART ───────────────────────────────────── */
  /**
 * Retire complètement un produit du panier.
 * @param {number|string} id - ID produit
 */
  function removeFromCart(productId) {
    const pid = String(productId);
    state.cart = state.cart.filter(i => String(i.product.id) !== pid);
    saveCart();
    renderCartBody();
    markAllCartButtons();
  }

  /* ── QUICK ADD FROM GRID ────────────────────────────────── */
/**
 * Ajout rapide depuis une carte (bouton 🧺).
 * @param {number|string} id - ID produit
 * @param {HTMLElement} btn - Bouton déclencheur
 */
  function quickAdd(productId, btnEl) {
  const pid = String(productId);
  const product = state.products.find(p => String(p.id) === pid);

  if (!product) {
    console.warn('[quickAdd] Produit introuvable:', productId);
    return;
  }

  addToCart(product, 1, btnEl);
}

/**
 * Supprime instantanément un produit du panier (swipe left sur mobile).
 * @param {number|string} productId - ID produit à supprimer
 */
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
  /**
 * Bascule un produit en favori / non favori.
 * @param {number|string} id - ID produit
 * @param {HTMLElement} [btn] - Bouton cœur
 */
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

  // ╔══════════════════════════════════════════════════════════════════╗
  // ║  §10 · CART PANEL & SHARE — Tiroir panier + partage WhatsApp     ║
  // ╚══════════════════════════════════════════════════════════════════╝
  //  → Futur module: b-cart.js (même module §7)

  /**
   * Ouvre le panneau panier latéral (slide-in depuis la droite).
   * Met à jour le rendu complet + synchronise les badges.
   */
  function openCart() {
    renderCartBody();
    dom.cartHeaderTitle.textContent = 'Mon Panier (' + cartQty() + ')';
    dom.cartOverlay.classList.add('open');
    dom.cartDrawer.classList.add('open');
    scroll.savedY = window.scrollY;
    document.body.classList.add('cart-open');
  }

  /**
   * Ferme le panneau panier + restore le scroll catalogue.
   */
  function closeCart() {
    dom.cartOverlay.classList.remove('open');
    dom.cartDrawer.classList.remove('open');
    document.body.classList.remove('cart-open');
    document.body.classList.remove('cart-empty');
    if (scroll.savedY) {
      window.scrollTo(0, scroll.savedY);
      scroll.savedY = 0;
    }
  }

  /**
   * Ouvre le panneau panier et met en surbrillance un produit spécifique.
   * @param {number|string} productId - ID du produit à mettre en avant
   */
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
    scroll.savedY = window.scrollY;
    document.body.classList.add('cart-open');

    setTimeout(() => {
      const newItem = dom.cartBody.querySelector('.k-cart-item.new-item');
      if (newItem) newItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 120);
  }

  /**
   * Re-rend le contenu du panneau panier (liste items + totaux + CTA).
   * @param {number|string} [highlightId] - ID produit à mettre en évidence (optionnel)
   */
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

    // Bouton événement collectif
    const _evtBtnExisting = document.getElementById('k-cart-event-btn');
    if (_evtBtnExisting) _evtBtnExisting.remove();
    const _evtBtn = document.createElement('button');
    _evtBtn.id = 'k-cart-event-btn';
    _evtBtn.type = 'button';
    _evtBtn.className = 'k-cart-event-btn';
    _evtBtn.innerHTML = '👥 Payer en groupe';
    _evtBtn.addEventListener('click', () => {
      _showFamilySheet();
    });
    if (dom.cartFooter) {
      const _checkoutBtn = dom.cartFooter.querySelector('#k-cart-checkout') || dom.cartCheckout;
      if (_checkoutBtn && _checkoutBtn.parentNode === dom.cartFooter) {
        dom.cartFooter.insertBefore(_evtBtn, _checkoutBtn);
      } else {
        dom.cartFooter.appendChild(_evtBtn);
      }
      // CSS inline once
      if (!document.getElementById('k-cart-event-css')) {
        const _s = document.createElement('style'); _s.id = 'k-cart-event-css';
        _s.textContent = '.k-cart-event-btn{width:100%;padding:11px;background:linear-gradient(135deg,var(--violet,#6c3fc5),var(--violet-dark,#4a2d9e));color:#fff;border:none;border-radius:50px;font-size:14px;font-weight:700;cursor:pointer;margin-bottom:8px;box-shadow:0 4px 14px var(--violet-light,rgba(108,63,197,.3));letter-spacing:.01em}';
        document.head.appendChild(_s);
      }
    }

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

  /**
 * Construit l'URL de partage du panier via l'API.
 * @param {Object} opts - { type: 'simple'|'event', eventLabel? }
 * @returns {Promise<string>} URL de partage
 */
  async function buildCartShareURL(opts) {
    opts = opts || {};
    const payload = {
      cart_items: state.cart.map(function(item) {
        return {
          product_id: item.product.id,
          qty: item.qty,
          price_kmf: item.product.promo_price_kmf || item.product.price_kmf || 0
        };
      }),
      type:        opts.type        || 'simple',
      event_label: opts.event_label || null,
      sharer_name: opts.sharer_name || null
    };
    const res = await apiPost('/api/shares', payload);
    if (res && (res.url || res.share_url)) return res.url || res.share_url;
    throw new Error('url manquante');
  }

  /**
   * Construit l'URL de partage de secours si l'API share échoue.
   * Encode les items du panier en query string.
   * @returns {string} URL de partage fallback
   */
  function _buildFallbackCartURL() {
    // Fallback legacy URL si l'API échoue
    const items = state.cart.map(function(item) {
      return item.product.id + ':' + item.qty;
    });
    return window.location.origin + '/Komerce_Boutique.html?cart=' + encodeURIComponent(items.join(','));
  }

  /* ======= SHARE CHOICE MODAL ======= */
  /**
 * Injecte le CSS du modal de partage (une seule fois).
 */
  function _injectShareModalCSS() {
    if (document.getElementById('k-share-modal-css')) return;
    var s = document.createElement('style');
    s.id = 'k-share-modal-css';
    var css = '';
    css += '.k-share-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9998;display:flex;align-items:flex-end;justify-content:center}';
    css += '.k-share-sheet{background:#fff;border-radius:20px 20px 0 0;padding:28px 20px 36px;width:100%;max-width:480px;animation:kShareIn .3s ease}';
    css += '@keyframes kShareIn{from{transform:translateY(60px);opacity:0}to{transform:translateY(0);opacity:1}}';
    css += '.k-share-title{font-size:17px;font-weight:800;text-align:center;margin-bottom:6px}';
    css += '.k-share-sub{font-size:13px;color:#999;text-align:center;margin-bottom:22px}';
    css += '.k-share-choices{display:flex;flex-direction:column;gap:12px}';
    css += '.k-share-choice{display:flex;align-items:center;gap:14px;padding:16px;border:2px solid #e0e0e0;border-radius:14px;cursor:pointer;transition:border-color .2s;background:#fff}';
    css += '.k-share-choice:active,.k-share-choice:hover{border-color:#e53935;background:#fff8f8}';
    css += '.k-share-choice-icon{font-size:32px;flex-shrink:0}';
    css += '.k-share-choice-label{font-size:15px;font-weight:700}';
    css += '.k-share-choice-desc{font-size:12px;color:#757575;margin-top:2px}';
    css += '.k-share-cancel{margin-top:16px;width:100%;padding:12px;border:none;background:none;color:#999;font-size:14px;cursor:pointer}';
    css += '.k-family-total{font-size:19px;font-weight:800;text-align:center;color:#e53935;margin:8px 0 18px}';
    css += '.k-share-sub-family{font-size:14px;color:#555;text-align:center;margin-bottom:16px;line-height:1.5}';
    css += '.k-event-form label{font-size:13px;color:#757575;display:block;margin-bottom:4px;margin-top:14px}';
    css += '.k-event-form input{width:100%;padding:11px 14px;border:1.5px solid #e0e0e0;border-radius:10px;font-size:14px;outline:none;box-sizing:border-box}';
    css += '.k-event-form input:focus{border-color:#e53935}';
    css += '.k-event-go{width:100%;padding:13px;background:#e53935;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:800;cursor:pointer;margin-top:16px}';
    s.textContent = css;
    document.head.appendChild(s);
  }

  /**
   * Ferme et détruit le bottom sheet de choix de partage panier.
   */
  function _closeShareModal() {
    var ov = document.getElementById('k-share-overlay');
    if (ov) ov.remove();
  }

  /**
   * Affiche le bottom sheet "Simple / Événement collectif" pour le partage panier.
   * Point d'entrée unique pour tout partage WhatsApp du panier.
   */

  /* ══════════════════════════════════════════════════════════
     FAMILY PARTICIPATION SHEET
     "Payer en groupe" — bottom sheet dédié
     ══════════════════════════════════════════════════════════ */

  /**
   * Ouvre le bottom sheet "👥 Payer en groupe".
   * Remplace le redirect vers /event/create.
   */
  function _showFamilySheet() {
    if (state.cart.length === 0) { showToast('Votre panier est vide.', 'error'); return; }
    _injectShareModalCSS();

    var total = cartTotal();

    var ov = document.createElement('div');
    ov.id = 'k-share-overlay';
    ov.className = 'k-share-overlay';

    var html = '<div class="k-share-sheet" id="k-share-sheet">'
      + '<div class="k-share-title">👥 Payer en groupe</div>'
      + '<div class="k-share-sub-family">Plusieurs proches peuvent payer une partie<br>de ce panier.</div>'
      + '<div class="k-family-total">' + fmt(total, 'KMF') + '</div>'
      + '<div class="k-event-form">'
        + '<label>Nom du panier <span style="color:#bbb;font-weight:400;font-size:11px">(facultatif)</span></label>'
        + '<input id="k-event-label" type="text" placeholder="Ex : Ex : Famille, Cousins, Mariage" maxlength="80"/>'
        + '<button class="k-event-go" id="k-family-go-btn">Créer le lien de participation</button>'
      + '</div>'
      + '<button class="k-share-cancel" id="k-share-cancel-btn">Annuler</button>'
      + '</div>';

    ov.innerHTML = html;
    ov.addEventListener('click', function(e) { if (e.target === ov) _closeShareModal(); });
    document.body.appendChild(ov);

    // Focus sur le champ (confort mobile)
    setTimeout(function() {
      var inp = document.getElementById('k-event-label');
      if (inp) inp.focus();
    }, 350);

    document.getElementById('k-family-go-btn').addEventListener('click', _doFamilyShare);
    document.getElementById('k-share-cancel-btn').addEventListener('click', _closeShareModal);
  }

  /**
   * Crée le lien de participation famille et l'envoie via WhatsApp.
   */
  function _doFamilyShare() {
    var labelEl = document.getElementById('k-event-label');
    var eventLabel = labelEl ? labelEl.value.trim() : '';

    // Sauvegarder le panier en session pour event-create.js
    try {
      var pendingItems = state.cart.map(function(item) {
        return {
          product_id:   item.product.id,
          product_name: item.product.name || '',
          name:         item.product.name || '',
          price_kmf:    item.product.promo_price_kmf || item.product.price_kmf || 0,
          qty:          item.qty,
          quantity:     item.qty,
        };
      });
      sessionStorage.setItem('komerce_event_pending_cart', JSON.stringify(pendingItems));
    } catch(_) {}

    _closeShareModal();

    // Rediriger vers /event/create?from=cart (+ label pré-rempli si saisi)
    var url = '/event/create?from=cart';
    if (eventLabel) url += '&label=' + encodeURIComponent(eventLabel);
    window.location.href = url;
  }

  function showShareChoiceModal() {
    if (state.cart.length === 0) { showToast('Votre panier est vide.', 'error'); return; }
    _injectShareModalCSS();
    var ov = document.createElement('div');
    ov.id = 'k-share-overlay';
    ov.className = 'k-share-overlay';
    var html = '<div class="k-share-sheet" id="k-share-sheet">'
      + '<div class="k-share-title">Comment partager ?</div>'
      + '<div class="k-share-sub">Choisis selon l&#x27;occasion</div>'
      + '<div class="k-share-choices">'
        + '<div class="k-share-choice" id="k-choice-simple">'
          + '<div class="k-share-choice-icon">&#128279;</div>'
          + '<div><div class="k-share-choice-label">Partage simple</div>'
          + '<div class="k-share-choice-desc">Le destinataire voit ton panier et peut commander</div></div>'
        + '</div>'
        + '<div class="k-share-choice" id="k-choice-event">'
          + '<div class="k-share-choice-icon">&#127881;</div>'
          + '<div><div class="k-share-choice-label">&#201;v&#233;nement collectif</div>'
          + '<div class="k-share-choice-desc">Mariage, anniversaire, naissance&#8230; chacun contribue</div></div>'
        + '</div>'
      + '</div>'
      + '<button class="k-share-cancel" id="k-share-cancel-btn">Annuler</button>'
      + '</div>';
    ov.innerHTML = html;
    ov.addEventListener('click', function(e){ if (e.target === ov) _closeShareModal(); });
    document.body.appendChild(ov);
    document.getElementById('k-choice-simple').addEventListener('click', function() {
      _closeShareModal(); _doSimpleShare();
    });
    document.getElementById('k-choice-event').addEventListener('click', _showEventForm);
    document.getElementById('k-share-cancel-btn').addEventListener('click', _closeShareModal);
  }

  /**
   * Affiche le formulaire de création d'événement collectif dans le bottom sheet de partage.
   * Permet de saisir le libellé de l'événement et le nom du créateur.
   */
  function _showEventForm() {
    var sheet = document.getElementById('k-share-sheet');
    if (!sheet) return;
    /* Refresh 28/04/26 — Vocabulaire spec V1 : "Paiement groupé" + ajout
       champ téléphone obligatoire (utilisé par authenticateOrCreateGuest
       pour créer le user à la volée si l'utilisateur n'est pas connecté). */
    var html = '<div class="k-share-title">&#127881; Payer en groupe</div>'
      + '<div class="k-share-sub">Cr&#233;e un lien pour que tes proches contribuent &#224; ce panier</div>'
      + '<div class="k-event-form">'
        + '<label>Nom du panier <span style="color:#999">(optionnel)</span></label>'
        + '<input id="k-event-label" type="text" placeholder="ex: Cadeau Maman, Cousins, Mariage..." maxlength="80"/>'
        + '<label>Ton pr&#233;nom</label>'
        + '<input id="k-event-sharer" type="text" placeholder="ex: Fatima" maxlength="60"/>'
        + '<label>Ton num&#233;ro <span style="color:#999">(pour suivre les contributions)</span></label>'
        + '<input id="k-event-phone" type="tel" placeholder="ex: +269..." maxlength="20"/>'
        + '<button class="k-event-go" id="k-event-go-btn">Créer le lien de groupe</button>'
      + '</div>'
      + '<button class="k-share-cancel" id="k-share-back-btn">&#8592; Retour</button>';
    sheet.innerHTML = html;
    document.getElementById('k-event-go-btn').addEventListener('click', _doEventShare);
    document.getElementById('k-share-back-btn').addEventListener('click', function() {
      _closeShareModal(); showShareChoiceModal();
    });
  }

  /**
 * Exécute le partage simple du panier via WhatsApp.
 */
  async function _doSimpleShare() {
    showToast('Generation du lien...', 'info');
    var cartURL;
    try { cartURL = await buildCartShareURL({ type: 'simple' }); }
    catch(e) { cartURL = _buildFallbackCartURL(); }
    var lines = ['&#129525; *Mon panier Komerce*', '--------------------', ''];
    state.cart.forEach(function(item, i) {
      var name = item.product.name || 'Produit';
      var price = (item.product.promo_price_kmf || item.product.price_kmf || 0) * item.qty;
      var line = (i+1) + '. ' + name;
      if (item.qty > 1) line += ' x' + item.qty;
      line += ' - ' + fmt(price, 'KMF');
      lines.push(line);
    });
    lines.push('', '--------------------');
    lines.push('Total : ' + fmt(cartTotal(), 'KMF') + ' (approx. ' + fmt(cartTotal(), 'EUR') + ')');
    lines.push('Livraison incluse - 3-5 semaines', '');
    lines.push('Voir le panier et commander :', cartURL);
    window.open('https://wa.me/?text=' + encodeURIComponent(lines.join('\n')), '_blank');
  }

  /**
 * Exécute le partage événement collectif (mariage, fête…).
 */
  async function _doEventShare() {
    /* Refresh 28/04/26 — Bascule de l'ancienne route /api/shares vers
       la nouvelle chaîne /api/shared-carts/from-cart-items qui apporte :
       - paiement Stripe réel (vs déclaratif sur l'ancienne)
       - idempotence et transactions
       - conversion automatique en order Komerce
       - compatible "paiement mixte cash relais" (mixed_shared_cart_cash) */

    var labelEl  = document.getElementById('k-event-label');
    var sharerEl = document.getElementById('k-event-sharer');
    var phoneEl  = document.getElementById('k-event-phone');
    var eventLabel = labelEl  ? labelEl.value.trim()  : '';
    var sharerName = sharerEl ? sharerEl.value.trim() : '';
    var phone      = phoneEl  ? phoneEl.value.trim()  : '';

    /* Phone obligatoire : c'est lui qui sert à authenticateOrCreateGuest
       pour rattacher le panier à un user (existant ou créé à la volée). */
    if (!phone) {
      showToast('Ton num&#233;ro est requis pour cr&#233;er le paiement groupé', 'error');
      return;
    }

    var btn = document.getElementById('k-event-go-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Cr&#233;ation...'; }

    /* Construire le payload. Le backend re-vérifie tous les prix DB :
       on n'envoie que product_id + quantity, jamais de prix. */
    var payload = {
      cart_items: state.cart.map(function(item) {
        return {
          product_id: item.product.id,
          quantity:   item.qty,
        };
      }),
      title:            eventLabel || null,
      message:          sharerName ? ('De la part de ' + sharerName) : null,
      tracking_phone:   phone,    /* lu par authenticateOrCreateGuest */
      recipient_phone:  phone,    /* le bénéficiaire = créateur en V1 */
    };

    var response;
    try {
      response = await apiPost('/api/shared-carts/from-cart-items', payload);
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = 'Créer le lien de groupe'; }
      var msg = (err && err.message) ? err.message : 'Erreur lors de la cr&#233;ation';
      showToast(msg, 'error');
      return;
    }

    if (!response || !response.share_url) {
      if (btn) { btn.disabled = false; btn.textContent = 'Créer le lien de groupe'; }
      showToast('R&#233;ponse serveur invalide', 'error');
      return;
    }

    _closeShareModal();

    /* Composer le message WhatsApp. On garde la mise en forme actuelle qui
       fonctionne bien : titre, liste articles, total, lien, signature. */
    var lines = ['👥 *' + (eventLabel || 'Paiement groupé') + '*', '--------------------', ''];
    lines.push('Aide-moi &#224; financer ce panier - participe selon tes moyens !', '');
    state.cart.forEach(function(item, i) {
      var name = item.product.name || 'Produit';
      var price = (item.product.promo_price_kmf || item.product.price_kmf || 0) * item.qty;
      var line = (i+1) + '. ' + name;
      if (item.qty > 1) line += ' x' + item.qty;
      line += ' - ' + fmt(price, 'KMF');
      lines.push(line);
    });
    lines.push('', '--------------------');
    lines.push('Total : ' + fmt(response.total_kmf || cartTotal(), 'KMF'), '');
    lines.push('Voir et participer :', response.share_url);
    if (sharerName) lines.push('', 'Merci de la part de ' + sharerName + ' &#10084;&#65039;');

    window.open('https://wa.me/?text=' + encodeURIComponent(lines.join('\n')), '_blank');

    /* Toast de confirmation + lien vers la page de suivi */
    showToast('Paiement groupé créé - lien envoyé sur WhatsApp', 'success');

    /* Stocker le token pour accès rapide depuis la boutique */
    try {
      var stored = JSON.parse(localStorage.getItem('k_group_carts') || '[]');
      stored.unshift({
        token: response.token,
        title: eventLabel || 'Paiement groupé',
        total_kmf: response.total_kmf,
        share_url: response.share_url,
        created_at: new Date().toISOString(),
      });
      localStorage.setItem('k_group_carts', JSON.stringify(stored.slice(0, 10)));
    } catch(e) {}

    /* Bouton de suivi affiché 3 secondes après */
    setTimeout(function() {
      var followBtn = document.createElement('div');
      followBtn.style.cssText = 'position:fixed;bottom:calc(var(--bnav-h,56px) + 12px);left:50%;transform:translateX(-50%);z-index:2000;background:var(--violet,#6c3fc5);color:#fff;padding:10px 20px;border-radius:50px;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(108,63,197,.4);white-space:nowrap;';
      followBtn.textContent = '👥 Suivre mon panier groupe →';
      followBtn.onclick = function() {
        window.location.href = '/boutique/shared-cart-account.html?phone=' + encodeURIComponent(phone);
      };
      document.body.appendChild(followBtn);
      setTimeout(function() { if (followBtn.parentNode) followBtn.remove(); }, 6000);
    }, 1500);
  }

  /**
   * @brief shareCartWhatsApp — Déclenche le flow de partage panier WhatsApp
   * Affiche le bottom sheet showShareChoiceModal() :
   *   - Mode "Simple" : lien panier partagé
   *   - Mode "Événement collectif" : flow contributions
   */
    async function shareCartWhatsApp() {
    // Partage direct WhatsApp — pas de modal intermédiaire
    if (state.cart.length === 0) { showToast('Votre panier est vide.', 'error'); return; }
    await _doSimpleShare();
  }

  /* ── AUTO-POPULATE CART FROM SHARED URL ──────────────────── */
  /**
 * Charge et affiche un panier partagé depuis un token URL.
 * @param {string} token - Token de partage
 */
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

  /**
 * Appel API pour charger les données d'un panier partagé.
 * @param {string} token - Token de partage
 * @returns {Promise<Object>} Données du panier
 */
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


  // ╔══════════════════════════════════════════════════════════════════╗
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


  // ╔══════════════════════════════════════════════════════════════════╗
  // ║  §14 · STEPPER — Bouton panier → stepper +/- avec haptic         ║
  // ╚══════════════════════════════════════════════════════════════════╝
  //  → Futur module: b-cart.js (même module §7)

  /**
   * Ferme le stepper actuellement ouvert et remet le bouton 🧺 panier à sa place.
   */
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

  /**
   * Remet à zéro le timer d'auto-fermeture du stepper (3s sans interaction).
   */
  function resetAutoClose() {
    if (autoCloseTimer) clearTimeout(autoCloseTimer);
    autoCloseTimer = setTimeout(closeActiveStepper, STEPPER_AUTOCLOSE_MS);
  }

  /**
   * Ouvre le stepper inline sur une carte produit et anime son apparition.
   * @param {HTMLElement} btn - Bouton 🧺 qui déclenche l'ouverture
   */
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

  /**
   * Démarre le chrono de long-press sur un bouton stepper (−/+).
   * Déclenche une répétition accélérée après 500ms.
   * @param {Event} e - Événement pointerdown
   */
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

  /**
   * Arrête la répétition du long-press et libère le pointeur.
   * @param {Event} e - Événement pointerup/pointerleave
   */
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

  /**
   * Annule le long-press en cours sans déclencher d'action répétée.
   */
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

  // closeActiveStepper est exporté pour que d'autres modules puissent fermer le stepper
})();



// ═══════════════════════════════════════════════════════════════════════
// Placeholder adaptatif sur la barre de recherche (évite troncature)
// ═══════════════════════════════════════════════════════════════════════
(function adaptivePlaceholder() {
  /**
   * Met à jour le texte placeholder de la barre de recherche selon la catégorie active.
   * Utilise un cycle rotatif de suggestions thématiques.
   */
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
  /**
   * Rend l'index flottant des catégories (visible sur desktop, masqué sur mobile).
   * Génère les ancres de navigation rapide entre sections.
   */
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
        scrollToCategorySection(cat);
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
        if (scroll.scrollingToSection) return;
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
  // _pagerRaf declared in _syncChipToScroll block above

// ══════════════════════════════════════════════════════════════════
// SIDE CART — Aperçu permanent desktop + total mobile bnav
// ══════════════════════════════════════════════════════════════════
function renderSideCart() {
  const sc       = document.getElementById('k-side-cart');
  const bnavLbl  = document.getElementById('k-bnav-cart-label');
  const items    = state.cart;
  const hasItems = items.length > 0;

  // Mobile bnav label : "Panier" → total ou retour
  if (bnavLbl) {
    if (hasItems) {
      bnavLbl.textContent = fmtPrice(cartTotal());
      bnavLbl.classList.add('has-total');
    } else {
      bnavLbl.textContent = 'Panier';
      bnavLbl.classList.remove('has-total');
    }
  }

  if (!sc) return;
  sc.classList.toggle('has-items', hasItems);
  if (!hasItems) return;

  // Compteur
  const qty     = cartQty();
  const countEl = sc.querySelector('#k-sc-count');
  if (countEl) countEl.textContent = qty + ' article' + (qty > 1 ? 's' : '');

  // Total
  const totalEl = sc.querySelector('#k-sc-total');
  if (totalEl) totalEl.textContent = fmtPrice(cartTotal());

  // Articles (4 plus récents)
  const itemsEl = sc.querySelector('#k-sc-items');
  if (itemsEl) {
    itemsEl.innerHTML = '';
    [...items].reverse().slice(0, 4).forEach(item => {
      const el   = document.createElement('div');
      el.className = 'k-sc-item';
      const imgSrc = item.product.image_url ? optimizeImgUrl(item.product.image_url, 80) : '';
      const price  = fmtPrice((item.product.price_kmf || 0) * item.qty);
      el.innerHTML =
        `<img class="k-sc-item-img" src="${imgSrc}" alt="" loading="lazy">` +
        `<div class="k-sc-item-info">` +
          `<div class="k-sc-item-name">${sanitize(item.product.name || '')}</div>` +
          `<div class="k-sc-item-qty">×${item.qty}</div>` +
        `</div>` +
        `<div class="k-sc-item-price">${price}</div>`;
      itemsEl.appendChild(el);
    });
  }

  // Bouton "Voir le panier" → ouvre le tiroir (câblé une seule fois)
  const cta = sc.querySelector('#k-sc-cta');
  if (cta && !cta._wired) {
    cta._wired = true;
    cta.addEventListener('click', () => openCart());
  }
}

// Hook global appelé par b-cart-core.js updateCartBadge()
window.__kmrcSideCart = renderSideCart;

export {
  addToCart, quickAdd, quickRemove, toggleFav, setQty,
  openCart, closeCart, openCartWithHighlight,
  renderCartBody,
  removeFromCart, markAllCartButtons,
  shareCartWhatsApp, showShareChoiceModal, loadSharedCart,
  _showEventForm, _doEventShare,
};
// Alias pour boutique.js qui importe 'renderCart'
export { renderCartBody as renderCart };
