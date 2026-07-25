/**
 * @komerce-arch
 * @role          product-delivery-mode-model
 * @domain        catalog
 * @layer         view-model
 * @criticality   medium
 * @inputs        public_product_detail_v1.delivery_options
 * @outputs       delivery_mode_view_model
 * @depends       none
 * @used-by       b-modal-desktop-product.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md, docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md
 * @impact-areas  product-modal, desktop, delivery-options
 * @version       2026-07
 *
 * View-model partagé — dérive le mode de livraison résumé (air/sea) à
 * partir de detail.delivery_options[] (Product Detail Contract v1).
 *
 * Contrat-driven, zéro valeur en dur : le mode "air" n'est retenu que si au
 * moins une option AIR_* est présente ET disponible (available !== false).
 * Fallback "sea" sinon, y compris quand delivery_options est vide — cohérent
 * avec le fallback "Option de livraison communiquée à la commande" déjà
 * géré par les deux renderers pour la liste détaillée.
 *
 * Consommé par :
 *   - b-modal-desktop-product.js : pill résumé au-dessus de la liste
 *     détaillée, zone k-modal-delivery (owner inchangé).
 *   - b-modal-mobile-product.js : dérivation inline équivalente (préfixe
 *     AIR_ sur option.code) pour l'accent visuel du chip livraison — ne
 *     réimporte pas ce module, la logique est un one-liner qui suit la
 *     même convention contrat-driven, pas une duplication significative.
 *
 * Aucune nouvelle zone DOM créée par ce module.
 */
'use strict';

/**
 * @param {Array<{code?: string, available?: boolean, eta_label?: string|null}>} deliveryOptions
 * @returns {{ mode: 'air'|'sea', label: string, lead_time_label: string|null }}
 */
export function deriveDeliveryMode(deliveryOptions) {
  const options = Array.isArray(deliveryOptions) ? deliveryOptions : [];

  if (!options.length) {
    return { mode: 'sea', label: 'Livraison', lead_time_label: null };
  }

  const isAvailableAir = (opt) =>
    typeof opt?.code === 'string' && opt.code.startsWith('AIR_') && opt.available !== false;
  const isAvailableSea = (opt) =>
    typeof opt?.code === 'string' && opt.code.startsWith('SEA_') && opt.available !== false;

  const airOptions = options.filter(isAvailableAir);
  if (airOptions.length) {
    return {
      mode: 'air',
      label: 'Livraison aérienne',
      lead_time_label: airOptions[0].eta_label || null,
    };
  }

  const seaOptions = options.filter(isAvailableSea);
  if (seaOptions.length) {
    return {
      mode: 'sea',
      label: 'Livraison maritime',
      lead_time_label: seaOptions[0].eta_label || null,
    };
  }

  // Aucune option AIR_/SEA_ disponible (toutes indisponibles, ou codes
  // hors convention) : fallback sea neutre, sans faux délai inventé.
  return { mode: 'sea', label: 'Livraison', lead_time_label: null };
}

/**
 * Réconcilie `state.modalDeliverySelection` avec les `delivery_options[]`
 * du contrat courant (changement de produit, de SKU, ou re-render).
 *
 * Règle stricte : afficher une option — même unique — n'est jamais une
 * demande explicite du client. `requested_transport_rail` ne peut donc
 * jamais être auto-rempli à l'ouverture ou au re-render, y compris quand il
 * n'y a qu'un seul rail disponible. Seul un choix précédent explicite (posé
 * par un clic utilisateur) est conservé, et uniquement s'il reste valide
 * parmi les options actuelles ; sinon la sélection retombe à `null`.
 *
 * Owner unique de cette logique — mobile et desktop l'appellent tous les
 * deux au lieu de dupliquer la règle de conservation/reset.
 *
 * @param {Array<{code?: string}>} deliveryOptions
 * @param {{requested_transport_rail?: string|null}|null|undefined} previousSelection
 * @returns {{requested_transport_rail: string|null}}
 */
export function reconcileDeliverySelection(deliveryOptions, previousSelection) {
  const options = Array.isArray(deliveryOptions) ? deliveryOptions : [];
  const prevRail = previousSelection?.requested_transport_rail ?? null;
  const stillValid = prevRail != null && options.some((option) => option.code === prevRail);
  return { requested_transport_rail: stillValid ? prevRail : null };
}
