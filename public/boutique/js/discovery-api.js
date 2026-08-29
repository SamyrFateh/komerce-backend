/**
 * @komerce-arch-lite
 * @role          boutique-discovery-api
 * @domain        catalog
 * @layer         adapter
 * @owner         public/boutique/js/discovery-api.js
 * @purpose       Frontière frontend unique vers /api/local-stock et
 *                /api/providers-services — Vague 2 D6.
 * @impact-areas  boutique, pdp, discovery-rail
 * @version       2026-08
 */
'use strict';

/**
 * @module discovery-api
 * @brief Appels réseau vers les deux domaines Discovery locale montés en D6.
 *
 * Échec silencieux systématique — même discipline que le reste de la
 * boutique (voir b-group-banner.js#refreshBanner) : une erreur réseau, un
 * marché inconnu, ou un objet non exposable produisent tous `null`, jamais
 * une exception qui remonterait au composant appelant. Le composant qui
 * consomme ce module doit donc toujours savoir gérer `null` en ne rendant
 * rien — c'est précisément le contrat "si aucune donnée exposable, rien ne
 * s'affiche" (Vague 2 D6, capability != exposure).
 *
 * market est toujours un CODE (KM/YT/CM/CG), jamais un UUID — lu depuis
 * window.KomerceMarket.get().code (market-context.js), la seule source de
 * marché déjà légitimée côté client (KOMERCE_MARKET_LAYER_FREEZE.md §3 :
 * "navigation... NON autorisant"). Ce module ne résout jamais lui-même de
 * market_id — la résolution réelle reste entièrement côté serveur
 * (routes/local-stock.js, routes/providers-services.js#resolveMarketId).
 */

/**
 * @returns {string} le code marché courant (toujours KM aujourd'hui, voir
 *   market-context.js — M2 branchera une vraie résolution plus tard)
 */
function currentMarketCode() {
  try {
    return window.KomerceMarket?.get()?.code || 'KM';
  } catch (e) {
    return 'KM';
  }
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
 * Champs publics d'un service tiers exposable, ou null (non exposable,
 * introuvable, ou erreur réseau — le composant appelant ne distingue jamais
 * ces cas, même discipline "jamais le pourquoi" que la route elle-même).
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
