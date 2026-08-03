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

  service: 'Panier partagé et flux groupe : création, gestion et rendu créateur/participant.',
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
      '../js/group/group-helpers.js',
      '../js/group/group-render-list.js',
      '../js/group/group-state.js',
      '../js/b-share-phone-guard.js',
    ],
    boutique: [
      '../js/b-group-cart-flow.js',
    ],
    css: [
      '../css/group-cart-flow.css',
      '../css/hero-cart-proxy.css',
      '../css/share-cart.css',
    ],
    tests: [
      '../tests/unit/group-render-list.test.js',
      '../tests/unit/group-checkout-adapter.test.js',
      '../tests/unit/b-share-phone-guard.test.js',
    ],
  },

  docs: ['REFACTOR_SUMMARY.md'],
  contract: {
    exposes: [],
    internalApi: [
      'b-share-cart.js / partage de panier',
      'group-render-list.js / écran unique de la liste partageable',
      'group-checkout-adapter.js / pont sélection liste -> checkout canonique',
      'group-api.js / group-state.js / group-helpers.js',
      'b-group-cart-flow.js / orchestration entrée groupe',
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
