/**
 * @feature       shared-cart
 * @type          feature
 * @domain        shared-cart
 * @status        production
 * @owner         boutique
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      scripts/feature-registry-check.js
 */
'use strict';

module.exports = {
  name: 'shared-cart',
  type: 'feature',
  domain: 'shared-cart',
  status: 'production',
  owner: 'boutique',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',
  canonicalFeature: 'shared-cart',
  sliceKind: 'frontend-slice',

  service: 'Panier partagé et flux groupe : création, gestion et rendu créateur/participant, projeté dans le side cart / drawer canonique (PROMPT_FINAL_IMPLEMENTATION_LISTE_PARTAGEABLE_SIDE_CART).',
  perimeter: {
    in: ['panier partagé Boutique First et vues groupe'],
    out: ['panier personnel, catalogue vivant et paiement hors contrat partagé'],
  },

  files: {
    js: [
      '../js/b-group-banner.js',
      '../js/b-share-cart.js',
      '../js/group/group-api.js',
      '../js/group/group-checkout-adapter.js',
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
    ],
    tests: [
      '../tests/unit/group-checkout-adapter.test.js',
      '../tests/unit/group-price-variation.test.js',
      '../tests/unit/b-share-phone-guard.test.js',
      '../tests/unit/group-side-cart.test.js',
      '../tests/unit/shared-list-responsive-layout.test.js',
    ],
  },

  docs: ['REFACTOR_SUMMARY.md'],
  contract: {
    exposes: [],
    internalApi: [
      'b-share-cart.js / partage de panier',
      'group-side-cart.js / activation et rendu de la liste partageable dans le side cart / drawer canonique',
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
    'visiteur en lecture seule hors actions explicitement autorisées',
    'aucun appel au catalogue vivant pour une fiche snapshot partagée',
    'panier personnel et panier partagé restent distincts',
  ],
};
