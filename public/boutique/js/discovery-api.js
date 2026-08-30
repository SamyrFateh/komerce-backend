/**
 * @komerce-arch-lite
 * @role          boutique-discovery-api
 * @domain        catalog
 * @layer         adapter
 * @owner         public/boutique/js/discovery-api.js
 * @purpose       Frontière frontend unique vers les contrats Discovery locale.
 * @impact-areas  boutique, pdp, discovery-rail
 * @version       2026-08
 */
'use strict';

/**
 * @module discovery-api
 * @brief Appels réseau vers les domaines Discovery locale et leur projection unifiée.
 *
 * Les lectures restent silencieuses : une erreur réseau, un marché inconnu ou
 * un objet non exposable produisent `null`, afin de respecter capability !=
 * exposure. Les mutations, elles, renvoient un résultat structuré : une action
 * utilisateur ne doit jamais échouer silencieusement.
 *
 * market est toujours un CODE (KM/YT/CM/CG), jamais un UUID — lu depuis
 * window.KomerceMarket.get().code. La résolution d'autorisation reste serveur.
 */

function currentMarketCode() {
  try {
    return window.KomerceMarket?.get()?.code || 'KM';
  } catch (e) {
    return 'KM';
  }
}

/**
 * Projection unifiée du rail local.
 * @returns {Promise<{cards: Array<object>}|null>}
 */
export function fetchDiscoveryRail() {
  const market = currentMarketCode();
  return fetch(`/api/boutique/suggestions?surface=local&market=${encodeURIComponent(market)}`)
    .then(async response => {
      if (!response.ok) return null;
      const payload = await response.json();
      return Array.isArray(payload?.cards) ? payload : null;
    })
    .catch(() => null);
}

/**
 * Disponibilité + exposabilité d'un produit en stock local.
 * @param {string} productId
 * @returns {Promise<{availability: 'AVAILABLE_NOW'|'UNAVAILABLE', exposable: boolean}|null>}
 */
export function fetchLocalStockAvailability(productId) {
  if (!productId) return Promise.resolve(null);
  const market = currentMarketCode();
  return fetch(`/api/local-stock/availability?product_id=${encodeURIComponent(productId)}&market=${encodeURIComponent(market)}`)
    .then(response => response.ok ? response.json() : null)
    .catch(() => null);
}

/**
 * Champs publics d'un service tiers exposable, ou null.
 * @param {string} serviceId
 * @returns {Promise<{id: string, title: string, description: string|null, zone: string|null}|null>}
 */
export function fetchServiceCard(serviceId) {
  if (!serviceId) return Promise.resolve(null);
  const market = currentMarketCode();
  return fetch(`/api/providers-services/services/${encodeURIComponent(serviceId)}?market=${encodeURIComponent(market)}`)
    .then(response => response.ok ? response.json() : null)
    .catch(() => null);
}

/**
 * Champs publics d'une offre physique tierce exposable, ou null.
 * @param {string} physicalOfferId
 * @returns {Promise<{id: string, title: string, description: string|null, zone: string|null}|null>}
 */
export function fetchPhysicalOfferCard(physicalOfferId) {
  if (!physicalOfferId) return Promise.resolve(null);
  const market = currentMarketCode();
  return fetch(`/api/providers-services/physical-offers/${encodeURIComponent(physicalOfferId)}?market=${encodeURIComponent(market)}`)
    .then(response => response.ok ? response.json() : null)
    .catch(() => null);
}

/**
 * Crée une Inquiry pour une cible Discovery locale.
 *
 * Le téléphone n'est volontairement PAS un paramètre : le backend le dérive
 * de la session Komerce authentifiée. Le frontend ne choisit que la cible.
 *
 * @param {'service'|'physical_offer'} kind
 * @param {string} ref
 * @param {string|null} [requestedWindow]
 * @returns {Promise<{ok: boolean, inquiry?: object, status?: number, code?: string|null, error?: string}>}
 */
export async function createDiscoveryInquiry(kind, ref, requestedWindow = null) {
  if (!ref || !['service', 'physical_offer'].includes(kind)) {
    return { ok: false, status: 400, code: 'invalid_target', error: 'Cible invalide' };
  }

  const market = currentMarketCode();
  const body = kind === 'service'
    ? { service_id: ref }
    : { physical_offer_id: ref };

  if (requestedWindow) body.requested_window = requestedWindow;

  try {
    const response = await fetch(`/api/providers-services/inquiries?market=${encodeURIComponent(market)}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        code: payload?.code || null,
        error: payload?.error || 'Impossible d’envoyer la demande',
      };
    }

    if (!payload?.inquiry?.id) {
      return { ok: false, status: 502, code: 'invalid_response', error: 'Réponse de demande invalide' };
    }

    return { ok: true, inquiry: payload.inquiry };
  } catch (_) {
    return { ok: false, status: 0, code: 'network_error', error: 'Connexion impossible' };
  }
}
