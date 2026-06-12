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
 * V4.1 — Ferme le panier et ouvre la fenêtre de paiement 48 h.
 */
export function closeCart(cartId) {
  return apiPost(`/api/shared-carts/${cartId}/close`, {});
}

/** Alias transitionnel. */
export function openSettlement(cartId) {
  return closeCart(cartId);
}

/**
 * V4.1 — Prolonge la fenêtre de paiement de 48 h (une seule fois).
 */
export function extendPaymentWindow(cartId) {
  return apiPost(`/api/shared-carts/${cartId}/extend-window`, {});
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
 * V4.1 — Agrégat public des estimations.
 */
export async function getEstimationAggregate(token) {
  const rsp = await fetch(`/api/shared-carts/public/${token}/estimations`, { credentials: 'include' });
  if (!rsp.ok) return { total_estimated_kmf: 0, count: 0 };
  const data = await rsp.json();
  return {
    total_estimated_kmf: Number(data?.total_estimated_kmf) || 0,
    count: Number(data?.count) || 0,
  };
}

/**
 * V4.1 — Crée ou met à jour une estimation (sans OTP).
 */
export async function upsertEstimation(token, payload) {
  const rsp = await fetch(`/api/shared-carts/public/${token}/estimations`, {
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
 * V4.1 — Retire une estimation.
 */
export async function deleteEstimation(token, estimationId, phone = null) {
  const rsp = await fetch(`/api/shared-carts/public/${token}/estimations/${estimationId}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(phone ? { participant_phone: phone } : {}),
  });
  if (!rsp.ok) {
    let msg = 'Retrait impossible.';
    try { const d = await rsp.json(); msg = d?.message || d?.error || msg; } catch (_) {}
    throw new Error(msg);
  }
  return rsp.json();
}

/**
 * V4.1 — Estimation existante par téléphone (pré-remplissage). Jamais bloquant.
 */
export async function getEstimationByPhone(token, phone) {
  try {
    const rsp = await fetch(
      `/api/shared-carts/public/${token}/estimations/by-phone?phone=${encodeURIComponent(phone)}`,
      { credentials: 'include' }
    );
    if (!rsp.ok) return null;
    const data = await rsp.json();
    return data?.estimation || null;
  } catch (_) { return null; }
}

/**
 * Crée une contribution payante (Stripe Checkout) pour un contribution payante.
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
