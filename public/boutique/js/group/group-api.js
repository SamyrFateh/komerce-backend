/**
 * @komerce-arch
 * @role          shared-cart-front-api
 * @domain        shared-cart
 * @layer         api-client
 * @criticality   high
 * @inputs        share_token, viewer_session, shared_cart_id, item_id, quantity
 * @outputs       shared_cart_data, library_data, action_results
 * @depends       routes/shared-cart.js, routes/shared-cart-saved.js, fetch
 * @used-by       group/group-side-cart.js, group/group-library-remove.js
 * @doctrine      boutique_first, domaine_minimal, un_appel_une_action
 * @impact-areas  shared-cart, participant-flow, creator-flow, checkout
 * @version       2026-08
 */
'use strict';

/**
 * @module group/group-api.js
 * @owner Boutique First — couche réseau minimale pour la liste partageable
 *
 * Le checkout canonique (POST /api/orders) reste le seul acte engageant.
 * Ce module transporte les lectures de liste et de bibliothèque, la
 * sauvegarde explicite d'une liste reçue, son retrait explicite de la
 * bibliothèque, ainsi que les actions unitaires exposées au propriétaire :
 * ajouter un article (Lot 3 GAP-07), modifier une quantité, retirer une
 * ligne et fermer la liste.
 *
 * Conventions :
 *   - Endpoints créateur (/api/shared-carts/:id/*) → apiGet / apiPost /
 *     apiDelete / apiPatch via window.K.request, credentials:include auto.
 *   - Endpoint public (/api/shared-carts/public/:token) → fetch direct,
 *     credentials:'include' explicite ; la session éventuelle permet au
 *     backend de dériver is_creator sans rendre l'authentification obligatoire.
 *
 * Aucune logique métier ici — uniquement transport + parsing minimal.
 */

import { apiGet, apiPost, apiDelete, apiPatch } from '../b-utils.js';

/* ── fetchWithTimeout ──────────────────────────────────────────────
 * L'endpoint public passe par fetch() nu : si l'API pend (pool DB
 * saturé), la promesse ne se réglerait jamais et la vue resterait sur
 * "Chargement…" indéfiniment. Garanties : la promesse SE RÈGLE toujours
 * en ≤ timeoutMs (abort + Promise.race, indépendant du support du
 * signal), erreur lisible (e.isTimeout=true, name='TimeoutError').
 */
export const FETCH_TIMEOUT_MS = 10_000;

export function fetchWithTimeout(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (controller) controller.abort();
      const e = new Error(`Délai dépassé (timeout ${timeoutMs}ms) — ${url}`);
      e.name = 'TimeoutError';
      e.isTimeout = true;
      reject(e);
    }, timeoutMs);
  });
  const fetchOpts = controller ? { ...opts, signal: controller.signal } : opts;
  return Promise.race([fetch(url, fetchOpts), timeout])
    .finally(() => clearTimeout(timer));
}

/* ── Endpoints créateur (authentifiés via window.K.request) ──────── */

/**
 * Lecture de compatibilité des listes créées par l'utilisateur connecté.
 * La bibliothèque canonique utilise getSharedCartLibrary(), qui sépare
 * explicitement les listes créées et les listes reçues sauvegardées.
 * @returns {Promise<{carts: Array}>}
 */
export function getOwnerSharedCarts() {
  return apiGet('/api/shared-carts/mine', { timeoutMs: FETCH_TIMEOUT_MS });
}

/**
 * Bibliothèque « Mes listes » : deux sections sont renvoyées ensemble,
 * « Créées par moi » et « Partagées avec moi ». Une liste reçue n'apparaît
 * dans la seconde section qu'après sauvegarde explicite.
 * @returns {Promise<{created: Array, saved: Array}>}
 */
export function getSharedCartLibrary() {
  return apiGet('/api/shared-carts/library', { timeoutMs: FETCH_TIMEOUT_MS });
}

