/**
 * @komerce-arch
 * @role          shared-cart-front-api
 * @domain        shared-cart
 * @layer         api-client
 * @criticality   high
 * @inputs        share_token, viewer_session, product_id, item_id
 * @outputs       shared_cart_data, action_results
 * @depends       routes/shared-cart.js, fetch
 * @used-by       b-group-view.js, group/group-side-cart.js
 * @doctrine      boutique_first, domaine_minimal, un_appel_une_action
 * @impact-areas  shared-cart, participant-flow, creator-flow, checkout
 * @version       2026-08
 */
'use strict';

/**
 * @module group/group-api.js
 * @owner Boutique First — couche réseau minimale pour la liste partageable
 *
 * Boutique First (Contrat API — Liste partageable) : plus d'estimations,
 * plus de contributions Stripe propres à la liste, plus de fenêtre de
 * paiement, plus de finalize/extend-window. Le seul acte engageant reste
 * le checkout canonique (POST /api/orders), déclenché ailleurs
 * (b-checkout.js) — ce module ne fait que lire la liste et écrire les
 * actions unitaires du créateur (ajouter/retirer un article, fermer).
 *
 * Conventions (inchangées) :
 *   - Endpoints créateur (/api/shared-carts/:id/*) → apiGet / apiPost /
 *     apiDelete (passent par window.K.request, credentials:include auto).
 *   - Endpoint public (/api/shared-carts/public/:token) → fetch direct,
 *     credentials:'include' explicite (pas d'auth requise ; le cookie de
 *     session, s'il existe, permet au backend de dériver is_creator via
 *     soft-auth — jamais bloquant si absent).
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
 * Récupère tous les paniers partagés créés par l'utilisateur connecté.
 * Sert le switcher "mes listes" quand l'onglet Groupe est ouvert sans
 * token (navigation directe, pas via un lien reçu).
 * @returns {Promise<{carts: Array}>}
 */
export function getOwnerSharedCarts() {
  return apiGet('/api/shared-carts/mine', { timeoutMs: FETCH_TIMEOUT_MS });
}

/**
 * Retire un article de la liste — confirmation déjà obtenue côté client
 * avant cet appel (Invariant 21) ; exécution immédiate côté serveur.
 * Le serveur refuse (409 item_already_claimed) si l'article a déjà été
 * acheté — jamais un détachement silencieux de la commande liée.
 * @param {string|number} cartId
 * @param {string} itemId
 * @returns {Promise<{ok: boolean, cart}>}
 */
export function removeItemFromSharedList(cartId, itemId) {
  return apiDelete(`/api/shared-carts/${cartId}/items/${itemId}`);
}

/**
 * Ferme la liste — arrête les nouveaux achats, ceux déjà faits restent
 * des commandes normales inchangées (storyboard §4.5).
 */
export function closeCart(cartId) {
  return apiPost(`/api/shared-carts/${cartId}/close`, {});
}

/**
 * Ajoute un article unitaire à la liste (Invariant 20 : une intention, un
 * appel, écriture immédiate). Distinct du PUT /:id/items historique (édition
 * groupée) qu'aucun écran V1 n'appelle plus.
 * @param {string|number} cartId
 * @param {string|number} productId
 * @param {number} [quantity=1]
 * @returns {Promise<{ok: boolean, cart, item}>}
 */
export function addItemToSharedList(cartId, productId, quantity = 1) {
  return apiPost(`/api/shared-carts/${cartId}/items`, { product_id: productId, quantity });
}

/**
 * Modifie la quantité d'un article déjà présent dans la liste — amendement
 * V2 §B (PROMPT_FINAL_IMPLEMENTATION_LISTE_PARTAGEABLE_SIDE_CART_V2).
 * Capacité nouvelle, distincte du PUT /:id/items historique (édition
 * groupée) : ne touche qu'une ligne. Le serveur refuse (409
 * item_already_claimed) si l'article a déjà été acheté.
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
 * dérivé `is_creator` (booléen) indique si la session courante
 * correspond au créateur — jamais l'identifiant brut du créateur
 * (Contrat API §5 point 2). Même appel, même réponse, pour tout le
 * monde y compris le créateur (storyboard §0/§3) : c'est le backend qui
 * dérive is_creator via soft-auth, pas un mode différent côté front.
 * @param {string} token
 * @returns {Promise<{cart, items, items_count, claimed_count, is_creator}|null>}
 *   null si la réponse n'est pas ok (lien invalide/expiré).
 */
export async function getSharedCartPublic(token) {
  const rsp = await fetchWithTimeout(`/api/shared-carts/public/${token}`, { credentials: 'include' });
  return rsp.ok ? rsp.json() : null;
}
