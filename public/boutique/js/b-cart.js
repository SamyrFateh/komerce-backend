/**
 * @komerce-arch
 * @role          boutique-cart-and-side-cart
 * @domain        boutique
 * @layer         ui-component
 * @criticality   critical
 * @inputs        cart_state, shared_cart_context, product_actions, viewport
 * @outputs       cart_drawer, side_cart, quantity_changes, shared_cart_item_updates
 * @depends       b-store.js, b-cart-core.js, b-catalog.js, b-scroll-owner.js, shop-schema.js, routes/shared-cart.js
 * @used-by       boutique.js, b-checkout.js, b-modal-core.js, b-nav.js, b-share-cart.js
 * @doctrine      panier_ouvert_ferme, participant_lecture_seule, side_cart_non_intrusif, modal_produit_sans_chevauchement
 * @impact-areas  checkout-entry, side-cart, shared-cart-editing, participant-flow, responsive-layout
 * @version       2026-06
 */
'use strict';

/**
 * b-cart.js — Module ES · §7 CART INTERACTIONS + §10 CART PANEL & SHARE + §14 STEPPER
 * Extrait de boutique.js Sprint 2F — Option C
 *
 * §7  : addToCart, setQty, fly animation, cart badge sync
 * §10 : tiroir panier, partage WhatsApp, shareCartWhatsApp, showShareChoiceModal
 * §14 : stepper +/- inline sur les cartes
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
  showToast, saveCart, cartQty, cartTotal, saveFavs,
}                         from './b-cart-core.js';
import { isDesktop, getScrollY, scrollToPosition } from './b-scroll-owner.js';
import { getCategoryIcon, normalizeCategoryKey } from './shop-schema.js';
import { renderAddControl } from './render/render-product-card.js';
import { getProductCartSummary, getCartItemProductId } from './cart-product-summary.js';

'use strict';

  // ║  §7 · CART INTERACTIONS — addToCart, setQty, fly animation       ║
  // ╚══════════════════════════════════════════════════════════════════╝
  //  → Futur module: b-cart.js

  /**
   * Détermine si un élément est visuellement présent et interactif
   * (dimensions non nulles, pas display:none, pas visibility:hidden).
   * @param {HTMLElement|null} element
   * @returns {boolean}
   */
  function isElementVisible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const styles = window.getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      styles.display !== 'none' &&
      styles.visibility !== 'hidden'
    );
  }

  /**
   * Détermine la cible réelle de l'animation flyToCart selon le contexte :
   * si la modale est ouverte et son bouton panier visible, on vole vers
   * lui plutôt que vers la petite dame du header (masquée derrière l'overlay).
   * @returns {HTMLElement|null}
   */
  function getFlyToCartTarget() {
    const modalOverlay = dom.modalOverlay;
    const modalCartButton = dom.modalCartBtn;
    const globalCartButton = dom.cartBtn;

    const modalIsOpen = modalOverlay && modalOverlay.classList.contains('open');

    if (modalIsOpen && isElementVisible(modalCartButton)) {
      return modalCartButton;
    }

    if (isElementVisible(globalCartButton)) {
      return globalCartButton;
    }

    return null;
  }

  /**
   * Animation "fly to cart" — produit vole de la carte vers le panier actif
   * (petite dame du header ou icône panier de la modale selon le contexte).
   * Clone l'image → arc de Bézier → burst sparkles → updateCartBadge.
   * Exception légitime : animation frame-by-frame (rAF).
   * @param {HTMLElement} btn - Bouton panier cliqué
   * @param {number} productId - ID du produit ajouté
   */
  function flyToCart(sourceEl, product) {
    const cartIcon = getFlyToCartTarget();
    if (!cartIcon || !sourceEl) return;
    const srcRect = sourceEl.getBoundingClientRect();
    const dstRect = cartIcon.getBoundingClientRect();
    const startX = srcRect.left + srcRect.width / 2;
    // P1-fix : décollage au-dessus du bouton source (jamais centré dessus),
    // pour ne jamais apparaître visuellement superposée au libellé/CTA
    // qu'elle quitte. Owner : b-cart.js::flyToCart (seul créateur de cet
    // élément — cf. audit-modal-ownership.js).
    const startY = srcRect.top - 18;
    const endX = dstRect.left + dstRect.width / 2;
    const endY = dstRect.top + dstRect.height / 2;

    // Main particle — .k-fly-particle : sélecteur stable pour les oracles
    // Playwright (assertNoOverlayOnActions / addToCartFromModal), plus
    // fiable qu'un div anonyme.
    const particle = document.createElement('div');
    particle.className = 'k-fly-particle';
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

    // Phase 2: Arc flight — P1-fix : 900ms → 500ms (durée totale visée
    // ~770ms au lieu de ~1450ms, cf. audit desktop 2026-07).
    const duration = 500;
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
        }, 120);
        // Badge bump — celui du bouton réellement ciblé par l'animation
        const targetBadge = cartIcon === dom.modalCartBtn ? dom.modalCartBadge : dom.cartBadge;
        if (targetBadge) {
          targetBadge.classList.remove('bump');
          void targetBadge.offsetWidth;
          targetBadge.classList.add('bump');
        }
      }
    }

    setTimeout(() => requestAnimationFrame(animateArc), 150);
  }

  /* ── ADD TO CART ────────────────────────────────────────── */
  /* ── ADD TO CART ────────────────────────────────────────── */
