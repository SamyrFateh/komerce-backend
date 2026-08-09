/**
 * @komerce-arch
 * @role          shared-list-display-labels
 * @domain        shared-cart
 * @layer         presenter
 * @criticality   high
 * @inputs        viewer_relation, organizer_name
 * @outputs       canonical_shared_list_labels
 * @depends       none
 * @used-by       group/group-side-cart.js, b-share-cart.js, b-tracking.js
 * @doctrine      ma_liste_for_owner, liste_de_prenom_for_recipient
 * @impact-areas  shared-cart, side-cart, checkout, account
 * @version       2026-08
 */
'use strict';

/**
 * Extrait un prénom d'un libellé d'identité sans en faire une source
 * d'autorisation. Cette valeur sert exclusivement à l'affichage.
 */
export function firstNameOf(value) {
  const normalized = String(value || '').trim();
  return normalized ? normalized.split(/\s+/)[0] : null;
}

/**
 * Libellé canonique du slot partagé.
 *
 * Les listes V1 ne sont pas nommables : un éventuel title historique ne
 * doit donc jamais remplacer la relation avec l'utilisateur courant.
 */
export function sharedListDisplayLabel({
  isCreator = false,
  creatorFirstName = null,
  organizerFullName = null,
} = {}) {
  if (isCreator) return 'Ma liste';
  const firstName = firstNameOf(creatorFirstName || organizerFullName);
  return firstName ? `Liste de ${firstName}` : 'Liste reçue';
}

/**
 * Libellé canonique du contexte checkout.
 */
export function sharedListCheckoutLabel(context = {}) {
  if (context.isCreator) return 'Achat pour Ma liste';
  const firstName = firstNameOf(context.creatorFirstName || context.organizerFullName);
  return firstName
    ? `Achat pour la liste de ${firstName}`
    : 'Achat pour une liste reçue';
}
