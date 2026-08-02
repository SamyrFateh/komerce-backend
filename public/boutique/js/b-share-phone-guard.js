/**
 * @komerce-arch-lite
 * @role          boutique-b-share-phone-guard
 * @domain        shared-cart
 * @layer         ui-component
 * @owner         public/boutique/js/group/group-render-list.js
 * @purpose       supports public/boutique/js/group/group-render-list.js
 * @impact-areas  boutique
 * @version       2026-06
 */
'use strict';

/**
 * @module b-share-phone-guard
 * @brief Tombstone — ancien guard guest désactivé.
 *
 * Doctrine boutique-first / flux unique :
 *   Tous les clics "📤 Partager" doivent passer par b-share-cart.js,
 *   qui porte l'unique modal de création, le champ Nom et prénom, le téléphone
 *   au format checkout, la création backend, WhatsApp et le basculement Groupe.
 *
 * Ce fichier reste présent uniquement pour compatibilité avec main.js qui importe
 * setupSharePhoneGuard(). Il ne doit plus intercepter les clics ni afficher de
 * modal parallèle.
 */

export function setupSharePhoneGuard() {
  // No-op volontaire.
  // Ne pas réintroduire de listener capturant ici : b-share-cart.js est la
  // source unique du flow "📤 Partager".
}
