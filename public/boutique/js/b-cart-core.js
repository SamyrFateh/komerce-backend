/**
 * @komerce-arch
 * @role          boutique-b-cart-core
 * @domain        boutique
 * @layer         ui-component
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       public/boutique/js/b-bus.js, public/boutique/js/b-store.js
 * @used-by       public/boutique/js/b-cart-pill.js, public/boutique/js/b-cart.js, public/boutique/js/b-catalog.js, public/boutique/js/b-checkout.js, public/boutique/js/b-favs.js, public/boutique/js/b-group-view.js, public/boutique/js/b-identity.js, public/boutique/js/b-mini-cart.js, public/boutique/js/b-modal-core.js, public/boutique/js/b-modal-desktop-enhancers.js, public/boutique/js/b-nav.js, public/boutique/js/b-paypal.js, public/boutique/js/b-share-cart.js, public/boutique/js/b-subcat.js, public/boutique/js/b-tracking.js, public/boutique/js/boutique.js, public/boutique/js/render/render-product-card.js
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  boutique
 * @version       2026-07
 */
'use strict';

import { state, dom, CART_VERSION } from './b-store.js';
import { bus } from './b-bus.js';

export function showToast(msg, type, duration) {
  type = type || '';
  dom.toast.innerHTML = '<div class="k-toast-simple">' + (msg || '') + '</div>';
  dom.toast.className = 'k-toast show' + (type ? ' ' + type : '');
  clearTimeout(dom.toast._t);
  dom.toast._t = setTimeout(() => dom.toast.classList.remove('show'), duration || 2800);
}

export function cartQty() {
  return state.cart.reduce((sum, item) => sum + item.qty, 0);
}

/**
 * Le prix de ligne persiste dans item.price au moment de l'ajout. Il prime sur
 * le produit catalogue afin qu'un SKU ayant un prix propre reste exact dans le
 * total, y compris après fermeture de la modale. Les anciens paniers restent
 * compatibles grâce aux fallbacks produit.
 */
export function cartTotal() {
  return state.cart.reduce((sum, item) => {
    const unitPrice = item.price
      ?? item.product?.price_kmf
      ?? item.product?.price
      ?? 0;
    return sum + Number(unitPrice || 0) * Number(item.qty || 0);
  }, 0);
}

export function saveCart() {
  try {
    localStorage.setItem('kmrc_cart', JSON.stringify(state.cart));
    localStorage.setItem('kmrc_cart_v', String(CART_VERSION));
  } catch (error) {
    // localStorage peut être indisponible (navigation privée/quota) : le panier
    // reste utilisable en mémoire pour la session courante.
  }
  updateCartBadge();
}

export function updateCartBadge() {
  const count = cartQty();
  const hasItems = count > 0;
  const avatarSrc = hasItems ? '/images/avatar_panier.png' : '/images/avatar_seule.png';

  document.querySelectorAll('.k-cart-btn, #k-modal-cart-btn, .k-modal-cart-overlay').forEach((button) => {
    button.classList.toggle('has-items', hasItems);
    button.classList.toggle('is-empty', !hasItems);
    const image = button.querySelector('.k-cart-avatar');
    if (image) image.src = avatarSrc;
  });

  document.querySelectorAll('.k-cart-badge, .k-modal-cart-badge, #k-bnav-cart-badge').forEach((badge) => {
    badge.textContent = hasItems ? String(count) : '';
    badge.classList.toggle('show', hasItems);
  });

  bus.emit('side-cart:render');
  bus.emit('cart:update');
}

export function isFav(id) {
  const sid = String(id);
  return state.favs.some((favorite) => String(favorite) === sid);
}

export function saveFavs() {
  localStorage.setItem('k_favs', JSON.stringify(state.favs));
}
