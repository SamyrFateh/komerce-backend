/**
 * @komerce-arch
 * @role          shared-cart-status-banner
 * @domain        shared-cart
 * @layer         ui-component
 * @criticality   medium
 * @inputs        shared_cart_state, expiry, contribution_state
 * @outputs       shared_cart_state_refresh
 * @depends       b-store.js
 * @used-by       b-share-cart.js, group/group-render-list.js, boutique.js
 * @doctrine      cockpit_groupe_source_unique, panier_ouvert_ferme
 * @impact-areas  shared-cart, participant-flow, creator-flow, navigation
 * @version       2026-07
 */
'use strict';

/**
 * @module b-group-banner
 * @brief Compatibilité de l'ancienne bannière globale du panier groupe.
 *
 * Depuis la doctrine « cockpit Groupe » (mai 2026), la boutique n'affiche plus
 * de bannière globale : l'état du panier partagé vit dans l'onglet Groupe et
 * dans le badge du header. Les anciens helpers de rendu, timers et interactions
 * ont donc été retirés au lieu de conserver du code définitivement inaccessible.
 */

import { state } from './b-store.js';

const BANNER_ID = 'k-group-banner';

function roundAmount(value) {
  return Math.round(Number(value) || 0);
}

/**
 * API conservée pour les appelants historiques. Elle garantit que l'ancienne
 * bannière reste masquée.
 */
export function showBanner() {
  hideBanner();
}

/**
 * Masque une éventuelle bannière résiduelle présente dans un ancien DOM/cache.
 */
export function hideBanner() {
  const el = document.getElementById(BANNER_ID);
  if (el) el.classList.remove('show', 'is-compact');
}

/**
 * Resynchronise l'état du panier partagé depuis l'API publique.
 * Aucun rendu global n'est déclenché : le cockpit Groupe reste la source UI.
 */
export function refreshBanner() {
  if (!state.shareToken) {
    hideBanner();
    return;
  }

  fetch(`/api/shared-carts/public/${state.shareToken}`, { credentials: 'include' })
    .then(response => response.ok ? response.json() : null)
    .then(data => {
      if (!data?.cart) {
        hideBanner();
        try {
          sessionStorage.removeItem('kmrc_share');
          sessionStorage.removeItem('kmrc_banner_dismissed');
        } catch (_) {}
        return;
      }

      state.shareExpiry = data.cart.expires_at;
      state.shareStatus = data.cart.status;
      state.shareTotalKmf = roundAmount(data.cart.total_kmf_snapshot);
      state.shareContributedKmf = roundAmount(data.cart.contributed_kmf);
      state.shareRemainingKmf = roundAmount(data.cart.remaining_kmf);

      showBanner();
    })
    .catch(() => {});
}
