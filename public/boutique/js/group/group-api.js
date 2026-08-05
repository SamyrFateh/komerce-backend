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
 * Ce module transporte uniquement les lectures de liste et de bibliothèque,
 * la sauvegarde explicite d'une liste reçue, son retrait de la bibliothèque,
 * ainsi que les actions unitaires encore exposées au propriétaire : modifier
 * une quantité, retirer une ligne et fermer la liste.
 *
 * L'ajout d'un nouvel article à une liste existante n'est pas exposé dans
 * l'interface actuelle. La capacité backend POST /api/shared-carts/:id/items
 * reste hors de ce client jusqu'à la conception d'un parcours produit dédié.
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

export function getOwnerSharedCarts() {
  return apiGet('/api/shared-carts/mine', { timeoutMs: FETCH_TIMEOUT_MS });
}

export function getSharedCartLibrary() {
  return apiGet('/api/shared-carts/library', { timeoutMs: FETCH_TIMEOUT_MS });
}

export function saveSharedCart(token) {
  return apiPost('/api/shared-carts/save', { token });
}

/**
 * Retire une liste reçue de la bibliothèque de l'utilisateur courant.
 * Ne supprime jamais la liste réelle ni son lien public.
 */
export function removeSavedSharedCart(sharedCartId) {
  return apiDelete(
    `/api/shared-carts/saved/${encodeURIComponent(String(sharedCartId))}`
  );
}

export function removeItemFromSharedList(cartId, itemId) {
  return apiDelete(`/api/shared-carts/${cartId}/items/${itemId}`);
}

export function closeCart(cartId) {
  return apiPost(`/api/shared-carts/${cartId}/close`, {});
}

export function updateSharedListItemQuantity(cartId, itemId, quantity) {
  return apiPatch(`/api/shared-carts/${cartId}/items/${itemId}`, { quantity });
}

export async function getSharedCartPublic(token) {
  const rsp = await fetchWithTimeout(`/api/shared-carts/public/${token}`, { credentials: 'include' });
  return rsp.ok ? rsp.json() : null;
}
