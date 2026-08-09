/**
 * @feature       shared-cart
 * @type          feature
 * @domain        shared-cart
 * @status        production
 * @owner         boutique
 * @doctrine      docs/doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md
 * @registry      scripts/feature-registry-check.js
 */
'use strict';

module.exports = {
  name: 'shared-cart',
  type: 'feature',
  domain: 'shared-cart',
  status: 'production',
  owner: 'boutique',
  doctrine: 'docs/doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md',
  canonicalFeature: 'shared-cart',
  sliceKind: 'frontend-slice',

  service: 'Liste publiée comme snapshot immuable dans un slot distinct de Mon panier ; sélection locale, récapitulatif obligatoire et checkout canonique sans mélange des intentions.',
  perimeter: {
    in: ['création, activation et rendu d’une liste publiée immuable dans le slot partagé du side cart', 'sélection de lignes disponibles et pont vers le récapitulatif puis le checkout canonique'],
    out: ['mutation du snapshot publié, fusion avec le panier personnel, cagnotte ou checkout collectif parallèle'],
  },

  files: {
    js: [
      '../js/b-group-banner.js',
      '../js/b-share-cart.js',
      '../js/group/group-api.js',
      '../js/group/group-checkout-adapter.js',
      '../js/group/group-library-remove.js',
      '../js/group/group-price-variation.js',
      '../js/group/group-side-cart.js',
      '../js/group/group-state.js',
      '../js/b-share-phone-guard.js',
    ],
    css: [
      '../css/hero-cart-proxy.css',
      '../css/share-cart.css',
      '../css/shared-list-side-cart.css',
      '../css/shared-list-side-cart-responsive.css',
      '../css/shared-list-library-remove.css',
      '../css/shared-list-lists-tab.css',
    ],
    tests: [
      '../tests/unit/group-checkout-adapter.test.js',
      '../tests/unit/group-price-variation.test.js',
      '../tests/unit/b-share-phone-guard.test.js',
      '../tests/unit/group-side-cart.test.js',
      '../tests/unit/group-checkout-adapter.test.js',
      '../tests/unit/b-checkout.test.js',
      '../tests/unit/shared-list-responsive-layout.test.js',
      '../tests/e2e/authenticated/group-shared-list.spec.js',
    ],
  },

  docs: ['docs/doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md', 'docs/CONTRAT_API_LISTE_PARTAGEABLE.md'],
  contract: {
    exposes: [],
    internalApi: [
      'b-share-cart.js / partage de panier',
      'group-side-cart.js / activation et rendu de la liste partageable dans le side cart / drawer canonique',
      'group-library-remove.js / retrait explicite d’un signet reçu dans Mes listes',
      'group-checkout-adapter.js / pont sélection liste -> checkout canonique',
      'group-price-variation.js / comparaison prix snapshot liste vs prix catalogue actuel (recap checkout)',
      'group-api.js / group-state.js',
    ],
    consumes: [
      'auth — identité et téléphone',
      'platform-ops — bus, store et utilitaires',
      'orders — snapshot explicite du panier personnel',
      'payments — checkout canonique',
    ],
  },
  authority: 'boutique — shared-cart possède seul le cycle groupe et la vue participant.',
  invariants: [
    'contenu, quantités et variantes sont figés dès publication ; seuls les claims évoluent',
    'Mon panier reste une surface indépendante ; zéro ou une liste OPEN occupe le slot partagé',
    'le propriétaire voit Ma liste ; un tiers voit Liste de [Prénom]',
    'la sélection est locale et ne réserve jamais une ligne',
    'toute sélection passe par un récapitulatif avant le checkout canonique',
    'une commande ne mélange jamais panier personnel et lignes de liste',
    'quitter × ne ferme ni ne modifie la liste',
    'CLOSED/CANCELLED restent historiques et ne résident jamais dans le side cart',
    'retirer une liste sauvegardée ne supprime jamais la liste ni son token public',
  ],
};
