/**
 * @komerce-arch
 * @role          boutique-cart-and-side-cart
 * @domain        boutique
 * @layer         ui-component
 * @criticality   critical
 * @inputs        cart_state, shared_cart_context, product_actions, viewport
 * @outputs       cart_drawer, side_cart, quantity_changes, shared_cart_item_updates
 * @depends       b-bus.js, b-store.js, b-cart-core.js, b-catalog.js, b-scroll-owner.js, shop-schema.js, group/group-side-cart.js, routes/shared-cart.js
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
 * §10 : tiroir panier et chargement des liens de partage simples
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
  productImageFallbackAttr, PRODUCT_IMAGE_FALLBACK_URL,
}                         from './b-utils.js';
import {
  showToast, saveCart, cartQty, cartTotal, saveFavs,
}                         from './b-cart-core.js';
import { isDesktop, getScrollY, scrollToPosition } from './b-scroll-owner.js';
import { getCategoryIcon, normalizeCategoryKey } from './shop-schema.js';
import { renderAddControl } from './render/render-product-card.js';
import { getProductCartSummary, getCartItemProductId } from './cart-product-summary.js';
import { isSharedListSurfaceActive, hasOpenSharedListInSlot, renderSharedListInCart, exitSharedListRenderMode, setCartSurface, reopenSharedListCart } from './group/group-side-cart.js';

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
        // FLY-CART-GEOMETRY — ne jamais écrire transform sur le bouton
        // cible. #k-modal-cart-btn est centré par translate(-50%, -50%) :
        // un scale() inline écraserait ce transform CSS et déplacerait
        // durablement le panier après un ajout. Le feedback d'impact reste
        // porté par la particule + le bump du badge.
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

  let cartLine = existing;
  if (cartLine) {
    cartLine.qty += qty;
    if (!cartLine.product) cartLine.product = product;
    if (!cartLine.id) cartLine.id = product.id;
    if (!cartLine.name) cartLine.name = product.name;
    if (cartLine.price == null) cartLine.price = product.price_kmf ?? product.price ?? 0;
    if (!cartLine.image) cartLine.image = product.image_url || product.image || '';
  } else {
    cartLine = {
      product: product,
      id: product.id,
      name: product.name,
      price: product.price_kmf ?? product.price ?? 0,
      image: product.image_url || product.image || '',
      qty: qty,
      variant_combo: combo,
      variant_label: comboLabel,
      requested_transport_rail: requestedTransportRail,
    };
    state.cart.push(cartLine);
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
    // La cible est capturée maintenant : les timers ne doivent jamais
    // relire dom.cartBtn, qui peut changer avant leur exécution.
    feedbackTarget.classList.remove('ring-pulse');
    void feedbackTarget.offsetWidth;
    feedbackTarget.classList.add('ring-pulse');
    setTimeout(() => feedbackTarget.classList.remove('ring-pulse'), 1500);

    feedbackTarget.classList.remove('avatar-wave');
    void feedbackTarget.offsetWidth;
    feedbackTarget.classList.add('avatar-wave');
    setTimeout(() => feedbackTarget.classList.remove('avatar-wave'), 900);
  } else if (feedbackTarget === dom.modalCartBtn) {
    // Même invariant pour la modale : la référence DOM peut être restaurée
    // ou remplacée avant la fin des animations.
    feedbackTarget.classList.remove('ring-pulse', 'cart-icon-pulse');
    void feedbackTarget.offsetWidth;
    feedbackTarget.classList.add('ring-pulse', 'cart-icon-pulse');
    setTimeout(() => feedbackTarget.classList.remove('ring-pulse'), 1500);
    setTimeout(() => feedbackTarget.classList.remove('cart-icon-pulse'), 350);
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
  return cartLine;
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
      btnEl.setAttribute('aria-pressed', 'false');
      btnEl.setAttribute('aria-label', 'Ajouter aux favoris');
      showToast('Retiré des favoris');
    } else {
      state.favs.push(id);
      btnEl.classList.add('liked');
      btnEl.innerHTML = '❤️';
      btnEl.setAttribute('aria-pressed', 'true');
      btnEl.setAttribute('aria-label', 'Retirer des favoris');
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
    // Doctrine finale (2026-08) — « liste active = LE panier » : cliquer
    // sur le panier/avatar pendant qu'une liste est active doit toujours
    // remontrer LA LISTE, jamais réactiver le panier personnel comme
    // surface concurrente (invariant §5 du mandat). reopenSharedListCart()
    // gère déjà le rendu + la réouverture du drawer mobile ; sur desktop
    // le side cart persistant suffit, d'où le même scroll-to-top que
    // pour le panier personnel.
    if (isSharedListSurfaceActive()) {
      reopenSharedListCart();
      if (isDesktop()) window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setCartSurface('personal');
    renderCartBody();
    dom.cartHeaderTitle.textContent = 'Mon Panier (' + cartQty() + ')';
    if (isDesktop()) {
      // Correctif UX — l'avatar (petite dame) doit montrer le résumé des
      // articles AVANT le checkout, pas sauter directement au formulaire
      // de paiement. Sur desktop le side-cart est un panneau persistant à
      // droite : on scroll simplement vers le haut pour qu'il soit visible
      // (l'utilisateur voit ses articles, peut modifier les quantités,
      // puis clique "Commander" quand il est prêt). L'ancien comportement
      // (bus.emit('checkout:open') directement) privait l'utilisateur de
      // toute visibilité sur ce qu'il s'apprêtait à payer.
      window.scrollTo({ top: 0, behavior: 'smooth' });
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
    // Même invariant que openCart() ci-dessus : une liste active reste la
    // surface visible même quand un ajout ambigu au panier personnel
    // déclenche normalement ce highlight.
    if (isSharedListSurfaceActive()) {
      reopenSharedListCart();
      if (isDesktop()) window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setCartSurface('personal');
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

  /* ── Lot A (refactor soustractif shared-cart) — renderer canonique du
   * contexte snapshot ────────────────────────────────────────────────
   * b-cart.js devient l'unique propriétaire des lignes, du side cart et
   * du drawer, y compris pour un snapshot de liste partagée. Le
   * contrôleur (group/group-side-cart.js) ne construit plus aucun HTML :
   * il fournit un contexte + les items + des callbacks d'action, et
   * appelle renderCartSnapshot() ci-dessous. Réutilise les mêmes classes
   * .k-cart-item-img/-info/-name que le panier personnel.
   *
   * Lot D (correction — audit de clôture) : la version précédente avait
   * bien renommé les deux identifiants littéralement interdits
   * (#k-shared-list-panel → #k-cart-snapshot-panel,
   * .k-shared-list-item → .k-cart-snapshot-item) mais laissait intact,
   * derrière ce nouveau nom, un panneau complet — en-tête/titre/badge de
   * statut, barre de progression, footer avec CTA d'achat dédié — qui
   * MASQUAIT le footer canonique (dom.cartFooter) au lieu de le piloter.
   * C'est exactement le « footer/progression propres » que les invariants
   * de clôture interdisent (pas seulement les deux sélecteurs nommés).
   * Correction : plus aucun conteneur propre. Les lignes s'écrivent
   * directement dans les conteneurs canoniques (#k-sc-items, #k-cart-body)
   * et le statut/la progression/les actions pilotent le chrome canonique
   * existant (#k-cart-header, dom.cartFooter, .k-sc-title-bar,
   * .k-sc-header) — voir applySnapshotDrawerFooter/applySnapshotSideCartChrome
   * ci-dessous. Les seuls éléments ajoutés sont quelques boutons/un badge
   * de statut insérés DANS ces conteneurs déjà existants, jamais un
   * conteneur qui les remplace ou les cache.
   *
   * @typedef {Object} SnapshotRenderContext
   * @property {'shared-snapshot'} source
   * @property {boolean} readOnly
   * @property {string} title
   * @property {string|null} subtitle
   * @property {string|null} status
   * @property {string|null} organizerName
   * @property {boolean} isOrganizer
   * @property {string} headerTitle
   * @property {number} availableCount - total de lignes non réclamées (distingue "Tout est acheté" de 0 disponible)
   * @property {number} availableTotal - valeur informative des lignes disponibles (jamais une somme due) — sert uniquement à la ligne "Reste disponible", jamais au bouton d'action
   * @property {Set<string>} selectedIds - sélection locale/éphémère (mandat cohérence post-LOT 13, §3) : ids des lignes disponibles cochées par l'utilisateur pour son prochain achat. Jamais persisté, jamais une mutation du snapshot.
   * @property {boolean} showSaveAction
   * @property {boolean} saved
   */

  const SNAPSHOT_ITEM_IMG_WIDTH = 100; // aligné sur optimizeImgUrl(p.image_url, 100) pour .k-cart-item-img
  const SNAPSHOT_ITEM_IMG_FALLBACK = '<span class="k-cart-item-img-fallback" aria-hidden="true">📦</span>';

  function isRenderableSnapshotImageUrl(raw) {
    if (typeof raw !== 'string') return false;
    const trimmed = raw.trim();
    if (!trimmed) return false;
    // Mandat §12 — une URL relative /uploads/... (média uploadé côté
    // serveur, explicitement demandée par le mandat) est renderable : elle
    // n'a jamais de schéma explicite, donc rejetée à tort par le garde
    // absolu ci-dessous avant ce correctif, déclenchant un fallback sur
    // des images pourtant valides. Acceptée UNIQUEMENT sous ce préfixe
    // précis (racine du dossier d'upload connu), jamais un chemin relatif
    // arbitraire (qui resterait sujet au même risque que le bug de données
    // "ges.unsplash.com/photo-cassee" documenté ci-dessous — une chaîne
    // sans schéma acceptée sans discrimination).
    if (trimmed.startsWith('/uploads/')) return true;
    try {
      // Mandat §9 — jamais de résolution avec base : une chaîne sans schéma
      // explicite (ex. "ges.unsplash.com/photo-cassee", bug de données
      // confirmé en production) serait sinon acceptée comme chemin relatif
      // à window.location.origin et produirait quand même un <img> cassé.
      // Seule une URL absolue http(s) est renderable.
      const resolved = new URL(trimmed);
      return resolved.protocol === 'http:' || resolved.protocol === 'https:';
    } catch (_) {
      return false;
    }
  }

  function snapshotItemImageParts(item) {
    const rawUrl = typeof item.image === 'string' ? item.image.trim() : '';
    if (!isRenderableSnapshotImageUrl(rawUrl)) {
      return { html: SNAPSHOT_ITEM_IMG_FALLBACK, wrapClass: ' is-img-error' };
    }
    const optimized = optimizeImgUrl(rawUrl, SNAPSHOT_ITEM_IMG_WIDTH);
    // onload : check dimensions — image d'erreur Cloudinary (200 OK) détectée
    // si naturalWidth < 16px. onerror : 404 / réseau. Les deux cas : retire l'img
    // et pose is-img-error sur le parent → CSS révèle le 📦 de repli.
    const removeFlag = `this.closest('.k-cart-item-img')?.classList.add('is-img-error');this.remove();`;
    const html = (
      `<img class="k-cart-item-img-el" src="${sanitize(optimized)}" alt="" loading="lazy" ` +
      `onload="if(this.naturalWidth<16||this.naturalHeight<16){${removeFlag}}" ` +
      `onerror="${removeFlag}">` +
      SNAPSHOT_ITEM_IMG_FALLBACK
    );
    return { html, wrapClass: '' };
  }

  function snapshotStatusLabel(status) {
    // L'état est explicite dans les deux surfaces : après un rechargement,
    // l'utilisateur distingue immédiatement une liste encore ouverte d'un
    // panier personnel ou d'une liste clôturée.
    return { open: 'Ouverte', closed: 'Clôturée', cancelled: 'Annulée' }[status] ?? '';
  }

  /**
   * GAP-07 §11 — formate variant_combo ({couleur:'Noir', taille:'M'}) en
   * "Noir · Taille M" pour l'affichage sous le nom du produit. Purement
   * cosmétique (capitalise chaque valeur) — la valeur elle-même vient
   * intégralement du snapshot serveur (variant_combo_snapshot), jamais
   * reconstruite depuis une heuristique locale.
   */
  function snapshotVariantComboText(variantCombo) {
    if (!variantCombo || typeof variantCombo !== 'object') return null;
    const parts = Object.values(variantCombo)
      .filter((v) => typeof v === 'string' && v.trim().length > 0)
      .map((v) => v.trim());
    return parts.length ? parts.join(' · ') : null;
  }

  function snapshotItemRowHtml(item, context) {
    const claimed = !!item.claimed;
    const classes = ['k-cart-snapshot-item', 'is-cart-snapshot'];
    if (claimed) classes.push('is-cart-item-claimed');

    const { html: img, wrapClass: imgWrapClass } = snapshotItemImageParts(item);

    // Temps réel (lot 2026-08) — buyer_first_name n'est jamais présent dans
    // le payload d'un participant (gating server-side exclusif, cf.
    // shared-cart-reads.js) : ce ternaire ne peut donc jamais fuiter
    // l'identité de l'acheteur à un participant, quel que soit un bug
    // frontend éventuel.
    const buyerFirstName = claimed && item.buyer_first_name
      ? sanitize(item.buyer_first_name)
      : null;
    // Correctif revue mock (2026-08) — "Disponible" était redondant : la
    // case à cocher (rendue juste à droite pour toute ligne non claimed,
    // cf. `control` plus bas) porte déjà cette information. Seul l'état
    // claimed reste affiché ici, car lui seul retire la case et a donc
    // besoin d'un texte pour communiquer le changement d'état.
    const statusText = claimed
      ? (buyerFirstName ? `Déjà acheté par ${buyerFirstName}` : 'Déjà acheté')
      : null;
    const statusHtml = statusText
      ? ` · <span class="k-cart-snapshot-item-status">${statusText}</span>`
      : '';
    const priceText = fmt(item.unit_price_kmf, 'KMF');
    const quantity = Number(item.quantity) || 1;
    const quantityText = quantity > 1 ? ` · ×${quantity}` : '';

    // Mandat cohérence post-LOT 13, §2/§3.a — chaque ligne affiche
    // exactement UN slot d'action à droite : soit le badge "Déjà acheté
    // [par X]" (claimed, jamais de case à cocher dessus), soit une case
    // à cocher de sélection (disponible, liste ouverte, non pré-cochée).
    // Le bouton "Acheter" individuel disparaît — la case alimente
    // exclusivement la sélection locale/éphémère consommée par la barre
    // "Commander (N)" (group-side-cart.js), jamais un achat immédiat au
    // clic et jamais une mutation du snapshot lui-même.
    const isSelected = !claimed && context.selectedIds?.has?.(String(item.id));
    const checkboxHtml = !context.readOnly
      ? `<button type="button" class="k-cart-item-select${isSelected ? ' is-checked' : ''}" data-item-id="${sanitize(String(item.id))}" role="checkbox" aria-checked="${isSelected ? 'true' : 'false'}" aria-label="Sélectionner ${sanitize(item.name || 'cet article')}"></button>`
      : '';
    const control = claimed
      ? `<span class="k-cart-snapshot-item-status-badge is-claimed">${buyerFirstName ? `Déjà acheté par ${buyerFirstName}` : 'Déjà acheté'}</span>`
      : checkboxHtml;

    const openLabel = `Voir la fiche produit — ${item.name || 'cet article'}`;
    // GAP-07 §11 — la variante s'affiche sous le nom, jamais fusionnée
    // avec une autre ligne du même produit (deux combinaisons distinctes
    // = deux .k-cart-snapshot-item séparées, chacune sa propre variante).
    const variantText = snapshotVariantComboText(item.variant_combo);
    const variantHtml = variantText
      ? `<div class="k-cart-snapshot-item-variant">${sanitize(variantText)}</div>`
      : '';
    return (
      `<div class="${classes.join(' ')}" data-item-id="${sanitize(String(item.id))}">` +
        `<button type="button" class="k-cart-snapshot-item-open" data-item-id="${sanitize(String(item.id))}" aria-label="${sanitize(openLabel)}">` +
          `<div class="k-cart-item-img${imgWrapClass}">${img}</div>` +
          `<div class="k-cart-item-info">` +
            `<div class="k-cart-item-name">${sanitize(item.name || '')}</div>` +
            variantHtml +
            `<div class="k-cart-snapshot-item-meta k-cart-item-context-note"><span class="k-cart-item-price">${priceText}</span>${quantityText}${statusHtml}</div>` +
          `</div>` +
        `</button>` +
        `<div class="k-cart-snapshot-item-controls">${control}</div>` +
      `</div>`
    );
  }

  /**
   * Wiring des lignes snapshot uniquement (retrait, quantité, ouverture
   * fiche produit) — aucun binding de chrome ici, contrairement à
   * l'ancienne wireSnapshotPanel(). Le chrome (statut, achat, actions
   * organisateur) est câblé séparément par applySnapshotDrawerFooter/
   * applySnapshotSideCartChrome sur les conteneurs canoniques.
   */
  function wireSnapshotItems(root, actions) {
    if (!root || !actions) return;
    root.querySelectorAll('.k-cart-snapshot-item-open').forEach((btn) => {
      btn.addEventListener('click', () => actions.onOpenProduct(btn.dataset.itemId));
    });
    // Mandat cohérence post-LOT 13, §3.a — case à cocher de sélection
    // locale, remplace l'ancien bouton "Acheter" individuel. Le clic ne
    // déclenche jamais d'achat ni de checkout par lui-même — seule la
    // barre "Commander (N)" (applySnapshotDrawerFooter/
    // applySnapshotSideCartChrome) déclenche checkoutSharedListSelection.
    root.querySelectorAll('.k-cart-item-select').forEach((btn) => {
      btn.addEventListener('click', () => actions.onToggleSelect(btn.dataset.itemId));
    });
  }

  function snapshotStatusText(context) {
    // Le titre canonique porte déjà toute la relation utile : « Ma liste »
    // pour l'organisateur, « Liste de Sam » pour le participant. Répéter le
    // prénom (ou une phrase de contexte) dans le même en-tête créait un
    // second niveau typographique et désalignait les deux surfaces.
    return snapshotStatusLabel(context.status);
  }

  /**
   * Mandat cohérence post-LOT 13, §3.b — sous-total de la sélection
   * locale courante (context.selectedIds), jamais un solde de liste.
   * Alimente exclusivement le texte du bouton "Commander (N · X KMF)".
   */
  function selectedSelectionSummary(items, context) {
    const selectedIds = context.selectedIds;
    if (!selectedIds || !selectedIds.size) return { count: 0, total: 0 };
    let count = 0;
    let total = 0;
    items.forEach((it) => {
      if (it.claimed) return;
      if (!selectedIds.has(String(it.id))) return;
      count += 1;
      // Correctif archéologie (mandat §6, F22-F) — le total doit refléter
      // unit_price_kmf * quantity, jamais seulement le prix unitaire :
      // un article à 8 000 KMF en quantité 2 doit produire 16 000 KMF.
      // availableTotal() (ligne "Reste disponible", non modifiée ici)
      // faisait déjà ce calcul correctement — l'écart était local à cette
      // fonction, utilisée par le CTA drawer mobile ET le side cart
      // desktop (un seul point de calcul, cf. archéologie du code HEAD).
      const unitPrice = Number(it.unit_price_kmf) || 0;
      const qty = Number(it.quantity) || 1;
      total += unitPrice * qty;
    });
    return { count, total };
  }

  /**
   * Insère (une fois) puis met à jour un petit badge de statut texte DANS
   * un conteneur canonique existant (jamais un bandeau propre). `id` doit
   * être unique par conteneur cible (drawer vs side cart desktop).
   */
  function applySnapshotStatusBadge(container, id, context, anchorSelector) {
    if (!container) return;
    const text = snapshotStatusText(context);
    let badge = container.querySelector('#' + id);
    if (!text) {
      badge?.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement('span');
      badge.id = id;
      badge.className = 'k-cart-snapshot-status';
      const anchor = anchorSelector ? container.querySelector(anchorSelector) : null;
      if (anchor) container.insertBefore(badge, anchor);
      else container.appendChild(badge);
    }
    badge.textContent = text;
  }

  /**
   * GAP-05 (Lot 2) — résumé "Contributeurs : Ali · 2 articles, Fatima ·
   * 1 article" dans le header canonique. Vide (donc invisible) si non
   * organisateur ou si aucune ligne réclamée : context.contributors est
   * déjà gaté côté backend (jamais peuplé pour un participant), ce test
   * frontend est une seconde barrière défensive, pas la source de vérité.
   */
  function contributorsSummaryText(context) {
    if (!context.isOrganizer) return '';
    const contributors = context.contributors;
    if (!Array.isArray(contributors) || !contributors.length) return '';
    const parts = contributors.map((c) => {
      const count = Number(c.items_count) || 0;
      return `${sanitize(c.first_name || 'Un participant')} · ${count} article${count > 1 ? 's' : ''}`;
    });
    return `Contributeurs : ${parts.join(', ')}`;
  }

  /**
   * Insère (une fois) puis met à jour la ligne de résumé contributeurs,
   * juste après le badge de statut existant dans le même conteneur
   * canonique. Retire l'élément quand le texte devient vide (jamais un
   * élément vide laissé dans le DOM).
   */
  function applySnapshotContributorsSummary(container, statusBadgeId, id, context) {
    if (!container) return;
    const text = contributorsSummaryText(context);
    let el = container.querySelector('#' + id);
    if (!text) {
      el?.remove();
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.className = 'k-cart-snapshot-contributors';
      const badge = container.querySelector('#' + statusBadgeId);
      if (badge) badge.insertAdjacentElement('afterend', el);
      else container.appendChild(el);
    }
    el.textContent = text;
  }

  function removeSnapshotButtons(container) {
    container?.querySelectorAll('[data-snapshot-button="1"]').forEach((el) => el.remove());
  }

  /**
   * LOT 13 (refonte drawers + checkout) — création jetable d'un élément
   * marqué data-snapshot-button="1", reconstruit à chaque appel de
   * applySnapshotDrawerFooter/applySnapshotSideCartChrome (removeSnapshotButtons
   * nettoie tout au début de chaque rendu, cf. ci-dessus). Remplace l'ancien
   * getOrCreateSnapshotButton() (réutilisation inter-rendu par id) — plus
   * simple à composer pour les deux rangées d'action (primaire / secondaire)
   * du footer refondu, sans changer le contrat de nettoyage existant.
   */
  function snapCreateEl(tag, className) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    el.dataset.snapshotButton = '1';
    return el;
  }

  // Boutons du panier personnel non applicables en mode snapshot (achat/
  // partage/vidage personnels) — masqués via .u-hidden (existant), jamais
  // retirés du DOM, restaurés au cleanup. #k-cart-continue (← Continuer)
  // reste inchangé : affordance générique de retour, valable aussi en
  // snapshot.
  const DRAWER_NATIVE_BTN_IDS_TO_HIDE = ['k-cart-checkout', 'k-cart-share', 'k-cart-clear'];
  const SIDECART_NATIVE_BTN_IDS_TO_HIDE = ['k-sc-checkout', 'k-sc-cta', 'k-sc-share', 'k-sc-clear'];

  /**
   * Pilote le chrome canonique du drawer/mobile (#k-cart-header,
   * dom.cartFooter) pour le contexte snapshot — ne construit plus de
   * footer propre. Le footer canonique reste visible ; seuls son contenu
   * texte et ses boutons d'action sont adaptés.
   */
  function applySnapshotDrawerFooter(context, items, actions) {
    const header = document.getElementById('k-cart-header');
    // Le drawer mobile porte déjà "Ma liste" / "Liste de …" : le badge
    // Ouverte/Clôturée ajoutait un libellé d'administration dans le parcours
    // client. Le side-cart desktop conserve son statut compact ; le drawer le
    // retire explicitement, y compris après un rendu précédent.
    header?.querySelector('#k-cart-snapshot-status')?.remove();
    applySnapshotContributorsSummary(header, 'k-cart-snapshot-status', 'k-cart-snapshot-contributors', context);

    if (!dom.cartFooter) return;
    dom.cartFooter.classList.remove('u-hidden');
    DRAWER_NATIVE_BTN_IDS_TO_HIDE.forEach((id) => document.getElementById(id)?.classList.add('u-hidden'));

    const claimedCount = items.filter((it) => it.claimed).length;
    const itemCountEl = document.getElementById('k-cart-item-count');
    const itemPluralEl = document.getElementById('k-cart-item-plural');
    const recapWordEl = document.getElementById('k-cart-recap-word');
    const subtotalEl = document.getElementById('k-cart-subtotal-val');
    if (itemCountEl) itemCountEl.textContent = `${claimedCount}/${items.length}`;
    if (recapWordEl) recapWordEl.textContent = 'article';
    if (itemPluralEl) itemPluralEl.textContent = ' achetés';
    if (subtotalEl) subtotalEl.textContent = `Reste : ${fmt(context.availableTotal, 'KMF')}`;
    if (dom.cartTotalConv) dom.cartTotalConv.textContent = '';

    // Barre de progression (mockup 2026-08) — % articles achetés
    const existingProg = dom.cartFooter.querySelector('.k-cart-snapshot-progress');
    if (existingProg) existingProg.remove();
    if (items.length > 0) {
      const prog = document.createElement('div');
      prog.className = 'k-cart-snapshot-progress';
      const fill = document.createElement('span');
      fill.style.width = Math.round((claimedCount / items.length) * 100) + '%';
      prog.appendChild(fill);
      dom.cartFooter.insertBefore(prog, dom.cartFooter.firstChild);
    }

    const btnRow = document.getElementById('k-cart-footer-btns');
    removeSnapshotButtons(btnRow);
    if (!btnRow) return;

    // LOT 13 §D — refonte : rangée primaire (Sauvegarder + Commander,
    // conditionnel §3.b), rangée secondaire discrète (Tout sélectionner /
    // Partager / Clôturer la liste). #k-cart-continue (natif, non retiré
    // par removeSnapshotButtons) est repositionné en dernier par CSS
    // (order) et restylé en lien discret — voir shared-list-side-cart.css.
    const primaryRow = snapCreateEl('div', 'k-snap-primary-row');
    if (context.showSaveAction) {
      const saveBtn = snapCreateEl('button', 'k-snap-btn-secondary');
      saveBtn.type = 'button';
      saveBtn.textContent = context.saved ? '✓ Sauvegardée' : 'Sauvegarder';
      saveBtn.disabled = !!context.saved;
      saveBtn.onclick = () => actions.onSave();
      primaryRow.appendChild(saveBtn);
    }
    // Mandat cohérence post-LOT 13, §3.b — "Acheter le reste" (achat
    // immédiat sans contrôle) disparaît. "Payer · X KMF"
    // n'apparaît que si la sélection locale n'est pas vide ; c'est
    // désormais l'unique déclencheur d'achat, quel que soit N. Aucun
    // montant de "reste de liste" dans le texte du bouton : uniquement
    // le sous-total de la sélection courante.
    const selection = selectedSelectionSummary(items, context);
    if (!context.readOnly && selection.count > 0) {
      const commandBtn = snapCreateEl('button', 'k-snap-btn-primary');
      commandBtn.type = 'button';
      commandBtn.textContent = `Payer · ${fmt(selection.total, 'KMF')}`;
      commandBtn.setAttribute('aria-label', `Payer ${fmt(selection.total, 'KMF')} pour ${selection.count} article${selection.count > 1 ? 's' : ''} sélectionné${selection.count > 1 ? 's' : ''}`);
      commandBtn.onclick = () => actions.onCommand();
      primaryRow.appendChild(commandBtn);
    }
    if (primaryRow.children.length) btnRow.appendChild(primaryRow);

    // Doctrine d'immutabilité (§1.B) — aucun stepper, aucun bouton de
    // retrait sur une liste publiée, pour personne. "Tout sélectionner"
    // (§3.b-bis) est un raccourci de sélection pure : il ne déclenche
    // aucun achat par lui-même, seulement "Commander" ci-dessus le fait.
    const secondaryRow = snapCreateEl('div', 'k-snap-secondary-row');
    if (!context.readOnly && context.availableCount > 0) {
      const selectAllBtn = snapCreateEl('button', 'k-snap-link');
      selectAllBtn.type = 'button';
      // Revue mock — bascule "Tout sélectionner" ↔ "Tout désélectionner"
      // selon context.allAvailableSelected (calculé par le contrôleur,
      // jamais recalculé ici) : le clic appelle toujours actions.onSelectAll(),
      // qui applique exactement la même condition côté contrôleur.
      selectAllBtn.textContent = context.allAvailableSelected ? 'Tout désélectionner' : 'Tout sélectionner';
      selectAllBtn.onclick = () => actions.onSelectAll();
      secondaryRow.appendChild(selectAllBtn);
    }
    if (context.isOrganizer) {
      const shareBtn = snapCreateEl('button', 'k-snap-link');
      shareBtn.type = 'button';
      shareBtn.textContent = 'Partager';
      shareBtn.onclick = () => actions.onShare();
      secondaryRow.appendChild(shareBtn);

      const closeBtn = snapCreateEl('button', 'k-snap-link');
      closeBtn.type = 'button';
      closeBtn.textContent = context.readOnly ? 'Liste clôturée' : 'Clôturer la liste';
      closeBtn.disabled = !!context.readOnly;
      closeBtn.onclick = () => actions.onClose();
      secondaryRow.appendChild(closeBtn);
    }
    if (secondaryRow.children.length) btnRow.appendChild(secondaryRow);
  }

  function cleanupSnapshotDrawerFooter() {
    document.getElementById('k-cart-header')?.querySelector('#k-cart-snapshot-status')?.remove();
    document.getElementById('k-cart-header')?.querySelector('#k-cart-snapshot-contributors')?.remove();
    DRAWER_NATIVE_BTN_IDS_TO_HIDE.forEach((id) => document.getElementById(id)?.classList.remove('u-hidden'));
    removeSnapshotButtons(document.getElementById('k-cart-footer-btns'));
  }

  /**
   * Pilote le chrome canonique du side cart desktop (.k-sc-title-bar,
   * .k-sc-header) — même principe que la version drawer ci-dessus.
   */
  function applySnapshotSideCartChrome(context, items, actions) {
    const sc = document.getElementById('k-side-cart');
    if (!sc) return;
    sc.setAttribute('data-mode', 'shared-list');
    sc.classList.add('has-items');

    const titleBar = sc.querySelector('.k-sc-title-bar');
    const titleLabel = sc.querySelector('.k-sc-title-label');
    if (titleLabel) titleLabel.textContent = context.title || 'Liste partagée';
    applySnapshotStatusBadge(titleBar, 'k-sc-snapshot-status', context, null);
    applySnapshotContributorsSummary(titleBar, 'k-sc-snapshot-status', 'k-sc-snapshot-contributors', context);

    SIDECART_NATIVE_BTN_IDS_TO_HIDE.forEach((id) => sc.querySelector('#' + id)?.classList.add('u-hidden'));

    const totalEl = sc.querySelector('#k-sc-total');
    if (totalEl) totalEl.textContent = fmt(context.availableTotal, 'KMF');
    // Doctrine (mise à jour) — "Sous-total" implique un solde à régler ;
    // en mode liste ce montant est uniquement informatif. Restauré à
    // "Sous-total" par cleanupSnapshotSideCartChrome() pour ne jamais
    // contaminer le panier personnel.
    const subtotalWordEl = sc.querySelector('#k-sc-subtotal-word');
    if (subtotalWordEl) subtotalWordEl.textContent = 'Reste disponible';

    const scHeader = sc.querySelector('.k-sc-header');
    removeSnapshotButtons(scHeader);
    if (!scHeader) return;

    // La surface desktop visible porte elle-même le contexte et la
    // progression de la liste. Ces informations ne doivent pas vivre
    // uniquement dans le footer du drawer mobile masqué.
    const claimedCount = items.filter((it) => it.claimed).length;
    const progressSummary = snapCreateEl('div', 'k-sc-snapshot-progress-summary');
    const progressCopy = document.createElement('div');
    progressCopy.className = 'k-sc-snapshot-progress-copy';
    const organizerCopy = context.organizerName
      ? ` · Organisée par ${sanitize(context.organizerName)}`
      : '';
    progressCopy.textContent = `${claimedCount}/${items.length} achetés${organizerCopy}`;
    progressSummary.appendChild(progressCopy);
    if (items.length > 0) {
      const progress = document.createElement('div');
      progress.className = 'k-cart-snapshot-progress';
      const fill = document.createElement('span');
      fill.style.width = Math.round((claimedCount / items.length) * 100) + '%';
      progress.appendChild(fill);
      progressSummary.appendChild(progress);
    }
    scHeader.insertBefore(progressSummary, scHeader.firstChild);

    // Mandat cohérence post-LOT 13, §3.b — "Acheter le reste" (achat
    // immédiat sans contrôle, en dégradé vert plein-largeur) disparaît.
    // "Payer · X KMF" prend sa place, mais n'apparaît que si la
    // sélection locale n'est pas vide — jamais un CTA permanent.
    const selection = selectedSelectionSummary(items, context);
    if (!context.readOnly && selection.count > 0) {
      const commandBtn = snapCreateEl('button', 'k-snap-btn-primary');
      commandBtn.type = 'button';
      commandBtn.textContent = `Payer · ${fmt(selection.total, 'KMF')}`;
      commandBtn.setAttribute('aria-label', `Payer ${fmt(selection.total, 'KMF')} pour ${selection.count} article${selection.count > 1 ? 's' : ''} sélectionné${selection.count > 1 ? 's' : ''}`);
      commandBtn.onclick = () => actions.onCommand();
      scHeader.appendChild(commandBtn);
    }

    const secondaryRow = snapCreateEl('div', 'k-snap-secondary-row');
    if (context.showSaveAction) {
      const saveBtn = snapCreateEl('button', 'k-snap-link');
      saveBtn.type = 'button';
      saveBtn.textContent = context.saved ? '✓ Sauvegardée' : 'Sauvegarder';
      saveBtn.disabled = !!context.saved;
      saveBtn.onclick = () => actions.onSave();
      secondaryRow.appendChild(saveBtn);
    }
    // Doctrine d'immutabilité (§1.B) — aucun stepper, aucun bouton de
    // retrait sur une liste publiée, pour personne. "Tout sélectionner"
    // (§3.b-bis) reste un raccourci de sélection pure, jamais un
    // deuxième chemin d'achat.
    if (!context.readOnly && context.availableCount > 0) {
      const selectAllBtn = snapCreateEl('button', 'k-snap-link');
      selectAllBtn.type = 'button';
      // Revue mock — même bascule que le side cart desktop ci-dessus.
      selectAllBtn.textContent = context.allAvailableSelected ? 'Tout désélectionner' : 'Tout sélectionner';
      selectAllBtn.onclick = () => actions.onSelectAll();
      secondaryRow.appendChild(selectAllBtn);
    }
    if (context.isOrganizer) {
      const shareBtn = snapCreateEl('button', 'k-snap-link');
      shareBtn.type = 'button';
      shareBtn.textContent = 'Partager';
      shareBtn.onclick = () => actions.onShare();
      secondaryRow.appendChild(shareBtn);

      const closeBtn = snapCreateEl('button', 'k-snap-link');
      closeBtn.type = 'button';
      closeBtn.textContent = context.readOnly ? 'Liste clôturée' : 'Clôturer la liste';
      closeBtn.disabled = !!context.readOnly;
      closeBtn.onclick = () => actions.onClose();
      secondaryRow.appendChild(closeBtn);
    }
    if (secondaryRow.children.length) scHeader.appendChild(secondaryRow);
  }

  function cleanupSnapshotSideCartChrome() {
    const sc = document.getElementById('k-side-cart');
    if (!sc) return;
    sc.removeAttribute('data-mode');
    // Bug réel trouvé en test navigateur réel (§13, chrome résiduel) :
    // applySnapshotSideCartChrome() écrit .k-sc-title-label avec le titre
    // de la liste, mais rien ne le restaurait jamais au retour au panier
    // personnel — le header du side cart affichait encore le titre de la
    // liste ("Sync multi-client") alors que le contenu était déjà celui
    // du panier personnel (Vider, Commander, articles corrects). Aucun
    // pipeline panier personnel ne réécrit ce champ (contrairement au
    // drawer mobile, dom.cartHeaderTitle, remis par renderSideCart()) —
    // c'est ce nettoyage qui doit le faire.
    const titleLabel = sc.querySelector('.k-sc-title-label');
    if (titleLabel) titleLabel.textContent = 'Mon panier';
    // Doctrine (mise à jour) — même principe que .k-sc-title-label
    // ci-dessus : applySnapshotSideCartChrome() réécrit #k-sc-subtotal-word
    // en "Reste disponible" (montant informatif, jamais un solde), rien
    // dans le pipeline panier personnel ne le restaure — ce nettoyage le
    // fait, pour ne jamais faire fuiter le wording liste dans le panier
    // personnel suivant.
    const subtotalWordEl = sc.querySelector('#k-sc-subtotal-word');
    if (subtotalWordEl) subtotalWordEl.textContent = 'Sous-total';
    SIDECART_NATIVE_BTN_IDS_TO_HIDE.forEach((id) => sc.querySelector('#' + id)?.classList.remove('u-hidden'));
    sc.querySelector('.k-sc-title-bar')?.querySelector('#k-sc-snapshot-status')?.remove();
    sc.querySelector('.k-sc-title-bar')?.querySelector('#k-sc-snapshot-contributors')?.remove();
    removeSnapshotButtons(sc.querySelector('.k-sc-header'));
    // #k-sc-items n'est pas vidé ici : renderSideCart() le resynchronise
    // seul juste après (pipeline panier personnel), comme avant ce fix.
  }

  /**
   * Point d'entrée canonique appelé par le contrôleur de snapshot
   * (group-side-cart.js::renderSharedListInCart). Rend les lignes
   * directement dans les conteneurs canoniques (#k-sc-items desktop,
   * #k-cart-body drawer — plus de wrapper #k-cart-snapshot-panel) et
   * pilote le chrome canonique (header/footer) au lieu de le masquer.
   * @param {SnapshotRenderContext} context
   * @param {Array<object>} items - lignes shared_cart_items brutes
   * @param {object} actions - callbacks fournis par le contrôleur (onRemove, onQuantityStep, onOpenProduct, onShare, onClose, onToggleSelect, onSelectAll, onCommand, onSave)
   */
