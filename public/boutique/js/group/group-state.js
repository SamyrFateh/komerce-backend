/**
 * @komerce-arch-lite
 * @role          shared-cart-group-state
 * @domain        shared-cart
 * @layer         ui-component
 * @owner         public/boutique/js/b-group-view.js
 * @purpose       supports public/boutique/js/b-group-view.js
 * @impact-areas  shared-cart
 * @version       2026-06
 */
'use strict';

/**
 * @module group/group-state.js
 * @owner group refactor — helpers sélection et synchronisation d'état
 *
 * Fonctions pures de filtrage/tri des paniers créateur (isVisibleOwnerCart,
 * sortOwnerCarts, pickOwnerCart) et mutation contrôlée du store global
 * (applyOwnerCartToState).
 *
 * Inclut refreshGroupBadge — synchronisation badge DOM depuis state.shareToken.
 * Re-exporté par b-group-view.js pour les consommateurs externes (b-share-cart.js).
 *
 * Règle : aucun appel réseau ici — uniquement logique de sélection et
 * synchronisation avec state + sessionStorage + DOM badge.
 */

import { state } from '../b-store.js';
import { r } from './group-helpers.js';

/**
 * Indique si un panier propriétaire doit être affiché dans le switcher.
 * Les paniers clôturés ou expirés sont exclus.
 * @param {object|null} cart
 * @returns {boolean}
 */
export function isVisibleOwnerCart(cart) {
  if (!cart) return false;
  return !['cancelled', 'expired', 'finalized', 'converted_to_order'].includes(cart.status);
}

/**
 * Trie un tableau de paniers créateur du plus récent au plus ancien.
 * @param {Array} carts
 * @returns {Array}  nouveau tableau (non muté)
 */
export function sortOwnerCarts(carts = []) {
  return [...carts].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
}

/**
 * Sélectionne le panier créateur à afficher :
 *   1. Si preferredId est fourni et visible → retourne ce panier.
 *   2. Sinon → retourne le panier visible le plus récent.
 *   3. S'il n'y a aucun panier visible → retourne null.
 * @param {Array}       carts
 * @param {string|null} preferredId  id du panier à privilégier (ex: opts.cartId)
 * @returns {object|null}
 */
export function pickOwnerCart(carts = [], preferredId = null) {
  const visible = sortOwnerCarts(carts).filter(isVisibleOwnerCart);
  if (!visible.length) return null;
  if (preferredId) {
    const found = visible.find(c => String(c.id) === String(preferredId));
    if (found) return found;
  }
  return visible[0];
}

/**
 * Synchronise le store global et sessionStorage à partir d'un panier
 * partagé sélectionné. Source unique de vérité pour le badge et le banner.
 * @param {object|null} cart
 */
export function applyOwnerCartToState(cart) {
  if (!cart) return;

  state.shareToken          = cart.token              || null;
  state.shareId             = cart.id                 || null;
  state.shareExpiry         = cart.expires_at         || null;
  state.cartName            = cart.title              || 'Panier groupe';
  state.shareStatus         = cart.status             || null;
  state.shareTotalKmf       = r(cart.total_kmf_snapshot);
  state.shareContributedKmf = r(cart.contributed_kmf);
  state.shareRemainingKmf   = r(cart.remaining_kmf);
  state.shareUrl            = cart.share_url
    || (cart.token ? `${window.location.origin}/boutique/?p=${cart.token}` : null);

  try {
    sessionStorage.setItem('kmrc_share', JSON.stringify({
      token:           state.shareToken,
      id:              state.shareId,
      expiry:          state.shareExpiry,
      name:            state.cartName,
      status:          state.shareStatus,
      total_kmf:       state.shareTotalKmf,
      contributed_kmf: state.shareContributedKmf,
      remaining_kmf:   state.shareRemainingKmf,
      share_url:       state.shareUrl,
    }));
  } catch (_) {}
}

/**
 * Synchronise les badges DOM de l'onglet Groupe avec state.shareToken.
 * Appelé après toute opération qui change l'état du panier partagé créateur
 * (création, finalisation, annulation, restauration).
 *
 * Re-exporté par b-group-view.js — contrat public : refreshGroupBadge().
 */
export function refreshGroupBadge() {
  const has = !!state.shareToken;
  document.getElementById('k-bnav-group-badge')?.classList.toggle('show', has);
  document.getElementById('k-header-group-badge')?.classList.toggle('show', has);
  document.getElementById('k-header-group-btn')?.classList.toggle('has-active', has);
}
