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
 * @version       2026-06
 */
'use strict';

/**
 * b-cart-core.js — Module ES · §3 TOAST & CART CORE
 * Extrait de boutique.js Sprint 2F
 * Dépendances : b-store.js (state, dom)
 *
 * Exports : showToast, cartQty, cartTotal, saveCart, updateCartBadge, isFav, saveFavs
 */

import { state, dom, CART_VERSION } from './b-store.js';
import { bus } from './b-bus.js';

// FIX vérité unique : CART_VERSION était redéfini ici en local (= 3) en plus
// de b-store.js (export = 3). Si on bumpait l'un sans l'autre :
// - _loadCart (b-store) lit avec une version
// - saveCart (ici) écrit avec une autre
// → écart silencieux : panier réécrit avec la mauvaise version, donc
// rejeté au prochain reload. Désormais une seule constante, exportée
// depuis b-store, importée partout.

// ──────────────────────────────────────────────
// TOAST
// ──────────────────────────────────────────────

/**
 * @brief showToast — Affiche un toast notification temporaire en bas d'écran
 * @param {string} msg   - Texte à afficher
 * @param {string} [type] - Classe CSS : 'error' | 'success'
 */
export function showToast(msg, type, duration) {
  type = type || '';
  dom.toast.innerHTML = '<div class="k-toast-simple">' + (msg || '') + '</div>';
  dom.toast.className = 'k-toast show' + (type ? ' ' + type : '');
  clearTimeout(dom.toast._t);
  dom.toast._t = setTimeout(() => dom.toast.classList.remove('show'), duration || 2800);
}

// ──────────────────────────────────────────────
// CART HELPERS
// ──────────────────────────────────────────────

/**
 * Retourne la quantité totale dans le panier.
 * @returns {number}
 */
export function cartQty() {
  return state.cart.reduce((s, i) => s + i.qty, 0);
}

/**
 * Calcule le total du panier (prix de ligne SKU si disponible, fallback produit).
 * @returns {number} Total en KMF
 */
export function cartTotal() {
  return state.cart.reduce((s, i) => {
    const unitPrice = i.price ?? i.product?.price_kmf ?? i.product?.price ?? 0;
    return s + Number(unitPrice || 0) * Number(i.qty || 0);
  }, 0);
}

/**
 * @brief saveCart — Persiste le panier dans localStorage (clé kmrc_cart)
 * Échoue silencieusement si localStorage indisponible (mode privé)
 */
export function saveCart() {
  try {
    localStorage.setItem('kmrc_cart', JSON.stringify(state.cart));
    localStorage.setItem('kmrc_cart_v', String(CART_VERSION));
  } catch(e) {}
  updateCartBadge();
}

/**
 * @brief updateCartBadge — Source de vérité unique pour tous les états panier
 * Synchronise : badge header, badge modal, badge bnav, avatar (seule/panier)
 * Règle : panier vide → avatar_seule.png ; plein → avatar_panier.png + animation
 */
export function updateCartBadge() {
  const count = cartQty();
  const hasItems = count > 0;
  const avatarSrc = hasItems ? '/images/avatar_panier.png' : '/images/avatar_seule.png';

  document.querySelectorAll('.k-cart-btn, #k-modal-cart-btn').forEach(btn => {
    btn.classList.toggle('has-items', hasItems);
    btn.classList.toggle('is-empty', !hasItems);
    const img = btn.querySelector('.k-cart-avatar');
    if (img) img.src = avatarSrc;
  });

  document.querySelectorAll('.k-cart-badge, .k-modal-cart-badge, #k-bnav-cart-badge').forEach(badge => {
    badge.textContent = hasItems ? String(count) : '';
    badge.classList.toggle('show', hasItems);
  });

  // Side cart + bnav total (implémenté dans b-cart.js via bus 'side-cart:render')
  bus.emit('side-cart:render');
  // ARCH-1 : pill + mini-cart écoutent directement bus.on('cart:update')
  bus.emit('cart:update');
}

// ──────────────────────────────────────────────
// FAVORIS
// ──────────────────────────────────────────────

/**
 * Vérifie si un produit est dans les favoris.
 * @param {number|string} id - ID produit
 * @returns {boolean}
 */
export function isFav(id) {
  const sid = String(id);
  return state.favs.some(f => String(f) === sid);
}

/**
 * Persiste les favoris dans localStorage.
 */
export function saveFavs() {
  localStorage.setItem('k_favs', JSON.stringify(state.favs));
}
