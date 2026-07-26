/**
 * @komerce-arch-lite
 * @role          boutique-b-share-phone-guard
 * @domain        shared-cart
 * @layer         ui-component
 * @owner         public/boutique/js/b-group-view.js
 * @purpose       supports public/boutique/js/b-group-view.js
 * @impact-areas  boutique
 * @version       2026-06
 */
'use strict';

/**
 * @module b-share-phone-guard
 * @brief Tombstone â€” ancien guard guest dÃ©sactivÃ©.
 *
 * Doctrine boutique-first / flux unique :
 *   Tous les clics "ðŸ“¤ Partager" doivent passer par b-share-cart.js,
 *   qui porte l'unique modal de crÃ©ation, le champ Nom et prÃ©nom, le tÃ©lÃ©phone
 *   au format checkout, la crÃ©ation backend, WhatsApp et le basculement Groupe.
 *
 * Ce fichier reste prÃ©sent uniquement pour compatibilitÃ© avec main.js qui importe
 * setupSharePhoneGuard(). Il ne doit plus intercepter les clics ni afficher de
 * modal parallÃ¨le.
 */

export function setupSharePhoneGuard() {
  // No-op volontaire.
  // Ne pas rÃ©introduire de listener capturant ici : b-share-cart.js est la
  // source unique du flow "ðŸ“¤ Partager".
}
