/**
 * @module boutique
 * @brief Komerce boutique — migration ES modules (Option C)
 *
 * Phase 3 : §3 TOAST & CART CORE → b-cart-core.js ✅
 *
 * §1  UTILS        → b-utils.js      ✅
 * §2  STATE & DOM  → b-store.js      ✅
 * §3  CART CORE    → b-cart-core.js  ✅
 * §4  CATALOG      ← ici (futur b-catalog.js)
 * §5  FLAT SUBCAT  (futur b-subcat.js)
 * §6  GRID SECTIONS
 * §7  CART INTERACTIONS
 * §8  CATS & SEARCH
 * §9  MODAL
 * §10 CART PANEL & SHARE
 * §11 CHECKOUT
 * §12 VIEWS
 * §13 INIT
 * §14 STEPPER
 * §15 PAGER TEMU
 */

import { bus }           from './b-bus.js';
import {
  state, SUBCATS, dom, initDom, updateMobileScrollTop,
  $, $$, CART_VERSION, PAGE_SIZE,
}                         from './b-store.js';
import {
  optimizeImgUrl, sanitize, promoImgUrl, renderProductCarousel,
  bindCarouselDots, detectCurrency, fmt, fmtPrice,
  productEmoji, genIdempotencyKey, _currency, _rates,
}                         from './b-utils.js';
import {
  showToast, cartQty, cartTotal, saveCart, updateCartBadge,
  isFav, saveFavs,
}                         from './b-cart-core.js';
import {
  renderPromos, renderGrid, renderSection,
  initCats, initSearch,
}                         from './b-catalog.js';
import {
  initFlatSubcat, renderSubcatChips,
}                         from './b-subcat.js';
import {
  openModal, closeModal, modalGoBack,
}                         from './b-modal.js';

'use strict';

// ── CONSTANTES KOMERCE ──────────────────────────────────
const KOMERCE_WA = '33699272526';
const KOMERCE_WA_URL = 'https://wa.me/' + KOMERCE_WA;