/**
 * Ajoute un produit au panier ou incrémente sa quantité.
 * @param {number|string} id - ID produit
 * @param {Object} [opts] - { fromModal, qty }
 */
  function addToCart(product, qty, sourceBtn, options) {
  qty = qty || 1;
  options = options || {};

  // Lot 2 — capturer le variant_combo au moment de l'ajout (snapshot)
  let combo = null;
  let comboLabel = '';
  if (state.modalProduct && String(state.modalProduct.id) === String(product.id)
      && state.modalVariantCombo && Object.keys(state.modalVariantCombo).length > 0) {
    combo = Object.assign({}, state.modalVariantCombo);
    comboLabel = Object.values(combo).join(' / ');
  }

  // Identité canonique d'une ligne panier (doctrine §7) : produit + variant
  // + rail de transport demandé. Deux lignes avec le même produit/variant
  // mais un rail différent ne sont jamais fusionnées — null (aucun choix
  // explicite) est une valeur de rail à part entière pour cette comparaison.
  const requestedTransportRail = options.requested_transport_rail ?? null;

  // Lorsqu'une carte vise une unique ligne variante déjà au panier, elle
  // transmet explicitement cette ligne. On l'incrémente par identité d'objet
  // au lieu de recréer une ligne générique sans variant_combo. On vérifie
  // quand même le rail : une ligne explicite avec un rail différent ne doit
  // pas absorber silencieusement le nouveau choix.
  const explicitLine = options.existingLine
    && state.cart.includes(options.existingLine)
    && (options.existingLine.requested_transport_rail ?? null) === requestedTransportRail
    ? options.existingLine
    : null;
  const existing = explicitLine || state.cart.find(i =>
    getCartItemProductId(i) === String(product.id)
    && JSON.stringify(i.variant_combo || null) === JSON.stringify(combo)
    && (i.requested_transport_rail ?? null) === requestedTransportRail
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
      qty: qty,
      variant_combo: combo,
      variant_label: comboLabel,
      requested_transport_rail: requestedTransportRail,
    });
  }

  // Fly animation
  if (sourceBtn) {
    flyToCart(sourceBtn, product);
  }

  saveCart();

  const isModalAdd  = sourceBtn === dom.addCartBtn;
  // Buy-now btn est un bouton modal mais n'est pas dom.addCartBtn → détecter explicitement
  const isBuyNowBtn = sourceBtn && sourceBtn.id === 'k-buy-now-btn';

  // Mark button feedback (grid / rail buttons only — pas modal, pas buy-now)
  if (sourceBtn && !isModalAdd && !isBuyNowBtn) {
    sourceBtn.classList.add('added');
    sourceBtn.disabled = true;
    setTimeout(() => {
      sourceBtn.classList.remove('added');
      sourceBtn.classList.add('in-cart');
      sourceBtn.disabled = false;
    }, 800);
  }

  // Feedback uniquement sur la destination visuelle réelle de l'ajout.
  // L'avatar du catalogue ne s'anime jamais derrière une modale ouverte.
  const feedbackTarget = getFlyToCartTarget();
  if (feedbackTarget === dom.cartBtn) {
    dom.cartBtn.classList.remove('ring-pulse');
    void dom.cartBtn.offsetWidth;
    dom.cartBtn.classList.add('ring-pulse');
    setTimeout(() => dom.cartBtn.classList.remove('ring-pulse'), 1500);

    dom.cartBtn.classList.remove('avatar-wave');
    void dom.cartBtn.offsetWidth;
    dom.cartBtn.classList.add('avatar-wave');
    setTimeout(() => dom.cartBtn.classList.remove('avatar-wave'), 900);
  } else if (feedbackTarget === dom.modalCartBtn) {
    dom.modalCartBtn.classList.remove('ring-pulse', 'cart-icon-pulse');
    void dom.modalCartBtn.offsetWidth;
    dom.modalCartBtn.classList.add('ring-pulse', 'cart-icon-pulse');
    setTimeout(() => dom.modalCartBtn.classList.remove('ring-pulse'), 1500);
    setTimeout(() => dom.modalCartBtn.classList.remove('cart-icon-pulse'), 350);
  }

  if (isModalAdd) {
    // Découvert en faisant tourner réellement le test e2e mobile SKU
    // (elite) : ce feedback legacy réservé aux produits SIMPLE écrasait
    // sans condition le libellé persistant "🧺 Dans le panier (N)" déjà
    // peint de façon synchrone par _syncModalQtyUI() (b-modal-cart.js,
    // owner unique du libellé SKU). Guard structurel par inventory_model,
    // pas par fixture : un SKU garde toujours son libellé persistant.
    const isSkuModal = state.modalProductDetail?.inventory_model === 'SKU';
    if (!isSkuModal) {
      // Fix 8 : modal button → "✓ Dans le panier | Voir (N) →"
      setTimeout(() => {
        const count = cartQty();
        dom.addCartBtn.classList.remove('added');
        dom.addCartBtn.classList.add('confirmed');
        dom.addCartBtn.disabled = false;
        dom.addCartBtn.innerHTML = '✓ Ajouté';
        dom.addCartBtn.onclick = function() {
          bus.emit('modal:close');
          // Desktop : le side-cart est déjà visible — on ne rouvre pas le tiroir
          if (isDesktop()) {
            let sc = document.getElementById('k-side-cart');
            if (sc) { sc.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
          } else {
            setTimeout(openCart, 150);
          }
        };
      }, 700);
    }
  } else if (isBuyNowBtn) {
    // Buy-now depuis la modal : rafraîchir le side-cart desktop silencieusement
    // (la modal gère elle-même le feedback visuel du bouton et l'ouverture du panier)
    if (isDesktop()) {
      // ARCH-1 : remplace window.__kmrcSideCart → bus.emit
      bus.emit('side-cart:render');
    }
  } else if (sourceBtn) {
    // Toast de confirmation (grid / rail uniquement)
    showToast('✓ ' + (product.name || 'Produit') + ' ajouté', 'success');
  }
}

  /**
   * Met à jour une ligne panier exacte. Lorsque plusieurs variantes du même
   * produit existent et qu'aucune ligne n'est fournie, la mutation échoue
   * volontairement au lieu de viser la première ligne trouvée.
   * @param {string|number} productId
   * @param {number} newQty
   * @param {Object|null} [targetLine]
   * @returns {boolean}
   */
  function setQty(productId, newQty, targetLine) {
    const pid = String(productId);
    const summary = getProductCartSummary(state.cart, pid);
    const item = targetLine && state.cart.includes(targetLine)
      ? targetLine
      : summary.line;

    if (!item) {
      if (summary.isAmbiguous) openCartWithHighlight(pid);
      return false;
    }

    if (newQty < 1) return removeFromCart(pid, item);

    item.qty = newQty;
    saveCart();
    renderCartBody();
    return true;
  }

  /**
   * Synchronise l'état visuel de toutes les cartes catalogue/favoris depuis
   * la synthèse complète des lignes panier. Une quantité multi-variantes est
   * affichée comme un total consultable, jamais comme le qty de la première ligne.
   */
  function markAllCartButtons() {
    document.querySelectorAll('.k-card-add').forEach(control => {
      const pid = String(control.dataset.add || '');
      if (!pid) return;
      const nameEl = control.closest('.k-card')?.querySelector('.k-card-name');
      const safeName = nameEl ? sanitize(nameEl.textContent || '') : '';
      const summary = getProductCartSummary(state.cart, pid);
      const canAdjust = summary.totalQty > 0 && summary.canQuickAdjust;
      const hasMultipleLines = summary.totalQty > 0 && !summary.canQuickAdjust;

      control.classList.toggle('in-cart', canAdjust);
      control.classList.toggle('has-multiple-lines', hasMultipleLines);
      control.dataset.cartLines = String(summary.lineCount);
      control.innerHTML = renderAddControl(pid, summary, safeName, 'grid');
    });
  }

  // saveCart() → updateCartBadge() → bus 'cart:update'. Ce signal existant est
  // le point de synchronisation commun pour les mutations venant du catalogue,
  // du drawer, du side-cart, de la buybox ou d'un panier partagé.
  bus.on('cart:update', markAllCartButtons);

  /* ── REMOVE FROM CART ───────────────────────────────────── */
  /**
   * Retire une ligne exacte. Sans cible explicite, ne retire le produit que
   * lorsqu'une seule ligne existe ; plusieurs variantes restent fail-closed.
   * @param {number|string} productId
   * @param {Object|null} [targetLine]
   * @returns {boolean}
   */
  function removeFromCart(productId, targetLine) {
    const pid = String(productId);
    const summary = getProductCartSummary(state.cart, pid);
    const item = targetLine && state.cart.includes(targetLine)
      ? targetLine
      : summary.line;

    if (!item) {
      if (summary.isAmbiguous) openCartWithHighlight(pid);
      return false;
    }

    state.cart = state.cart.filter(line => line !== item);
    saveCart();
    renderCartBody();
    return true;
  }

  /* ── QUICK ADD FROM GRID ────────────────────────────────── */
  /**
   * Ajout rapide depuis une carte. Les variantes ne sont jamais choisies
   * arbitrairement : une ligne variante existante et unique est incrémentée
   * exactement ; sinon la fiche produit est ouverte sans mutation.
   * @param {number|string} productId
   * @param {HTMLElement} btnEl
   * @param {{hasVariants?: boolean}} [opts]
   */
  function quickAdd(productId, btnEl, opts) {
    const pid = String(productId);
    const product = state.products.find(p => String(p.id) === pid);

    if (!product) {
      console.warn('[quickAdd] Produit introuvable:', productId);
      return;
    }

    const summary = getProductCartSummary(state.cart, pid);
    const hasVariants = Boolean(opts && opts.hasVariants) || summary.hasVariantLines;

    if (summary.isAmbiguous) {
      bus.emit('modal:open', { id: product.id });
      return;
    }

    if (hasVariants) {
      if (!summary.line) {
        bus.emit('modal:open', { id: product.id });
        return;
      }
      addToCart(product, 1, btnEl, { existingLine: summary.line });
      return;
    }

    addToCart(product, 1, btnEl);
  }

  /**
   * Décrémente uniquement une ligne non ambiguë.
   * @param {number|string} productId
   * @param {HTMLElement} btnEl
   */
  function quickRemove(productId, btnEl) {
    const pid = String(productId);
    const summary = getProductCartSummary(state.cart, pid);
    if (summary.lineCount === 0) return;

    if (summary.isAmbiguous) {
      openCartWithHighlight(pid);
      return;
    }

    const item = summary.line;
    if (item.qty <= 1) removeFromCart(pid, item);
    else setQty(pid, item.qty - 1, item);
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
    // Desktop : le panier EST le side-cart inline (liste + total toujours visibles
    // à droite). Cliquer la dame n'ouvre donc pas un drawer-liste en doublon :
    // ça lance DIRECTEMENT le checkout, même flux que le bouton « Commander » du
    // side-cart (bus 'checkout:open' → checkoutCart(), qui gère le panier vide).
    if (isDesktop()) {
      bus.emit('checkout:open');
      return;
    }
    // ── Mobile uniquement (le return desktop est passé avant) ──
    dom.cartOverlay.classList.add('open');
    dom.cartDrawer.classList.add('open');
    scroll.savedY = getScrollY();
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
      scrollToPosition(scroll.savedY);
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

    // Desktop : side cart inline — pas de drawer ni cart-open
    if (!isDesktop()) {
      dom.cartOverlay.classList.add('open');
      dom.cartDrawer.classList.add('open');
      scroll.savedY = getScrollY();
      document.body.classList.add('cart-open');
    }

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
      // Clic sur l'image → fermer le panier puis rouvrir la fiche produit
      imgBox.addEventListener('click', () => {
        closeCart();
        bus.emit('modal:open', { id: p.id });
      });
      row.appendChild(imgBox);

      // Info
      const info = document.createElement('div');
      info.className = 'k-cart-item-info';

      const name = document.createElement('div');
      name.className = 'k-cart-item-name';
      name.textContent = p.name || 'Produit';
      // Clic sur le nom → fermer le panier puis rouvrir la fiche produit
      name.addEventListener('click', () => {
        closeCart();
        bus.emit('modal:open', { id: p.id });
      });
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
      minusBtn.addEventListener('click', () => setQty(p.id, item.qty - 1, item));
      qtyRow.appendChild(minusBtn);

      const qtyVal = document.createElement('span');
      qtyVal.className = 'k-qty-val';
      qtyVal.textContent = item.qty;
      qtyRow.appendChild(qtyVal);

      const plusBtn = document.createElement('button');
      plusBtn.className = 'k-qty-btn';
      plusBtn.textContent = '+';
      plusBtn.addEventListener('click', () => setQty(p.id, item.qty + 1, item));
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
      removeBtn.addEventListener('click', () => removeFromCart(p.id, item));
      row.appendChild(removeBtn);

      dom.cartBody.appendChild(row);
    });

    // Footer
    dom.cartFooter.classList.remove('u-hidden');

    // PR-1 : le bouton "📤 Partager" est statique dans index.html (#k-cart-share)
    // géré par b-share-cart.js — plus d'injection dynamique ici.

    // SC-EDIT-04 — En mode édition panier collectif, masquer checkout + share
    // et afficher un bandeau de confirmation dans le tiroir.
    const editCtxDrawer = state.editSharedCart;
    const cartCheckoutBtn = document.getElementById('k-cart-checkout');
    const cartShareBtn    = document.getElementById('k-cart-share');
    const cartClearBtn    = document.getElementById('k-cart-clear');
    if (cartCheckoutBtn) cartCheckoutBtn.style.display = editCtxDrawer ? 'none' : '';
    if (cartShareBtn)    cartShareBtn.style.display    = editCtxDrawer ? 'none' : '';
    // SC-EDIT-04 — Masquer aussi le bouton Vider en mode édition collective :
    // vider le panier de travail détruirait silencieusement les articles en cours d'édition.
    if (cartClearBtn)    cartClearBtn.style.display    = editCtxDrawer ? 'none' : '';

    // Injecter/retirer le bloc d'action edit dans le footer du drawer
    let drawerEditBar = document.getElementById('k-cart-edit-bar');
    if (editCtxDrawer && !drawerEditBar) {
      drawerEditBar = document.createElement('div');
      drawerEditBar.id = 'k-cart-edit-bar';
      // Lot 2 — styles inline supprimés ; owner : cart.css § k-cart-edit-bar
      drawerEditBar.innerHTML = `
        <div class="k-cart-edit-header">
          ✏️ Mode édition — Panier collectif
        </div>
        <button id="k-cart-edit-update" type="button">
          ✅ Mettre à jour le panier collectif
        </button>
        <button id="k-cart-edit-cancel" type="button">
          ✕ Annuler les modifications
        </button>
        <p id="k-cart-edit-err"></p>`;
      // Insérer dans la zone boutons du footer
      const footerBtns = document.querySelector('.k-cart-footer-btns');
      if (footerBtns) footerBtns.after(drawerEditBar);
      else dom.cartFooter.appendChild(drawerEditBar);

      // SC-EDIT-06 — Câbler update dans le drawer
      drawerEditBar.querySelector('#k-cart-edit-update')?.addEventListener('click', async () => {
        const ctx    = state.editSharedCart;
        const errEl  = drawerEditBar.querySelector('#k-cart-edit-err');
        const upBtn  = drawerEditBar.querySelector('#k-cart-edit-update');
        if (!ctx) return;
        if (errEl) errEl.textContent = '';

        const cartItems = (state.cart || [])
          .map(it => ({ product_id: it.product?.id || it.id, quantity: Number(it.qty) || 1 }))
          .filter(it => it.product_id);
        if (!cartItems.length) {
          if (errEl) errEl.textContent = 'Le panier est vide. Ajoutez au moins un article.';
          return;
        }
        upBtn.disabled = true; upBtn.textContent = '⏳ Mise à jour…';
        try {
          await fetch(`/api/shared-carts/${ctx.shared_cart_id}/items`, {
            method: 'PUT', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cart_items: cartItems }),
          }).then(async r => {
            if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d?.error || d?.message || `Erreur ${r.status}`); }
          });
          state.editSharedCart = null;
          clearCart();
          // Fermer le tiroir
          dom.cartOverlay?.classList.remove('open');
          dom.cartDrawer?.classList.remove('open');
          document.body.classList.remove('cart-open');
          showToast('✅ Panier collectif mis à jour. Les participants ont été notifiés.', 'success');
          import('./b-nav.js').then(({ switchView }) => {
            document.querySelectorAll('.k-bnav-item, .k-header-nav-btn')
              .forEach(i => i.classList.toggle('active', i.dataset.tab === 'group'));
            switchView('group');
            import('./group/group-render-list.js').then(({ renderGroupView }) => renderGroupView());
          });
        } catch (err) {
          if (errEl) errEl.textContent = err?.message || 'Impossible de mettre à jour.';
          upBtn.disabled = false; upBtn.textContent = '✅ Mettre à jour le panier collectif';
        }
      });

      // SC-EDIT-08 — Câbler annuler dans le drawer
      drawerEditBar.querySelector('#k-cart-edit-cancel')?.addEventListener('click', () => {
        if (!confirm('Annuler les modifications ? Vous revenez dans l\'onglet Groupe sans sauvegarder.')) return;
        // Supprimer le contexte d'édition — le panier boutique est laissé intact.
        state.editSharedCart = null;
        dom.cartOverlay?.classList.remove('open');
        dom.cartDrawer?.classList.remove('open');
        document.body.classList.remove('cart-open');
        showToast('Modifications annulées.', 'success');
        import('./b-nav.js').then(({ switchView }) => {
          document.querySelectorAll('.k-bnav-item, .k-header-nav-btn')
            .forEach(i => i.classList.toggle('active', i.dataset.tab === 'group'));
          switchView('group');
          import('./group/group-render-list.js').then(({ renderGroupView }) => renderGroupView());
        });
      });
    } else if (!editCtxDrawer && drawerEditBar) {
      drawerEditBar.remove();
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

  /* ======= SHARE CHOICE MODAL — DEPRECATED PR-1 =======
     Remplacé par b-share-cart.js (owner exclusif du flow "📤 Partager").
     Stubs conservés pour compatibilité exports. À supprimer en nettoyage PR-event. */

  /** @deprecated PR-1 — stub, flow géré par b-share-cart.js */
  function showShareChoiceModal() {
    // no-op — b-share-cart.js prend en charge le flow "📤 Partager"
  }

  /** @deprecated PR-1 — stub */
  function _showEventForm() { /* no-op */ }
  /** @deprecated PR-1 — stub */
  async function _doEventShare() { /* no-op */ }
  /** @deprecated PR-1 — stub */
  async function shareCartWhatsApp() {
    // no-op — b-share-cart.js prend en charge le flow "📤 Partager"
  }

    /* ── AUTO-POPULATE CART FROM SHARED URL ──────────────────── */
  /**
 * Charge et affiche un panier partagé depuis un token URL.
 * @param {string} token - Token de partage
 */
  function loadSharedCart() {
    let params = new URLSearchParams(window.location.search);

    // Nouveau : ?share=token → API
    let shareToken = params.get('share');
    if (shareToken) {
      state.shareToken = shareToken;
      _loadSharedCartFromAPI(shareToken);
      return;
    }

    // Legacy : ?cart=id1:qty1,id2:qty2
    let cartParam = params.get('cart');
    if (!cartParam) return;

    let entries = cartParam.split(',').map(function(e) {
      let parts = e.split(':');
      return { id: parts[0], qty: parseInt(parts[1]) || 1 };
    }).filter(function(e) { return e.id; });

    if (entries.length === 0) return;

    let checkProducts = setInterval(function() {
      if (!state.products || state.products.length === 0) return;
      clearInterval(checkProducts);

      state.cart = [];
      entries.forEach(function(entry) {
        let product = state.products.find(function(p) { return p.id === entry.id; });
        if (product) state.cart.push({ product: product, qty: entry.qty });
      });

      if (state.cart.length > 0) {
        saveCart();
        renderCartBody();
        setTimeout(function() {
          if (!isDesktop()) {
            dom.cartDrawer.classList.add('open');
            dom.cartOverlay.classList.add('open');
            document.body.classList.add('cart-open');
          }
          showToast('🧺 Panier partagé chargé ! ' + state.cart.length + ' article(s)', 'success');
        }, 500);
      }
      window.history.replaceState({}, '', window.location.pathname);
    }, 200);
    setTimeout(function() {
      clearInterval(checkProducts);
      if (state.cart.length === 0) showToast('⚠️ Panier partagé introuvable — réessayez depuis le lien d\'origine.', 'error');
    }, 10000);
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

      let checkProducts = setInterval(function() {
        if (!state.products || state.products.length === 0) return;
        clearInterval(checkProducts);

        state.cart = [];
        let items = data.items || data.cart_items || [];
        items.forEach(function(item) {
          // Le back peut retourner product_id ou product.id
          let pid = item.product_id || (item.product && item.product.id);
          let product = state.products.find(function(p) { return p.id === pid; });
          if (product) state.cart.push({ product: product, qty: item.qty || 1 });
        });

        if (state.cart.length > 0) {
          saveCart();
          renderCartBody();
          setTimeout(function() {
            let sharerName = data.sharer_name || data.shared_by || null;
            if (!isDesktop()) {
              dom.cartDrawer.classList.add('open');
              dom.cartOverlay.classList.add('open');
              document.body.classList.add('cart-open');
            }
            let msg = sharerName
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
      setTimeout(function() {
        clearInterval(checkProducts);
        if (state.cart.length === 0) showToast('⚠️ Panier partagé introuvable — réessayez depuis le lien d\'origine.', 'error');
      }, 10000);
    } catch(e) {
      console.warn('[share] API error:', e);
      showToast('Impossible de charger le panier partagé.', 'error');
    }
  }

  /* ══════════════════════════════════════════════════════════
     CHECKOUT / ORDER
     ══════════════════════════════════════════════════════════ */


  // Le stepper flottant par appui long a été supprimé : le contrôle canonique
  // est désormais directement visible sur la carte (0 → +, >0 → − quantité +).


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

    // Emoji résolu depuis shop-schema — source de vérité unique.
    // normalizeCategoryKey gère la rétrocompat dbKeys (Mode, Sur-mesure, etc.)
    const EMOJI_CAT = new Proxy({}, {
      get(_, cat) {
        const key = normalizeCategoryKey(cat);
        return getCategoryIcon(key) || '📦';
      }
    });

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
    if (!isDesktop() && dom.pageScroll &&
        dom.pageScroll.classList.contains('k-pager-active')) return;
    let scroller = dom.pageScroll;
    if (scroller) {
      _sectionObserver = new IntersectionObserver(function(entries) {
        if (scroll.scrollingToSection) return;
        entries.forEach(function(entry) {
          if (!entry.isIntersecting) return;
          let cat = entry.target.dataset.cat;
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
            let activeChip = document.querySelector('.k-chip.active');
            if (activeChip && typeof centerActiveChip === 'function') centerActiveChip(activeChip);
          }
        });
      }, { root: scroller, threshold: 0.3 });
      let sections = document.querySelectorAll('.k-cat-section');
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

  // Réserve la place du side cart en bordure droite du body.
  // Double-mécanisme avec body:has(.k-side-cart.has-items) en CSS :
  // si :has() n'est pas supporté (Firefox <121), cette classe prend le relais.
  document.body.classList.toggle('sc-reserve', hasItems);

  // (--sc-offset / sc-open : plus utilisés depuis que .k-side-cart est en
  // position: fixed. La réserve de place est gérée par body.sc-reserve +
  // body:has(.k-side-cart.has-items) en CSS — voir boutique-desktop.css.)
  if (!hasItems) {
    // Vider explicitement la liste DOM pour éviter les items fantômes
    // si renderSideCart() est rappelé plus tard avec un panier de nouveau plein.
    const itemsElEmpty = sc.querySelector('#k-sc-items');
    if (itemsElEmpty) itemsElEmpty.innerHTML = '';
    return;
  }

  const qty = cartQty();

  // Sous-total
  const totalEl = sc.querySelector('#k-sc-total');
  if (totalEl) totalEl.textContent = fmtPrice(cartTotal());

  // Compteur inline dans le bouton Commander
  const countInline = sc.querySelector('#k-sc-count-inline');
  if (countInline) countInline.textContent = qty;

  // Articles (plus récents en premier)
  const itemsEl = sc.querySelector('#k-sc-items');
  if (itemsEl) {
    itemsEl.innerHTML = '';
    [...items].reverse().forEach(item => {
      const lineIndex = state.cart.indexOf(item);
      const el       = document.createElement('div');
      el.className   = 'k-sc-item';
      const imgSrc   = item.product.image_url ? optimizeImgUrl(item.product.image_url, 120) : '';
      const unitPrice = item.product.price_kmf || 0;
      const linePrice = fmtPrice(unitPrice * item.qty);
      const pid      = String(item.product.id || item.id || '');
      el.dataset.pid = pid;
      el.dataset.cartIndex = String(lineIndex);

      // Prix barré si promo
      const promoPct = item.product.promo_pct || 0;
      const oldPriceHtml = promoPct > 0
        ? `<span class="k-sc-item-old-price">${fmtPrice(Math.round(unitPrice / (1 - promoPct / 100)) * item.qty)}</span>`
        : '';

      // Variant sélectionné (taille, couleur…)
      const variant = item.variant_label || item.product.variant_label || '';
      const variantHtml = variant
        ? `<span class="k-sc-item-variant">${sanitize(variant)}</span>`
        : '';

      el.innerHTML =
        `<img class="k-sc-item-img" src="${imgSrc}" alt="" loading="lazy">` +
        `<div class="k-sc-item-info">` +
          `<div class="k-sc-item-name">${sanitize(item.product.name || '')}</div>` +
          variantHtml +
          `<div class="k-sc-item-meta">` +
            `<div class="k-sc-item-price-wrap">` +
              `<span class="k-sc-item-price">${linePrice}</span>` +
              oldPriceHtml +
            `</div>` +
            `<div class="k-sc-item-actions">` +
              `<div class="k-sc-item-stepper">` +
                `<button class="k-sc-step-minus" data-pid="${pid}" data-cart-index="${lineIndex}" aria-label="Retirer un">−</button>` +
                `<span class="k-sc-item-stepper-qty">${item.qty}</span>` +
                `<button class="k-sc-step-plus" data-pid="${pid}" data-cart-index="${lineIndex}" aria-label="Ajouter un">+</button>` +
              `</div>` +
              `<button class="k-sc-item-remove" data-pid="${pid}" data-cart-index="${lineIndex}" aria-label="Supprimer l'article">` +
                `<svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="1.5" y1="1.5" x2="9.5" y2="9.5"/><line x1="9.5" y1="1.5" x2="1.5" y2="9.5"/></svg>` +
              `</button>` +
            `</div>` +
          `</div>` +
        `</div>`;
      itemsEl.appendChild(el);
    });

    // Câbler les steppers (délégation sur itemsEl)
    if (!itemsEl._scWired) {
      itemsEl._scWired = true;
      itemsEl.addEventListener('click', e => {
        const minus  = e.target.closest('.k-sc-step-minus');
        const plus   = e.target.closest('.k-sc-step-plus');
        const remove = e.target.closest('.k-sc-item-remove');
        const actionEl = minus || plus || remove;
        const pid = actionEl ? actionEl.dataset.pid : null;
        const lineIndex = actionEl ? Number(actionEl.dataset.cartIndex) : -1;
        if (!pid || !Number.isInteger(lineIndex) || lineIndex < 0) return;
        const currentItem = state.cart[lineIndex];
        if (!currentItem || getCartItemProductId(currentItem) !== String(pid)) return;
        if (minus) {
          setQty(pid, currentItem.qty - 1, currentItem);
        } else if (plus) {
          setQty(pid, currentItem.qty + 1, currentItem);
        } else if (remove) {
          setQty(pid, 0, currentItem);
        }
      });
    }
  }

  // Bouton "Voir le panier"
  const cta = sc.querySelector('#k-sc-cta');
  if (cta && !cta._wired) {
    cta._wired = true;
    cta.addEventListener('click', () => {
      // Desktop : ouvrir le tiroir complet (le side cart est déjà visible,
      // "Voir le panier" = accéder aux détails complets + WhatsApp + Commander)
      renderCartBody();
      dom.cartHeaderTitle.textContent = 'Mon Panier (' + cartQty() + ')';
      dom.cartOverlay.classList.add('open');
      dom.cartDrawer.classList.add('open');
      scroll.savedY = getScrollY();
      document.body.classList.add('cart-open');
    });
  }

  // SC-EDIT-04/05/06/07/08 — Mode édition panier collectif
  // Quand state.editSharedCart est actif, masquer les CTAs classiques
  // et afficher uniquement "Mettre à jour le panier collectif" + "Annuler".
  const editCtx = state.editSharedCart;

  // Gérer la visibilité des CTAs classiques
  const scCheckout = sc.querySelector('#k-sc-checkout');
  const scShare    = sc.querySelector('#k-sc-share');
  const scSharedBadge = sc.querySelector('#k-sc-shared-badge');
  if (scCheckout)   scCheckout.style.display   = editCtx ? 'none' : '';
  if (scShare)      scShare.style.display       = editCtx ? 'none' : '';
  if (scSharedBadge && editCtx) scSharedBadge.hidden = true;

  // Injecter ou mettre à jour le bandeau d'édition
  let editBar = sc.querySelector('#k-sc-edit-bar');
  if (editCtx) {
    if (!editBar) {
      editBar = document.createElement('div');
      editBar.id = 'k-sc-edit-bar';
      // Lot 2 — styles inline supprimés ; owner : cart.css § k-sc-edit-bar
      editBar.innerHTML = `
        <div class="k-sc-edit-header">
          <span>✏️</span>
          <span>Mode édition — Panier collectif</span>
        </div>
        <button id="k-sc-edit-update" type="button">
          ✅ Mettre à jour le panier collectif
        </button>
        <button id="k-sc-edit-cancel" type="button">
          ✕ Annuler les modifications
        </button>
        <p id="k-sc-edit-err"></p>`;

      // Insérer après le bloc total/sous-total, avant items
      const scHeader = sc.querySelector('.k-sc-header');
      if (scHeader) scHeader.appendChild(editBar);
      else sc.prepend(editBar);
    }

    // SC-EDIT-06 — Câbler "Mettre à jour le panier collectif"
    const updateBtn = editBar.querySelector('#k-sc-edit-update');
    if (updateBtn && !updateBtn._wired) {
      updateBtn._wired = true;
      updateBtn.addEventListener('click', async () => {
        const ctx = state.editSharedCart;
        if (!ctx) return;
        const errEl = editBar.querySelector('#k-sc-edit-err');
        if (errEl) errEl.textContent = '';

        const cartItems = (state.cart || [])
          .map(it => ({ product_id: it.product?.id || it.id, quantity: Number(it.qty) || 1 }))
          .filter(it => it.product_id);

        if (!cartItems.length) {
          if (errEl) errEl.textContent = 'Le panier est vide. Ajoutez au moins un article.';
          return;
        }

        updateBtn.disabled = true;
        updateBtn.textContent = '⏳ Mise à jour en cours…';

        try {
          // SC-EDIT-06 — Appel PUT /api/shared-carts/:id/items
          await fetch(`/api/shared-carts/${ctx.shared_cart_id}/items`, {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cart_items: cartItems }),
          }).then(async r => {
            if (!r.ok) {
              const d = await r.json().catch(() => ({}));
              throw new Error(d?.error || d?.message || `Erreur ${r.status}`);
            }
            return r.json();
          });

          // SC-EDIT-07 — Succès : vider panier boutique, supprimer contexte, retour onglet Groupe.
          // Le snapshot est maintenant sauvegardé en DB — le panier boutique redevient
          // disponible pour des achats normaux (même logique que N4-CLEAR à la création).
          state.editSharedCart = null;
          clearCart(); // vide state.cart + localStorage + re-render

          showToast('✅ Panier collectif mis à jour. Les participants ont été notifiés.', 'success');

          // Retour onglet Groupe + refresh de la vue groupe
          import('./b-nav.js').then(({ switchView }) => {
            document.querySelectorAll('.k-bnav-item, .k-header-nav-btn')
              .forEach(i => i.classList.toggle('active', i.dataset.tab === 'group'));
            switchView('group');
            import('./group/group-render-list.js').then(({ renderGroupView }) => renderGroupView());
          });
        } catch (err) {
          if (errEl) errEl.textContent = err?.message || 'Impossible de mettre à jour.';
          updateBtn.disabled = false;
          updateBtn.textContent = '✅ Mettre à jour le panier collectif';
        }
      });
    }

    // SC-EDIT-08 — Câbler "Annuler les modifications"
    const cancelBtn = editBar.querySelector('#k-sc-edit-cancel');
    if (cancelBtn && !cancelBtn._wired) {
      cancelBtn._wired = true;
      cancelBtn.addEventListener('click', () => {
        if (!confirm('Annuler les modifications ? Vous revenez dans l\'onglet Groupe sans sauvegarder.')) return;
        // SC-EDIT-08 — Supprimer le contexte d'édition — le panier boutique est laissé intact.
        state.editSharedCart = null;
        showToast('Modifications annulées.', 'success');
        // Retour onglet Groupe sans PUT
        import('./b-nav.js').then(({ switchView }) => {
          document.querySelectorAll('.k-bnav-item, .k-header-nav-btn')
            .forEach(i => i.classList.toggle('active', i.dataset.tab === 'group'));
          switchView('group');
          import('./group/group-render-list.js').then(({ renderGroupView }) => renderGroupView());
        });
      });
    }
  } else {
    // Plus de contexte edit : retirer le bandeau s'il existait
    editBar?.remove();
  }

  // Bouton "Commander"
  const ctaCheckout = sc.querySelector('#k-sc-checkout');
  if (ctaCheckout && !ctaCheckout._wired) {
    ctaCheckout._wired = true;
    ctaCheckout.addEventListener('click', () => {
      // ARCH-1 : remplace l'appel window.__kmrcCheckout → bus.emit.
      // boutique.js écoute 'checkout:open' et appelle checkoutCart().
      bus.emit('checkout:open');
    });
  }

  // Bouton "Partager" side-cart desktop — géré par b-share-cart.js (installé au boot)

  // Bouton "Vider" — purge complète du panier, avec confirmation native.
  // Réutilise clearCart() (mutation centralisée) — pas de duplication de
  // logique métier. La visibilité du bouton est gérée par CSS via
  // .k-side-cart.has-items (cf. boutique-desktop.css).
  const ctaClear = sc.querySelector('#k-sc-clear');
  if (ctaClear && !ctaClear._wired) {
    ctaClear._wired = true;
    ctaClear.addEventListener('click', () => {
      if (state.cart.length === 0) return;
      const ok = window.confirm('Vider le panier ? Cette action ne peut pas être annulée.');
      if (!ok) return;
      clearCart();
      showToast('🗑 Panier vidé');
    });
  }
}

// ARCH-1 : remplace window.__kmrcSideCart par un listener bus.
// Appelé par updateCartBadge (b-cart-core.js) et les surfaces qui
// ont besoin de forcer un re-rendu du side-cart desktop.
bus.on('side-cart:render', renderSideCart);

/* ── MUTATIONS CENTRALISÉES ─────────────────────────────────
 * Toute écriture sur state.cart doit passer par ces fonctions
 * pour garantir la cohérence saveCart() + rendu + badge.
 * ──────────────────────────────────────────────────────────── */

/**
 * Vide complètement le panier.
 * Remplace les patterns state.cart = []; saveCart(); renderCart();
 */
export function clearCart() {
  state.cart = [];
  saveCart();
  renderCartBody();
}

/**
 * Retire du panier les produits dont l'ID n'est plus dans validIdSet.
 * Appelé après le chargement du catalogue pour nettoyer les items obsolètes.
 * @param {Set<string>} validIdSet - Set des IDs produits valides (strings)
 */
export function pruneObsoleteCart(validIdSet) {
  const before = state.cart.length;
  state.cart = state.cart.filter(i => validIdSet.has(String(i.product.id)));
  if (state.cart.length !== before) saveCart();
}

export {
  addToCart, quickAdd, quickRemove, toggleFav, setQty,
  openCart, closeCart, openCartWithHighlight,
  renderCartBody,
  removeFromCart, markAllCartButtons,
  shareCartWhatsApp, showShareChoiceModal, loadSharedCart,
};
// Alias pour boutique.js qui importe 'renderCart'
export { renderCartBody as renderCart };

