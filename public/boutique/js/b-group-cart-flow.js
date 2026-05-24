/**
 * @module b-group-cart-flow
 * @deprecated PR-1 (2026-05-24) — remplacé par b-share-cart.js
 *
 * Les sélecteurs que ce module ciblait (#k-sc-group, .k-sc-btn-group, #k-cart-event-btn)
 * ont été supprimés de index.html dans la PR 1 (bouton "En groupe" → "Partager").
 * Ce fichier est conservé comme stub vide pour éviter des erreurs d'import dans
 * b-cart-product-open-style.js qui l'importe dynamiquement.
 * À supprimer lors de la PR de nettoyage event/*.html.
 */

export function setupGroupCartFlow() {
  // no-op — sélecteurs cibles supprimés du DOM (PR 1)
}
