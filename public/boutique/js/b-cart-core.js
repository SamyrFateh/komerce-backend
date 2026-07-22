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
  return state.cart.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
}

/**
 * Total du panier fondé sur le snapshot de ligne.
 * `item.price` est la vérité transactionnelle capturée à l'ajout (notamment
 * pour une variante/SKU). Les anciens paniers sans snapshot continuent de
 * fonctionner grâce au fallback sur product.price_kmf.
 */
export function cartTotal() {
  return state.cart.reduce((sum, item) => {
    const unitPrice = item.price ?? item.product?.price_kmf ?? item.product?.price ?? 0;
    return sum + (Number(unitPrice) || 0) * (Number(item.qty) || 0);
  }, 0);
}

export function saveCart() {
  try {
    localStorage.setItem('kmrc_cart', JSON.stringify(state.cart));
    localStorage.setItem('kmrc_cart_v', String(CART_VERSION));
  } catch(e) {}
  updateCartBadge();
}

export function updateCartBadge() {
  const count = cartQty();
  const hasItems = count > 0;
  const avatarSrc = hasItems ? '/images/avatar_panier.png' : '/images/avatar_seule.png';

  document.querySelectorAll('.k-cart-btn, #k-modal-cart-btn, .k-modal-cart-overlay').forEach(btn => {
    btn.classList.toggle('has-items', hasItems);
    btn.classList.toggle('is-empty', !hasItems);
    const img = btn.querySelector('.k-cart-avatar');
    if (img) img.src = avatarSrc;
  });

  document.querySelectorAll('.k-cart-badge, .k-modal-cart-badge, #k-bnav-cart-badge').forEach(badge => {
    badge.textContent = hasItems ? String(count) : '';
    badge.classList.toggle('show', hasItems);
  });

  bus.emit('side-cart:render');
  bus.emit('cart:update');
}

export function isFav(id) {
  const sid = String(id);
  return state.favs.some(f => String(f) === sid);
}

export function saveFavs() {
  localStorage.setItem('k_favs', JSON.stringify(state.favs));
}