/* ═══════════════════════════════════════════════════════════
   KOMERCE — Boutique JS v2.0 "Archipel"
   Full cart/checkout mechanism ported from original
   Depends on: komerce-api.js (K global), Stripe (optional)
   ═══════════════════════════════════════════════════════════ */

  // Numéro WhatsApp de contact Komerce (format international sans +)


  // ╔══════════════════════════════════════════════════════════════════╗
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
      dom.addCartBtn.onclick = function() { closeModal(); setTimeout(openCart, 150); };
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
    window._savedScrollY = window.scrollY;
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
    if (typeof window._savedScrollY === 'number') {
      window.scrollTo(0, window._savedScrollY);
      window._savedScrollY = 0;
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
    window._savedScrollY = window.scrollY;
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
    var html = '<div class="k-share-title">&#127881; &#201;v&#233;nement collectif</div>'
      + '<div class="k-share-sub">Les invit&#233;s pourront contribuer article par article</div>'
      + '<div class="k-event-form">'
        + '<label>Nom de l&#x27;&#233;v&#233;nement</label>'
        + '<input id="k-event-label" type="text" placeholder="ex: Mariage de Samyr" maxlength="80"/>'
        + '<label>Ton pr&#233;nom</label>'
        + '<input id="k-event-sharer" type="text" placeholder="ex: Fatima" maxlength="60"/>'
        + '<button class="k-event-go" id="k-event-go-btn">Cr&#233;er le lien &#127881;</button>'
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
    var labelEl  = document.getElementById('k-event-label');
    var sharerEl = document.getElementById('k-event-sharer');
    var eventLabel = labelEl  ? labelEl.value.trim()  : '';
    var sharerName = sharerEl ? sharerEl.value.trim() : '';
    if (!eventLabel) { showToast('Donne un nom a l&#x27;evenement', 'error'); return; }
    var btn = document.getElementById('k-event-go-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Creation...'; }
    _closeShareModal();
    showToast('Creation de l&#x27;evenement...', 'info');
    var cartURL;
    try {
      cartURL = await buildCartShareURL({ type: 'event', event_label: eventLabel, sharer_name: sharerName || null });
    } catch(e) { cartURL = _buildFallbackCartURL(); }
    var lines = ['&#127881; *' + eventLabel + '*', '--------------------', ''];
    lines.push('Voici la liste des cadeaux - contribue a ce qui te convient !', '');
    state.cart.forEach(function(item, i) {
      var name = item.product.name || 'Produit';
      var price = (item.product.promo_price_kmf || item.product.price_kmf || 0) * item.qty;
      var line = (i+1) + '. ' + name;
      if (item.qty > 1) line += ' x' + item.qty;
      line += ' - ' + fmt(price, 'KMF');
      lines.push(line);
    });
    lines.push('', '--------------------');
    lines.push('Total : ' + fmt(cartTotal(), 'KMF'), '');
    lines.push('Voir et contribuer :', cartURL);
    if (sharerName) lines.push('Merci de la part de ' + sharerName);
    window.open('https://wa.me/?text=' + encodeURIComponent(lines.join('\n')), '_blank');
  }

  /**
   * @brief shareCartWhatsApp — Déclenche le flow de partage panier WhatsApp
   * Affiche le bottom sheet showShareChoiceModal() :
   *   - Mode "Simple" : lien panier partagé
   *   - Mode "Événement collectif" : flow contributions
   */
    async function shareCartWhatsApp() {
    showShareChoiceModal();
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
  // ║  §11 · CHECKOUT — Commande, paiement, wallet, order success      ║
  // ╚══════════════════════════════════════════════════════════════════╝
  //  → Futur module: b-checkout.js

  /**
   * @brief checkoutCart — Lance le flow de commande depuis le panier
   * Prérequis : panier non vide (sinon toast error)
   * Ferme le tiroir panier, initialise state.orderData, affiche renderCheckout()
   */
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
      bnav.classList.add('u-hidden');
    }
  }

  /**
   * Ferme et détruit le modal de confirmation de commande.
   */
  function closeOrderModal() {
    dom.orderModal.classList.remove('open');
    document.body.classList.remove('cart-open');
    // FIX : restaurer bnav
    const bnav = document.getElementById('k-bnav');
    if (bnav) {
      bnav.classList.remove('u-hidden');
    }
    if (typeof window._savedScrollY === 'number') {
      window.scrollTo(0, window._savedScrollY);
      window._savedScrollY = 0;
    }
  }

  /**
   * Rend l'interface complète de passage de commande (récap + formulaire contact + paiement).
   * Gère les étapes : validation panier → saisie infos → confirmation.
   */
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

    /**
 * Met à jour le récapitulatif paiement en checkout.
 */
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

  /**
 * Crée un input stylé pour le checkout.
 * @param {string} type
 * @param {string} name
 * @param {string} placeholder
 * @returns {HTMLElement}
 */
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


  /**
   * Crée un champ de saisie téléphone international avec sélecteur d'indicatif.
   * @param {string} id       - ID HTML du champ
   * @param {string} label    - Label affiché
   * @param {Object} dataObj  - Objet de données où écrire la valeur normalisée
   * @param {string} key      - Clé de l'objet dataObj à mettre à jour
   */
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

  /**
   * Supprime tous les caractères non numériques d'une chaîne.
   * @param {string} v - Chaîne à nettoyer
   * @returns {string} Chaîne ne contenant que des chiffres
   */
  function digitsOnly(v) {
    return String(v || '').replace(/\D+/g, '');
  }

  /**
   * Normalise un numéro local en retirant le 0 initial si présent.
   * @param {string} code   - Indicatif pays (ex: "+269")
   * @param {string} digits - Numéro brut
   * @returns {string} Numéro normalisé sans préfixe local
   */
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

  /**
   * Formate un numéro brut en affichage lisible selon le pays.
   * @param {string} raw     - Numéro brut
   * @param {string} country - Code pays ISO (ex: "KM")
   * @returns {string} Numéro formaté pour affichage
   */
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

  /**
   * Construit un numéro au format E.164 (+XXXXXXXXXXX).
   * @param {string} code - Indicatif pays (ex: "+269")
   * @param {string} raw  - Numéro local (chiffres uniquement)
   * @returns {string} Numéro E.164 complet
   */
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

  /**
   * Crée un champ téléphone simplifié (sans sélecteur d'indicatif) pour les Comores.
   * @param {string} id       - ID HTML du champ
   * @param {string} label    - Label affiché
   * @param {Object} dataObj  - Objet de données cible
   * @param {string} key      - Clé à mettre à jour dans dataObj
   */
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


  /* ── Wallet ── */
  /**
 * Vérifie le solde wallet KMF du client en checkout.
 */
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
    } catch(e) { /* wallet balance non disponible */ }
  }

  /**
 * Rafraîchit l'affichage du solde wallet.
 * @param {number} balance - Solde KMF
 */
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
/**
 * Soumet la commande finale après validation du formulaire.
 * @param {HTMLElement} btn - Bouton submit déclencheur
 * @returns {Promise<void>}
 */
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
  /**
 * Affiche la confirmation après commande réussie.
 * @param {Object} order - Commande retournée par l'API
 */
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

  // ╔══════════════════════════════════════════════════════════════════╗
  // ║  §12 · VIEWS — Favoris, Suivi, Historique commandes, switchView  ║
  // ╚══════════════════════════════════════════════════════════════════╝
  //  → Futur modules: b-favs.js · b-tracking.js

  /**
   * Initialise le drawer de navigation latéral (open/close/swipe).
   * Gère le backdrop, les gestes tactiles et l'accessibilité.
   */
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
  /**
 * Active le scroll infini (IntersectionObserver sur sentinel).
 */
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
        setTimeout(() => { appendNextPage(); }, 300);
      }
    }, { rootMargin: '200px' });
    observer.observe(sentinel);
  }

  /* ── VUE FAVORIS ────────────────────────────────────────── */
  /**
 * Rend la vue Favoris.
 */
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
                : '<img src="/images/panier_tresse_vert.png" class="k-card-add-basket" alt="+" width="20" height="20">'}
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
  /**
   * Met à jour le badge numérique sur l'onglet Favoris (nb de promos actives).
   * @param {number} promoCount - Nombre de produits favoris en promo
   */
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
  /**
 * Partage la liste de souhaits (favoris) via WhatsApp.
 */
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

  /**
   * Génère le HTML de la timeline de statut commande (commandée → livrée).
   * @param {string} status - Statut courant (ex: "pending", "shipped", "delivered")
   * @returns {string} HTML de la timeline
   */
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

  /**
   * Injecte la liste des commandes passées dans le container de l'onglet Suivi.
   * @param {Array}       orders    - Tableau d'objets commande
   * @param {HTMLElement} container - Élément DOM cible
   */
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

  /**
   * Injecte le détail complet d'une commande (items, statut, timeline, infos relais).
   * @param {Object}      order     - Objet commande complet
   * @param {HTMLElement} container - Élément DOM cible
   */
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

  /**
   * Initialise la vue Suivi : formulaire tracking rapide + lien historique OTP.
   * Deux modes : tracking 4 chiffres (anonyme) et historique complet (OTP WhatsApp).
   */
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
  /**
 * Rend la liste des commandes dans l'onglet Suivi.
 * @param {Array} orders - Commandes
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
        ? '<img src="' + sanitize(optimizeImgUrl(productImg, 100)) + '" alt="" loading="lazy" decoding="async">'
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
          backBtn.classList.add('k-track-back-btn');
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
  /**
 * Retourne libellé + emoji de statut commande.
 * @param {string} status
 * @returns {{label: string, emoji: string}}
 */
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

  /**
   * Formate une date ISO en affichage localisé lisible.
   * @param {string} isoDate - Date au format ISO 8601
   * @returns {string} Date formatée (ex: "lun. 27 avr. 2026")
   */
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
  /**
 * Rend le mode recherche rapide suivi (sans auth).
 */
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
  /**
 * Bascule entre les onglets de l'app.
 * @param {string} view - boutique|cart|favs|track
 */
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
  /**
 * Initialise la bottom nav fixe (onglets + badges).
 */
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
  /**
 * Configure les boutons "Voir tout" par catégorie.
 */
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
  /**
 * Charge la liste des points relais depuis l'API.
 * @returns {Promise<void>}
 */
  async function loadRelais() {
    try {
      const data = await apiGet('/api/relais/public');
      state.relais = data.relais || data || [];
    } catch (e) { state.relais = []; }
  }

  /* ── INIT ───────────────────────────────────────────────── */
  // Note: setupStickyBar est géré par le script inline dans le HTML
  // pour éviter le double IntersectionObserver (scintillement).


  // ╔══════════════════════════════════════════════════════════════════╗
  // ║  §13 · INIT — Boot sequence, bnav, seeAll                        ║
  // ╚══════════════════════════════════════════════════════════════════╝
  //  → Reste dans boutique.js (orchestrateur)

  /**
   * Point d'entrée principal — initialise l'application Komerce boutique.
   * Charge les produits, configure les vues, branche tous les listeners.
   * Appelée une seule fois au DOMContentLoaded.
   */
  function init() {
    updateCartBadge();
    // Expose renderGrid sur window pour le listener délégué global (flat subcat)
    if (typeof window !== 'undefined') window.renderGrid = renderGrid;
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

  // resize: applyMobileStyles supprimé — CSS gère tout
  if (document.readyState === 'loading') {
    // ── LISTENER GLOBAL cart:setqty (stepper flottant) ──
  // Enregistré UNE SEULE FOIS ici — pas dans setQty (memory leak évité)
  document.addEventListener('cart:setqty', function(e) {
    var d = e.detail || {};
    if (d.pid !== undefined && d.qty !== undefined) {
      setQty(d.pid, d.qty);
    }
  });

    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }


// FIX 2.3 : Rendre les carousel dots de la modal cliquables
// DEBUG TEMPORAIRE : logguer TOUT pointerdown pour voir sur quoi on tape vraiment
document.addEventListener('pointerdown', function(e) {
  var el = e.target;
  var info = el.tagName + (el.className ? '.' + String(el.className).split(' ').slice(0,2).join('.') : '');
  var chip = el.closest ? el.closest('.k-sec-subchip') : null;
  window.__lastPointerDown = {
    target: info,
    insideChip: !!chip,
    chipCat: chip ? chip.dataset.secCat : null,
    chipSub: chip ? chip.dataset.secSub : null,
    x: e.clientX, y: e.clientY,
    pointerType: e.pointerType,
    ts: Date.now()
  };
}, true);

// ══════════════════════════════════════════════════════════
// LISTENER GLOBAL DÉLÉGUÉ pour .k-sec-subchip — SOURCE UNIQUE
// Capture phase + stopImmediatePropagation pour bypass tout handler concurrent.
// Mobile : bascule en mode flat (pager horizontal sous-cats)
// Desktop : filtre local dans la section
// ══════════════════════════════════════════════════════════
document.addEventListener('click', function(e) {
  var chip = e.target.closest('.k-sec-subchip');
  if (!chip) return;
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation(); // bloque tout handler concurrent sur le même event
  var cat = chip.dataset.secCat;
  var sub = chip.dataset.secSub;
  window.__lastSubchipClick = { cat: cat, sub: sub, ts: Date.now(), innerW: window.innerWidth, via: 'click-capture' };
  if (!cat || !sub) return;
  var state = window.state;
  if (!state) return;
  var _isMobile = window.innerWidth < 900;
  if (_isMobile) {
    // Pas de toggle-off : re-cliquer la même chip re-scroll en haut.
    // La sortie se fait UNIQUEMENT par le bouton ✕ du chrome.
    state.flatSubcat = { cat: cat, sub: sub };
    state.page = 0;
    if (typeof window.renderGrid === 'function') window.renderGrid();
    var _sc = document.getElementById('k-page-scroll');
    if (_sc) _sc.scrollTo({ top: 0, behavior: 'auto' });
  } else {
    if (!state.sectionSubcats) state.sectionSubcats = {};
    state.sectionSubcats[cat] = (state.sectionSubcats[cat] === sub) ? null : sub;
    if (typeof window.renderGrid === 'function') window.renderGrid();
  }
}, true); // capture: true → tourne AVANT tous les autres handlers

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

  // Exposer closeActiveStepper pour que d'autres parties du code (ouvrir modal, etc.) puissent fermer
  window.closeCartStepper = closeActiveStepper;
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
  // _pagerRaf declared in _syncChipToScroll block above


  // ╔══════════════════════════════════════════════════════════════════╗
  // ║  §15 · PAGER TEMU — Navigation circulaire + ghost loop            ║
  // ╚══════════════════════════════════════════════════════════════════╝
  //  → Futur module: b-pager.js

  /**
   * Initialise le pager horizontal Temu-style pour le mobile.
   * Configure le scroll-snap, les observers et la navigation circulaire (ghost loop).
   */
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
    // Remove old listeners, add new — rAF for instant + scrollend for final
    grid.removeEventListener('scroll', _onPagerScroll);
    grid.addEventListener('scroll', _onPagerScroll, { passive: true });
    grid.removeEventListener('scrollend', _syncChipToScroll);
    grid.addEventListener('scrollend', _syncChipToScroll, { passive: true });
    // ── Direction lock: handled by CSS touch-action zones ──
    // pan-y on .k-cat-section (products = vertical only)
    // pan-x on .k-sec-header (section header = horizontal swipe zone)
    // No JS direction detection needed — hardware-level separation
    // Recalc on resize/orientation change
    window.removeEventListener('resize', _setupMobilePager);
    window.addEventListener('resize', _setupMobilePager);
    // Setup auto-advance when section reaches bottom
    _setupHorizontalWrap();
  }

  /* ── Auto-advance to next category when vertical scroll ends ──
     When user scrolls down to bottom of a section → smooth snap to next.
     Uses direction tracking (_wasDown) to avoid false triggers.         */
  /* ── Auto-advance circulaire : bas → section suivante (wrap premier↔dernier)
     + retour arrière : haut de première section → dernière                    */
  /**
 * Auto-avance entre sections du pager (scroll bas → suivante).
 * Dernière section → ghost Tout (navigation circulaire).
 */
  function _setupSectionAutoAdvance() {
    var grid = document.getElementById('k-grid');
    if (!grid || window.innerWidth >= 900) return;
    var sections = Array.from(grid.querySelectorAll('.k-cat-section'));
    var n = sections.length;
    if (!n) return;

    sections.forEach(function(sec, idx) {
      if (sec.getAttribute('data-ghost')) return; // skip ghost
      // Cleanup old listeners
      if (sec._advHandler)      sec.removeEventListener('scroll',     sec._advHandler);
      if (sec._advHandlerEnd)   sec.removeEventListener('scrollend',  sec._advHandlerEnd);
      if (sec._wrapTouchStart)  sec.removeEventListener('touchstart', sec._wrapTouchStart);
      if (sec._wrapTouchEnd)    sec.removeEventListener('touchend',   sec._wrapTouchEnd);

      var _advTimer = null;
      var _lastST   = 0;
      var _wasDown  = false;

      /**
       * Vérifie si la section courante du pager est scrollée jusqu'en bas.
       * @returns {boolean} true si le bas est atteint (marge 8px)
       */
      function _atBottom() {
        if (sec.scrollHeight <= sec.clientHeight + 40) return false; // section trop courte, pas de scroll
        return sec.scrollTop + sec.clientHeight >= sec.scrollHeight - 32;
      }
      /**
       * Vérifie si la section courante du pager est en haut.
       * @returns {boolean} true si scrollTop ≤ 4px
       */
      function _atTop()    { return sec.scrollTop <= 4; }

      /**
       * Navigue vers une section du pager par index, avec scroll optionnel en haut/bas.
       * @param {number}  targetIdx      - Index de la section cible (0-indexed)
       * @param {boolean} [scrollToBottom] - Si true, scrolle en bas de la section après navigation
       */
      function _goTo(targetIdx, scrollToBottom) {
        if (window._scrollingToSection) return;
        var targetSec = sections[(targetIdx + n) % n];
        if (!targetSec) return;
        _wasDown = false;
        // Ghost Tout → scroll vers le fantôme en avant (téléportation gérée par scrollend)
        if (targetSec.getAttribute('data-ghost')) {
          _scrollPagerToGhost();
          document.querySelectorAll('.k-chip').forEach(function(c) {
            c.classList.toggle('active', c.dataset.cat === 'all');
          });
          var allChip = document.querySelector('.k-chip[data-cat="all"]');
          if (allChip && typeof centerActiveChip === 'function') centerActiveChip(allChip);
          return;
        }
        var cat = targetSec.dataset.cat;
        if (!cat) return;
        _scrollPagerToCat(cat);
        // Sync chip immédiatement (sans attendre scrollend)
        document.querySelectorAll('.k-chip').forEach(function(c) {
          c.classList.toggle('active', c.dataset.cat === cat);
        });
        var activeChip = document.querySelector('.k-chip[data-cat="' + cat + '"]');
        if (activeChip && typeof centerActiveChip === 'function') centerActiveChip(activeChip);
        setTimeout(function() {
          if (scrollToBottom) {
            targetSec.scrollTop = targetSec.scrollHeight;
          } else {
            if (targetSec.scrollTop > 0) targetSec.scrollTop = 0;
          }
        }, 450);
      }

      // ── Scroll down → advance to next (wrap: last → first) ──
      sec._advHandler = function() {
        var st = sec.scrollTop;
        if (st > _lastST + 2)      _wasDown = true;
        else if (st < _lastST - 8) _wasDown = false;
        _lastST = st;
        if (_wasDown && _atBottom()) {
          clearTimeout(_advTimer);
          _advTimer = setTimeout(function() {
            if (_wasDown && _atBottom()) _goTo(idx + 1, false); // wrap: last→first
          }, 300);
        }
      };
      sec._advHandlerEnd = function() {
        _lastST = sec.scrollTop;
        if (_wasDown && _atBottom()) {
          clearTimeout(_advTimer);
          _goTo(idx + 1, false);
        }
      };
      sec.addEventListener('scroll',    sec._advHandler,    { passive: true });
      sec.addEventListener('scrollend', sec._advHandlerEnd, { passive: true });

      // ── Pull down from top (first section only) → go to last ──
      // (finger moves DOWN on screen = trying to scroll UP past top)
      var _touchY0 = 0;
      sec._wrapTouchStart = function(e) { _touchY0 = e.touches[0].clientY; };
      sec._wrapTouchEnd   = function(e) {
        if (!_atTop()) return;
        var dy = e.changedTouches[0].clientY - _touchY0; // positive = finger down = scroll up intent
        if (dy > 60) _goTo(idx - 1, true); // wrap: first→last (scrolled to bottom of last)
      };
      // Only bind on first section for "go back to last" (and optionally all for prev)
      if (idx === 0) {
        sec.addEventListener('touchstart', sec._wrapTouchStart, { passive: true });
        sec.addEventListener('touchend',   sec._wrapTouchEnd,   { passive: true });
      }
    });
  }

  /* ── Horizontal wrap : swipe gauche sur dernière → première,
                          swipe droite sur première → dernière  ──            */
  /**
 * Wrap horizontal circulaire : dernière catégorie → ghost Tout.
 */
  function _setupHorizontalWrap() {
    var grid = document.getElementById('k-grid');
    if (!grid || window.innerWidth >= 900) return;
    // Remove old listeners
    if (grid._hwTouchStart) grid.removeEventListener('touchstart', grid._hwTouchStart);
    if (grid._hwTouchEnd)   grid.removeEventListener('touchend',   grid._hwTouchEnd);

    var _tx0 = 0, _ty0 = 0;

    grid._hwTouchStart = function(e) {
      _tx0 = e.touches[0].clientX;
      _ty0 = e.touches[0].clientY;
    };
    grid._hwTouchEnd = function(e) {
      var dx = e.changedTouches[0].clientX - _tx0;
      var dy = e.changedTouches[0].clientY - _ty0;
      // Horizontal seulement (angle < 45°)
      if (Math.abs(dx) < 40 || Math.abs(dy) > Math.abs(dx)) return;
      var sections = Array.from(grid.querySelectorAll('.k-cat-section'));
      var n = sections.length;
      if (!n) return;
      // Détection par scrollLeft absolu — résiste au snap bounce
      var maxScroll = grid.scrollWidth - grid.clientWidth;
      var atLeft  = grid.scrollLeft < grid.clientWidth * 0.4;
      var atRight = maxScroll > 0 && grid.scrollLeft > maxScroll - grid.clientWidth * 0.4;
      // wraps gérés par ghost Tout (infinite loop)
    };
    grid.addEventListener('touchstart', grid._hwTouchStart, { passive: true });
    grid.addEventListener('touchend',   grid._hwTouchEnd,   { passive: true });
  }

  // ── Sync pill ↔ scroll : rAF instant (zéro retard) ──
  var _pagerRaf = null;
  /**
   * Synchronise la chip active dans la barre catégories selon la position de scroll du pager.
   * Utilise offsetLeft pour une détection précise (pas une division par width).
   */
  function _syncChipToScroll() {
    var grid = document.getElementById('k-grid');
    if (!grid) return;
    var sections = grid.querySelectorAll('.k-cat-section');
    var scrollCenter = grid.scrollLeft + grid.clientWidth / 2;
    var bestIdx = 0, bestDist = Infinity;
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
  }

  /**
   * Handler debounced sur le scroll horizontal du pager.
   * Déclenche _syncChipToScroll + auto-avance vers section suivante si bas atteint.
   */
  function _onPagerScroll() {
    if (window._scrollingToSection) return;
    if (_pagerRaf) return;
    _pagerRaf = requestAnimationFrame(function() {
      _pagerRaf = null;
      _syncChipToScroll();
    });
  }

  /**
   * Fait défiler le pager horizontal jusqu'à la section de la catégorie donnée.
   * Met à jour la chip active et déclenche le chargement des produits si nécessaire.
   * @param {string} cat - Slug catégorie (ex: "mode", "tech", "all")
   */
  function _scrollPagerToCat(cat) {
    var grid = document.getElementById('k-grid');
    if (!grid) return;
    var section = grid.querySelector('.k-cat-section[data-cat="' + cat + '"]');
    if (!section) return;
    window._scrollingToSection = true;
    grid.scrollTo({ left: section.offsetLeft, behavior: 'smooth' });
    // Use scrollend to clear flag (precise) + timeout fallback (safe)
    grid.addEventListener('scrollend', function _clr() {
      window._scrollingToSection = false;
      grid.removeEventListener('scrollend', _clr);
    }, { once: true });
    setTimeout(function() { window._scrollingToSection = false; }, 600);
  }

  /* ── Scroll vers la section fantôme (ghost Tout en fin de pager) ── */
  /**
 * Défile le pager vers le ghost Tout (clone en avant).
 */
  function _scrollPagerToGhost() {
    var grid = document.getElementById('k-grid');
    if (!grid) return;
    var ghost = grid.querySelector('.k-cat-section[data-ghost]');
    if (!ghost) return;
    window._scrollingToSection = true;
    grid.scrollTo({ left: ghost.offsetLeft, behavior: 'smooth' });
    grid.addEventListener('scrollend', function _clr() {
      window._scrollingToSection = false;
      grid.removeEventListener('scrollend', _clr);
    }, { once: true });
    setTimeout(function() { window._scrollingToSection = false; }, 700);
  }

  /* ── Reshuffle Tout : mélange les cartes DOM à chaque téléportation ── */
  /**
 * Reshuffle Fisher-Yates les produits Tout dans le DOM.
 * Appelé à chaque téléportation → dopamine loop.
 */
  function _reshuffleToutInDOM() {
    var toutSec = document.querySelector('#k-grid .k-cat-section[data-cat="all"]:not([data-ghost])');
    if (!toutSec) return;
    var secGrid = toutSec.querySelector('.k-sec-grid');
    if (!secGrid) return;
    var cards = Array.from(secGrid.children);
    for (var _ri = cards.length - 1; _ri > 0; _ri--) {
      var _rj = Math.floor(Math.random() * (_ri + 1));
      var _rt = cards[_ri]; cards[_ri] = cards[_rj]; cards[_rj] = _rt;
    }
    var _rf = document.createDocumentFragment();
    cards.forEach(function(c) { _rf.appendChild(c); });
    secGrid.appendChild(_rf);
  }

  /* ── Infinite loop : ghost Tout en fin → téléportation silencieuse ──
     Principe : on clone la section Tout et on l'ajoute à la fin du pager.
     L'utilisateur arrive sur le ghost en scrollant en avant, puis scrollend
     détecte la position et remet scrollLeft=0 (vrai Tout) sans animation.  */
  /**
 * Initialise la navigation circulaire infinie Temu.
 */
  function _setupInfiniteLoop() {
    var grid = document.getElementById('k-grid');
    if (!grid || window.innerWidth >= 900) return;
    // Supprimer l'ancien ghost si présent
    var existing = grid.querySelector('[data-ghost]');
    if (existing) existing.remove();
    // Cloner la section Tout
    var toutSec = grid.querySelector('.k-cat-section[data-cat="all"]');
    if (!toutSec) return;
    var ghost = toutSec.cloneNode(true);
    ghost.setAttribute('data-ghost', 'true');
    grid.appendChild(ghost);
    // Téléportation silencieuse quand l'utilisateur atterrit sur le ghost
    /**
     * Détecte l'arrivée sur le ghost "Tout" en fin de pager.
     * Déclenche la téléportation silencieuse vers la vraie section "Tout" + reshuffle.
     */
    function _ghostCheck() {
      var ghostEl = grid.querySelector('[data-ghost]');
      if (!ghostEl) return;
      if (Math.abs(grid.scrollLeft - ghostEl.offsetLeft) < grid.clientWidth * 0.45) {
        // Désactiver snap + smooth, sauter au vrai Tout, réactiver
        grid.style.scrollBehavior = 'auto';
        grid.style.scrollSnapType = 'none';
        _reshuffleToutInDOM();
        grid.scrollLeft = 0;
        requestAnimationFrame(function() {
          requestAnimationFrame(function() {
            grid.style.scrollBehavior = '';
            grid.style.scrollSnapType = '';
            _syncChipToScroll();
          });
        });
      }
    }
    // Nettoyage listeners précédents
    if (grid._ghostCheck) {
      grid.removeEventListener('scrollend', grid._ghostCheck);
      clearTimeout(grid._ghostTimer);
    }
    grid._ghostCheck = _ghostCheck;
    grid.addEventListener('scrollend', _ghostCheck, { passive: true });
    // Fallback pour navigateurs sans scrollend natif
    grid.addEventListener('scroll', function() {
      clearTimeout(grid._ghostTimer);
      grid._ghostTimer = setTimeout(_ghostCheck, 200);
    }, { passive: true });
  }

  // ══════════════════════════════════════════════════════════
  // DEBUG BUTTON (temporaire) — affiche infos flat subcat à l'écran
  // Tape sur le bouton 🐛 en bas-droite pour voir le diagnostic

