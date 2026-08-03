/**
 * @komerce-arch-lite
 * @role          shared-cart-group-state
 * @domain        shared-cart
 * @layer         ui-component
 * @owner         public/boutique/js/b-group-view.js
 * @purpose       supports public/boutique/js/b-group-view.js
 * @impact-areas  shared-cart
 * @version       2026-08
 */
'use strict';

/**
 * @module group/group-state.js
 * @owner Boutique First — helpers sélection (switcher "mes listes") et
 * synchronisation du badge global.
 *
 * Fonctions pures de filtrage/tri des paniers créateur (isVisibleOwnerCart,
 * sortOwnerCarts, pickOwnerCart) utilisées quand l'onglet Groupe est ouvert
 * sans token (navigation directe plutôt que via un lien reçu) — le
 * storyboard ne couvre que l'écran atteint par le lien ; ce switcher est
 * la fonctionnalité de gestion des listes du créateur, hors périmètre du
 * storyboard mais toujours nécessaire.
 *
 * applyOwnerCartToState (V4.1) a été retiré : il projetait des champs qui
 * n'existent plus sur la réponse publique (total_kmf_snapshot,
 * contributed_kmf, remaining_kmf, migration 124). La sélection d'une
 * liste dans le switcher se résout désormais par un appel à
 * getSharedCartPublic(token) — même chemin, même donnée, pour tout le
 * monde (storyboard §3).
 *
 * Inclut refreshGroupBadge — synchronisation badge DOM depuis
 * state.shareToken. Contrat public conservé : re-exporté par
 * b-group-view.js pour b-share-cart.js.
 *
 * Règle : aucun appel réseau ici — uniquement logique de sélection et
 * synchronisation avec state + DOM badge.
 */

import { state } from '../b-store.js';

/**
 * Indique si un panier propriétaire doit être affiché dans le switcher.
 * Seuls les paniers annulés sont exclus — une liste fermée reste un état
 * normal et consultable (storyboard §5, état "Fermée" : lecture seule
 * pour tout le monde, mais toujours affichée, pas cachée).
 * @param {object|null} cart
 * @returns {boolean}
 */
export function isVisibleOwnerCart(cart) {
  if (!cart) return false;
  return cart.status !== 'cancelled';
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
 * Synchronise les badges DOM de l'onglet Groupe avec state.shareToken.
 * Appelé après toute opération qui change l'état du panier partagé
 * créateur (création, ajout, retrait, fermeture, annulation).
 *
 * Re-exporté par b-group-view.js — contrat public : refreshGroupBadge().
 */
export function refreshGroupBadge() {
  const has = !!state.shareToken;
  document.getElementById('k-bnav-group-badge')?.classList.toggle('show', has);
  document.getElementById('k-header-group-badge')?.classList.toggle('show', has);
  document.getElementById('k-header-komerce-btn')?.classList.toggle('has-active', has);
}