function snapshotRecentlyViewedProducts() {
  const history = Array.isArray(state.viewedHistory) ? state.viewedHistory : [];
  const products = Array.isArray(state.products) ? state.products : [];
  const seen = new Set();
  const result = [];

  [...history].reverse().forEach((id) => {
    if (result.length >= 6) return;
    const key = String(id);
    if (seen.has(key)) return;

    const product = products.find((p) => String(p.id) === key);
    if (!product) return;

    seen.add(key);
    result.push(product);
  });

  return result;
}

function renderSnapshotRecentlyViewed(root, actions) {
  if (!root || typeof actions?.onOpenRecent !== 'function') return;

  root.querySelector('.k-shared-recent')?.remove();

  const products = snapshotRecentlyViewedProducts();
  if (!products.length) return;

  const section = document.createElement('section');
  section.className = 'k-shared-recent';
  section.setAttribute('aria-label', 'Consultés récemment');

  const title = document.createElement('div');
  title.className = 'k-shared-recent-title';
  title.textContent = 'Consultés récemment';

  const track = document.createElement('div');
  track.className = 'k-shared-recent-track';

  products.forEach((product) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'k-shared-recent-card';
    card.dataset.productId = String(product.id);
    card.setAttribute('aria-label', 'Voir ' + (product.name || 'ce produit'));

    const media = document.createElement('span');
    media.className = 'k-shared-recent-media';

    const imageUrl = product.image_url || product.image || '';
    if (imageUrl) {
      const img = document.createElement('img');
      img.src = optimizeImgUrl(imageUrl, 160);
      img.alt = '';
      img.loading = 'lazy';
      img.addEventListener('error', () => {
        img.remove();
        media.textContent = productEmoji(product);
      });
      media.appendChild(img);
    } else {
      media.textContent = productEmoji(product);
    }

    const name = document.createElement('span');
    name.className = 'k-shared-recent-name';
    name.textContent = product.name || 'Produit';

    const price = document.createElement('span');
    price.className = 'k-shared-recent-price';
    price.textContent = fmt(Number(product.price_kmf ?? product.price ?? 0) || 0, 'KMF');

    card.append(media, name, price);
    card.addEventListener('click', () => actions.onOpenRecent(product.id));
    track.appendChild(card);
  });

  section.append(title, track);
  root.appendChild(section);
}

