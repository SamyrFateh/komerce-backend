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
 * Échec silencieux systématique — même discipline que le reste de la
 * boutique : une erreur réseau, un marché inconnu, ou un objet non exposable
 * produisent `null`, jamais une exception qui remonterait au composant appelant.
 * Le consommateur sait donc toujours appliquer le contrat :
 * "si aucune donnée exposable, rien ne s'affiche" (capability != exposure).
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
 * Projection unifiée du rail local. Tant que la route recommendations ne
 * fournit pas la surface `local`, la réponse est traitée comme vide et le
 * composant reste absent — le frontend final peut donc être construit avant
 * l'ouverture commerciale sans inventer de donnée.
 *
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