/**
 * Sauvegarde explicitement une liste reçue dans la bibliothèque du
 * destinataire. Cet appel n'est jamais déclenché automatiquement à la
 * simple ouverture d'un lien. L'opération est idempotente côté serveur.
 * @param {string} token
 * @returns {Promise<{ok: boolean, shared_cart_id: string, already_saved: boolean}>}
 */
export function saveSharedCart(token) {
  return apiPost('/api/shared-carts/save', { token });
}

/**
 * Retire une liste reçue de la bibliothèque de l'utilisateur courant.
 * Ne supprime jamais la liste réelle, ses articles, ses commandes ou son
 * lien public. L'opération est idempotente côté serveur.
 * @param {string|number} sharedCartId
 * @returns {Promise<{ok: boolean, shared_cart_id: string, removed: boolean}>}
 */
export function removeSavedSharedCart(sharedCartId) {
  return apiDelete(`/api/shared-carts/saved/${encodeURIComponent(String(sharedCartId))}`);
}

/**
 * Retire un article de la liste après confirmation côté interface.
 * Le serveur refuse l'opération si la ligne a déjà été achetée.
 * @param {string|number} cartId
 * @param {string} itemId
 * @returns {Promise<{ok: boolean, cart}>}
 */
export function removeItemFromSharedList(cartId, itemId) {
  return apiDelete(`/api/shared-carts/${cartId}/items/${itemId}`);
}

/**
 * Ajoute un nouvel article à une liste existante (Lot 3 GAP-07 — CTA
 * "Ajouter à cette liste" depuis la fiche produit). Une intention, un
 * appel, écriture immédiate (routes/shared-cart.js POST /:id/items,
 * services/shared-cart-items-service.js::addSharedCartItem).
 *
 * `variant_combo` est transmis tel quel — jamais transformé ici. Pour un
 * produit SKU, c'est `state.modalSelection.selected_options` (toutes les
 * clés d'axe résolues) ; pour un produit non-SKU/sans variante, `null`.
 * Le serveur reste seul autoritaire sur le prix, le SKU et la
 * disponibilité (resolveActiveSku côté services/product-admin-service.js
 * — jamais un prix/sku_id fourni par le client).
 *
 * @param {string|number} cartId
 * @param {string} productId
 * @param {number} quantity
 * @param {object|null} [variantCombo]
 * @returns {Promise<{ok: boolean, cart, item}>}
 */
export function addItemToSharedList(cartId, productId, quantity, variantCombo = null) {
  return apiPost(`/api/shared-carts/${cartId}/items`, {
    product_id: productId,
    quantity,
    variant_combo: variantCombo || null,
  });
}

/**
 * Ferme la liste : aucun nouvel achat ne peut démarrer, tandis que les
 * commandes déjà créées restent des commandes normales inchangées.
 */
export function closeCart(cartId) {
  return apiPost(`/api/shared-carts/${cartId}/close`, {});
}

/**
 * Modifie la quantité d'une ligne existante sans passer par l'ancien PUT
 * groupé. Le serveur refuse l'opération si la ligne a déjà été achetée.
 * @param {string|number} cartId
 * @param {string} itemId
 * @param {number} quantity
 * @returns {Promise<{ok: boolean, cart, item}>}
 */
export function updateSharedListItemQuantity(cartId, itemId, quantity) {
  return apiPatch(`/api/shared-carts/${cartId}/items/${itemId}`, { quantity });
}

/* ── Endpoint public (fetch direct, credentials:include) ──────────── */

/**
 * Récupère les données publiques d'une liste via son token. Le champ
 * dérivé is_creator indique si la session courante correspond au créateur,
 * sans exposer son identifiant brut et sans créer de mode frontend séparé.
 * @param {string} token
 * @returns {Promise<{cart, items, items_count, claimed_count, is_creator}|null>}
 *   null si la réponse n'est pas ok (lien invalide ou expiré).
 */
export async function getSharedCartPublic(token) {
  const rsp = await fetchWithTimeout(`/api/shared-carts/public/${token}`, { credentials: 'include' });
  return rsp.ok ? rsp.json() : null;
}