export function renderCartSnapshot(context, items, actions) {
    document.body.classList.add('is-shared-list-context');
    // Le snapshot liste contourne renderSideCart() (qui synchronise cette
    // classe pour le panier personnel). La poser ici garantit le même contrat
    // de réserve desktop, y compris sans support CSS :has().
    document.body.classList.add('sc-reserve');
    const rowsHtml = items.map((it) => snapshotItemRowHtml(it, context)).join('');

    const sc = document.getElementById('k-side-cart');
    if (sc) {
      const itemsEl = sc.querySelector('#k-sc-items');
      if (itemsEl) {
        itemsEl.innerHTML = rowsHtml;
        wireSnapshotItems(itemsEl, actions);
        renderSnapshotRecentlyViewed(itemsEl, actions);
      }
      applySnapshotSideCartChrome(context, items, actions);
    }

    if (dom.cartDrawer) dom.cartDrawer.setAttribute('data-mode', 'shared-list');
    if (dom.cartBody) {
      dom.cartBody.innerHTML = rowsHtml;
      wireSnapshotItems(dom.cartBody, actions);
      renderSnapshotRecentlyViewed(dom.cartBody, actions);
    }
    applySnapshotDrawerFooter(context, items, actions);

    if (dom.cartHeaderTitle) dom.cartHeaderTitle.textContent = context.headerTitle;
  }

  /**
   * Nettoyage DOM commun au contexte snapshot — retire les traces
   * visuelles du mode liste des surfaces canoniques. Ne touche jamais
   * `.has-items` sur #k-side-cart (pipeline du panier personnel, se
   * resynchronise seul juste après via renderSideCart).
   */
