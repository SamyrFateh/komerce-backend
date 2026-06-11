/**
 * @module group/group-api.js
 * @owner group refactor — couche réseau pour les paniers partagés
 *
 * Centralise tous les appels réseau liés aux shared-carts.
 *
 * Conventions :
 *   - Endpoints créateur (/api/shared-carts/:id/*) → apiGet / apiPost
 *     (passent par window.K.request, credentials:include automatiques)
 *   - Endpoints publics (/api/shared-carts/public/:token/*) → fetch direct,
 *     credentials:'include' explicite (pas d'auth requise, mais cookie session utile)
 *
 * Aucune logique métier ici — uniquement transport + parsing minimal.
 * Les erreurs remontent via rejet de promesse (comportement natif apiGet/apiPost/fetch).
 */

import { apiGet, apiPost } from '../b-utils.js';

/* ── Endpoints créateur (authentifiés via window.K.request) ──────── */

/**
 * Récupère tous les paniers partagés créés par l'utilisateur connecté.
 * @returns {Promise<{carts: Array}>}
 */
export function getOwnerSharedCarts() {
  return apiGet('/api/shared-carts/mine');
}

/**
 * Récupère un panier partagé par son id (vue créateur, avec contributions).
 * @param {string|number} cartId
 * @returns {Promise<{cart, contributions, commitments?, share_url}>}
 */
export function getSharedCartOwner(cartId) {
  return apiGet(`/api/shared-carts/${cartId}`);
}

/**
 * Récupère les articles d'un panier partagé sous forme de snapshot cart-items.
 * @param {string|number} cartId
 * @returns {Promise<{cart_items: Array}>}
 */
export function getSharedCartItems(cartId) {
  return apiGet(`/api/shared-carts/${cartId}/as-cart-items`);
}

/**
 * Ouvre la phase règlement pour un panier partagé.
 * @param {string|number} cartId
 * @param {{settlement_window_hours: number}} payload
 * @returns {Promise<any>}
 */
export function openSettlement(cartId, payload) {
  return apiPost(`/api/shared-carts/${cartId}/open-settlement`, payload);
}

/**
 * Finalise un panier partagé et crée la commande Komerce.
 * @param {string|number} cartId
 * @param {{accept_partial?: boolean}} payload
 * @returns {Promise<{order_reference, order_id, prepaid_kmf}>}
 */
export function finalizeSharedCart(cartId, payload) {
  return apiPost(`/api/shared-carts/${cartId}/finalize`, payload);
}

/**
 * Annule un panier partagé.
 * @param {string|number} cartId
 * @param {{reason: string}} payload
 * @returns {Promise<any>}
 */
export function cancelSharedCart(cartId, payload) {
  return apiPost(`/api/shared-carts/${cartId}/cancel`, payload);
}

/* ── Endpoints publics (fetch direct, credentials:include) ───────── */

/**
 * Récupère les données publiques d'un panier partagé via son token.
 * @param {string} token
 * @returns {Promise<{cart, items}|null>}  null si la réponse n'est pas ok
 */
export async function getSharedCartPublic(token) {
  const rsp = await fetch(`/api/shared-carts/public/${token}`, { credentials: 'include' });
  return rsp.ok ? rsp.json() : null;
}

/**
 * Récupère la liste des engagements d'un panier partagé public.
 * @param {string} token
 * @returns {Promise<Array>}  tableau vide si l'endpoint échoue
 */
export async function getCommitments(token) {
  const rsp = await fetch(`/api/shared-carts/public/${token}/commitments`, { credentials: 'include' });
  if (!rsp.ok) return [];
  const data = await rsp.json();
  return data.commitments || [];
}

/**
 * Enregistre ou met à jour un engagement participant.
 * @param {string} token
 * @param {{participant_name, participant_phone, amount_kmf, message?}} payload
 * @returns {Promise<{updated?: boolean}>}
 *
 * FIX-COMMIT-01 : endpoint public — utilise fetch direct (pas apiPost/window.K.request
 * qui exige une session authentifiée). Le participant peut ne pas être connecté.
 */
export async function createCommitment(token, payload) {
  const rsp = await fetch(`/api/shared-carts/public/${token}/commitments`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!rsp.ok) {
    let msg = 'Erreur lors de l\'enregistrement.';
    try { const d = await rsp.json(); msg = d?.message || d?.error || msg; } catch (_) {}
    throw new Error(msg);
  }
  return rsp.json();
}

/**
 * Retrouve un engagement verrouillé par numéro de téléphone (phase règlement).
 * @param {string} token
 * @param {string} phone  numéro brut (encodé ici)
 * @returns {Promise<{commitment}>}
 *
 * FIX-COMMIT-02 : endpoint public — fetch direct.
 */
export async function lookupCommitmentByPhone(token, phone) {
  const rsp = await fetch(
    `/api/shared-carts/public/${token}/commitments/by-phone?phone=${encodeURIComponent(phone)}`,
    { credentials: 'include' }
  );
  if (!rsp.ok) {
    let msg = 'Aucun engagement trouvé pour ce numéro.';
    try { const d = await rsp.json(); msg = d?.message || d?.error || msg; } catch (_) {}
    throw new Error(msg);
  }
  return rsp.json();
}

/**
 * Crée une contribution payante (Stripe Checkout) pour un engagement verrouillé.
 * @param {string} token
 * @param {{amount_kmf, contributor_name, contributor_email, contributor_phone, message?}} payload
 * @returns {Promise<{checkout_url?: string}>}
 *
 * FIX-COMMIT-03 : endpoint public — fetch direct.
 */
export async function createContribution(token, payload) {
  const rsp = await fetch(`/api/shared-carts/public/${token}/contributions`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!rsp.ok) {
    let msg = 'Erreur lors de la contribution.';
    try { const d = await rsp.json(); msg = d?.message || d?.error || msg; } catch (_) {}
    throw new Error(msg);
  }
  return rsp.json();
}
