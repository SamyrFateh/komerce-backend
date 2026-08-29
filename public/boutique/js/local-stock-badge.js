/**
 * @komerce-arch-lite
 * @role          boutique-local-stock-badge
 * @domain        catalog
 * @layer         ui-component
 * @owner         public/boutique/js/local-stock-badge.js
 * @purpose       Badge "Disponible maintenant" sur la PDP — Vague 2 D6.
 * @impact-areas  boutique, pdp
 * @version       2026-08
 */
'use strict';

/**
 * @module local-stock-badge
 * @brief Rendu final du badge stock local, exposition backend-driven.
 *
 * "Disponible maintenant / Déjà en stock aux Comores" — RECHALLENGE_
 * DOCTRINE_DISCOVERY_LOCALE_V2.md §3.A. Le composant est intégralement
 * construit dès maintenant (Vague 2 D6), mais reste invisible tant que le
 * backend ne répond pas exposable=true pour AUCUN produit — commercial_
 * exposure=DISABLED partout à ce stade (D7 activera le premier pilote).
 *
 * Aucun feature flag dispersé ici : le composant ne teste jamais une
 * variable locale/globale pour décider d'afficher ou non — il lit
 * uniquement la réponse serveur (exposable: true|false) et agit en
 * conséquence. C'est le backend qui gouverne l'exposition, jamais ce
 * fichier (RECHALLENGE_DOCTRINE_DISCOVERY_LOCALE_V2.md §10).
 */

import { sanitize } from './b-utils.js';
import { fetchLocalStockAvailability } from './discovery-api.js';

const BADGE_CLASS = 'k-local-stock-badge';

/**
 * Construit le DOM du badge. Fonction pure — aucun accès réseau, testable
 * isolément du fetch.
 * @param {'AVAILABLE_NOW'} availability — seule valeur qui produit un rendu ;
 *   voir renderLocalStockBadge pour la garde amont
 * @returns {HTMLElement}
 */
function buildBadgeElement() {
  const el = document.createElement('div');
  el.className = BADGE_CLASS;
  el.innerHTML = `
    <span class="${BADGE_CLASS}__primary">${sanitize('Disponible maintenant')}</span>
    <span class="${BADGE_CLASS}__secondary">${sanitize('Déjà en stock aux Comores')}</span>
  `;
  return el;
}

/**
 * Rend le badge dans `container` si et seulement si le produit est
 * réellement exposable — sinon vide le container sans rien afficher.
 * Ne lève jamais : une erreur réseau ou une réponse null produisent le même
 * résultat qu'une indisponibilité (rien), jamais un état d'erreur visible.
 *
 * @param {HTMLElement} container
 * @param {string} productId
 * @returns {Promise<void>}
 */
export async function renderLocalStockBadge(container, productId) {
  if (!container) return;
  container.innerHTML = ''; // état par défaut : rien, jusqu'à preuve du contraire

  const result = await fetchLocalStockAvailability(productId);
  if (!result || !result.exposable || result.availability !== 'AVAILABLE_NOW') {
    return; // no-op silencieux — jamais un message d'indisponibilité
  }

  container.appendChild(buildBadgeElement());
}