export function cleanupCartSnapshotDom() {
    document.body.classList.remove('is-shared-list-context');
    cleanupSnapshotSideCartChrome();
    dom.cartDrawer?.removeAttribute('data-mode');
    cleanupSnapshotDrawerFooter();
    dom.cartFooter?.classList.remove('u-hidden');
  }

  /**
   * Re-rend le contenu du panneau panier (liste items + totaux + CTA).
   * @param {number|string} [highlightId] - ID produit à mettre en évidence (optionnel)
   */
  function renderCartBody(highlightId) {
    // PROMPT_FINAL_IMPLEMENTATION_LISTE_PARTAGEABLE_SIDE_CART — le side cart
    // canonique passe en mode shared-list quand un contexte de liste est
    // actif ; le panier personnel (state.cart) n'est jamais lu/écrit dans
    // cette branche (mandat §3, §5). Retour immédiat : le rendu normal
    // ci-dessous reste strictement celui du panier personnel hors contexte.
    if (isSharedListSurfaceActive()) {
      renderSharedListInCart();
      return;
    }
    exitSharedListRenderMode();

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

      // Image — fallback universel : onerror prévient l'icône cassée native.
      // L'alt est intentionnellement vide sur l'image pour éviter que le texte
      // alternatif n'agrandisse la boîte en cas d'échec (mandat §4).
      const imgBox = document.createElement('div');
      imgBox.className = 'k-cart-item-img';
      if (p.image_url) {
        const img = document.createElement('img');
        img.src = optimizeImgUrl(p.image_url, 128);
        img.alt = '';
        img.loading = 'lazy';
        // Fallback universel via b-utils — data URI inline, couvre les 404
        // ET les images d'erreur Cloudinary (détection par dimensions).
        const fbAttr = productImageFallbackAttr();
        // productImageFallbackAttr() retourne onload="..." onerror="..."
        img.setAttribute('onload',  fbAttr.match(/onload="([^"]+)"/)?.[1]  ?? '');
        img.setAttribute('onerror', fbAttr.match(/onerror="([^"]+)"/)?.[1] ?? '');
        // Même mécanisme que productImageFallbackAttr() : marqueur anti-boucle
        // kFallbackApplied pour ne pas rappeler onerror sur le placeholder lui-même.
        img.setAttribute('onerror',
          `if(this.dataset.kFallbackApplied!=='1'){` +
            `this.dataset.kFallbackApplied='1';` +
            `this.removeAttribute('srcset');` +
            `this.classList.add('is-image-fallback');` +
            `this.src='${PRODUCT_IMAGE_FALLBACK_URL}'` +
          `}`
        );
        imgBox.appendChild(img);
        // Pictogramme de repli : affiché uniquement si is-img-error est posé
        // (CSS : .k-cart-item-img.is-img-error .k-cart-item-img-fallback { display: inline-flex })
        // Jamais visible si l'image charge correctement.
        const fallback = document.createElement('span');
        fallback.className = 'k-cart-item-img-fallback';
        fallback.setAttribute('aria-hidden', 'true');
        fallback.textContent = productEmoji(p);
        imgBox.appendChild(fallback);
      } else {
        const fallback = document.createElement('span');
        fallback.className = 'k-cart-item-img-fallback k-cart-item-img-fallback--visible';
        fallback.setAttribute('aria-hidden', 'true');
        fallback.textContent = productEmoji(p);
        imgBox.appendChild(fallback);
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

      // Stepper compact — .k-qty-ctrl (classe CSS canonique dans cart.css).
      // Ancienne classe .k-qty-btn n'était jamais stylée (mismatch détecté
      // lors de l'audit mandat §2) : correction ici, CSS inchangé.
      const qtyRow = document.createElement('div');
      qtyRow.className = 'k-cart-item-qty';
      qtyRow.setAttribute('role', 'group');
      qtyRow.setAttribute('aria-label', 'Quantité');

      const minusBtn = document.createElement('button');
      minusBtn.type = 'button';
      minusBtn.className = 'k-qty-ctrl';
      minusBtn.textContent = '−';
      minusBtn.setAttribute('aria-label', 'Retirer un');
      minusBtn.addEventListener('click', () => setQty(p.id, item.qty - 1, item));
      qtyRow.appendChild(minusBtn);

      const qtyVal = document.createElement('span');
      qtyVal.className = 'k-qty-ctrl-val';
      qtyVal.textContent = item.qty;
      qtyRow.appendChild(qtyVal);

      const plusBtn = document.createElement('button');
      plusBtn.type = 'button';
      plusBtn.className = 'k-qty-ctrl';
      plusBtn.textContent = '+';
      plusBtn.setAttribute('aria-label', 'Ajouter un');
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

      // Bouton retrait discret — zone tactile 44 px minimum (mandat §2).
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'k-cart-item-remove';
      removeBtn.setAttribute('aria-label', 'Retirer ' + (p.name || 'cet article'));
      removeBtn.innerHTML =
        `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">` +
        `<line x1="1.5" y1="1.5" x2="8.5" y2="8.5"/><line x1="8.5" y1="1.5" x2="1.5" y2="8.5"/>` +
        `</svg>`;
      removeBtn.addEventListener('click', () => removeFromCart(p.id, item));
      row.appendChild(removeBtn);

      dom.cartBody.appendChild(row);
    });

    // Footer
    dom.cartFooter.classList.remove('u-hidden');

    // PR-1 : le bouton "📤 Partager" est statique dans index.html (#k-cart-share)
    // géré par b-share-cart.js — plus d'injection dynamique ici.

    const qty = cartQty();
    const total = cartTotal();

    // Récap détaillé : nombre d'articles + sous-total
    const itemCountEl = document.getElementById('k-cart-item-count');
    const itemPluralEl = document.getElementById('k-cart-item-plural');
    const subtotalEl = document.getElementById('k-cart-subtotal-val');
    if (itemCountEl) itemCountEl.textContent = qty;
    if (itemPluralEl) itemPluralEl.textContent = qty > 1 ? 's' : '';
    if (subtotalEl) subtotalEl.textContent = fmt(total, 'KMF');

    // Total — affiché une seule fois dans la ligne récap (mandat §3, suppression
    // du doublon .k-cart-total-row masquée par CSS). Le bouton Commander
    // porte également le montant pour visibilité immédiate.
    // aucun montant vert dans le panier personnel (mandat §3).
    dom.cartTotalVal.textContent = fmt(total, 'KMF');
    if (_currency === 'EUR') {
      dom.cartTotalConv.textContent = '≈ ' + fmt(total, 'EUR');
    } else {
      dom.cartTotalConv.textContent = '';
    }

    // Commander · 17 000 KMF — aucun emoji ✅ (mandat §3)
    const checkoutBtn = document.getElementById('k-cart-checkout');
    if (checkoutBtn) {
      checkoutBtn.textContent = 'Commander · ' + fmt(total, 'KMF');
    }
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
  // P0 (audit terrain — F22-6/F22-7) : renderSideCart() est câblée sur
  // 'side-cart:render' SANS garde. Cet événement est émis pour de multiples
  // raisons (mutation du panier personnel, mais aussi simple rafraîchissement
  // du badge/indicateur pendant qu'une liste partagée est la surface active
  // — cf. group-side-cart.js). Sans cette garde, chaque émission pendant
  // qu'une liste est active réécrivait #k-side-cart selon le panier
  // PERSONNEL (souvent vide dans ce contexte), vidant #k-sc-items et
  // retirant .has-items — cachant tout le panneau alors que la liste, elle,
  // a des données correctes en mémoire (badge "Déjà acheté", contributeurs,
  // etc., posés séparément par applySnapshotSideCartChrome). Reproduit en
  // conditions réelles : après l'achat d'une ligne de liste avec un panier
  // personnel vide, #k-side-cart disparaissait silencieusement.
  if (isSharedListSurfaceActive()) return;

  const sc       = document.getElementById('k-side-cart');
  const bnavLbl  = document.getElementById('k-bnav-cart-label');
  const items    = state.cart;
  const hasItems = items.length > 0;
  const isModalCart = sc?.classList.contains('k-side-cart--in-modal') === true;
  // P0-1 (mandat §3) — invariant : le SHELL (panneau + onglets) reste
  // visible tant qu'une liste OPEN occupe le slot partagé, même si le
  // panier personnel est vide. Ne pas confondre avec hasItems, qui ne
  // pilote plus que le contenu affiché (liste d'articles vs état vide).
  const sideCartVisible = hasItems || hasOpenSharedListInSlot();

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
  // P0-1 : le shell suit sideCartVisible (panier OU liste affichable),
  // pas hasItems seul — sinon une liste OPEN affichée devient inaccessible
  // dès que le panier personnel repasse à zéro (cf. publication).
  sc.classList.toggle('has-items', sideCartVisible);

  // Classe d'état partagée avec le layout desktop : elle réserve exactement
  // la largeur du side cart et sert de fallback aux navigateurs sans :has().
  document.body.classList.toggle('sc-reserve', sideCartVisible);

  if (!hasItems) {
    // Panier personnel vide : vider explicitement la liste DOM pour éviter
    // les items fantômes si renderSideCart() est rappelé plus tard avec un
    // panier de nouveau plein. Si le shell reste visible (liste OPEN dans
    // le slot), afficher un état vide explicite plutôt qu'un panneau vide.
    const itemsElEmpty = sc.querySelector('#k-sc-items');
    if (itemsElEmpty) {
      itemsElEmpty.innerHTML = (sideCartVisible || isModalCart)
        ? '<div class="k-sc-empty" role="status">' +
            '<span class="k-sc-empty-icon" aria-hidden="true">🛒</span>' +
            '<strong>Votre panier est vide</strong>' +
            '<span>Ajoutez ce produit pour le retrouver ici.</span>' +
          '</div>'
        : '';
    }
    const totalElEmpty = sc.querySelector('#k-sc-total');
    if (totalElEmpty) totalElEmpty.textContent = fmtPrice(0);
    const countInlineEmpty = sc.querySelector('#k-sc-count-inline');
    if (countInlineEmpty) countInlineEmpty.textContent = '0';
    const checkoutBtnEmpty = sc.querySelector('#k-sc-checkout');
    if (checkoutBtnEmpty) {
      checkoutBtnEmpty.textContent = 'Commander · ' + fmtPrice(0);
      checkoutBtnEmpty.disabled = true;
    }
    return;
  }

  const qty = cartQty();

  // Sous-total
  const totalEl = sc.querySelector('#k-sc-total');
  if (totalEl) totalEl.textContent = fmtPrice(cartTotal());

  // CTA Commander — libellé "Commander · montant" (doctrine 2026-08)
  // Le span #k-sc-count-inline est conservé dans le DOM pour compat,
  // mais le bouton complet est mis à jour avec le montant total.
  const checkoutBtn = sc.querySelector('#k-sc-checkout');
  if (checkoutBtn) {
    checkoutBtn.textContent = 'Commander · ' + fmtPrice(cartTotal());
    checkoutBtn.disabled = false;
  }

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

      const imgFallbackAttr = productImageFallbackAttr();
      el.innerHTML =
        `<img class="k-sc-item-img" src="${imgSrc}" alt="" loading="lazy" ${imgFallbackAttr}>` +
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
      // Doctrine finale — même invariant que openCart() : si une liste est
      // active, "Voir le panier" doit continuer à montrer LA LISTE, jamais
      // le panier personnel comme surface concurrente.
      if (isSharedListSurfaceActive()) {
        reopenSharedListCart();
        dom.cartOverlay.classList.add('open');
        dom.cartDrawer.classList.add('open');
        scroll.savedY = getScrollY();
        document.body.classList.add('cart-open');
        return;
      }
      // Desktop : ouvrir le tiroir complet (le side cart est déjà visible,
      // "Voir le panier" = accéder aux détails complets + WhatsApp + Commander)
      setCartSurface('personal');
      renderCartBody();
      dom.cartHeaderTitle.textContent = 'Mon Panier (' + cartQty() + ')';
      dom.cartOverlay.classList.add('open');
      dom.cartDrawer.classList.add('open');
      scroll.savedY = getScrollY();
      document.body.classList.add('cart-open');
    });
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
// Amendement V2 §A — le sélecteur desktop [Panier] [Liste]
// (group-side-cart.js::setCartSurface()) est atteignable uniquement sur
// desktop (isDesktop() dans renderCartSurfaceSwitch()), où seul le side
// cart (#k-side-cart) est visible : 'side-cart:render' ci-dessus suffit,
// sans dépendance statique vers b-cart.js (mandat §5).

// Lot D+ (correctif cycle d'import) — group-side-cart.js émettait
// auparavant un import direct de renderCartSnapshot/cleanupCartSnapshotDom,
// fermant un cycle A↔B avec b-cart.js (signalé par check-js-imports.js,
// point ouvert #2 du rapport de clôture Lot D). b-cart.js reste l'unique
// propriétaire du rendu (doctrine un_renderer_panier) ; il écoute
// simplement ces deux signaux au lieu d'être appelé en import direct —
// group-side-cart.js n'importe plus rien de ce fichier.
bus.on('cart-snapshot:render', ({ context, items, actions }) => renderCartSnapshot(context, items, actions));
bus.on('cart-snapshot:cleanup', () => cleanupCartSnapshotDom());
// P0 §2 (aiguillage explicite symétrique mobile/desktop) — émis par
// group-side-cart.js quand la surface repasse à 'personal' (tab "Mon
// panier", fermeture/annulation de liste). 'side-cart:render' seul ne
// couvre que renderSideCart() (#k-side-cart, desktop) ; ce signal dédié
// est le pendant mobile de 'cart-snapshot:render' côté liste, et rappelle
// le SEUL renderer de contenu personnel (renderCartBody, doctrine
// un_renderer_panier) pour que le drawer (#k-cart-body) ne garde jamais
// les lignes de la liste affichées après la bascule. renderCartBody()
// s'auto-garde déjà via isSharedListSurfaceActive() en tête de fonction,
// donc cet appel est sûr même en cas de course avec une réactivation
// rapide de la liste.
bus.on('cart-body:render-personal', () => renderCartBody());
//
// Lot D (correction — audit de clôture) : l'écoute du signal "corps rendu
// depuis bascule de surface" a été retirée ci-dessous. b-cart.js n'appelle
// jamais setCartSurface() sans enchaîner un appel direct à renderCartBody()
// dans la même fonction (openCart(), openCartWithHighlight(), CTA
// #k-sc-cta) — le relais par bus n'avait donc plus d'appelant réel une
// fois son unique point d'émission retiré de group-side-cart.js par Lot A.
// boutique:360 le signalait comme écouteur orphelin ; retrait symétrique
// côté group-library-remove.js.

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
  loadSharedCart,
};
// Alias pour boutique.js qui importe 'renderCart'
export { renderCartBody as renderCart };
