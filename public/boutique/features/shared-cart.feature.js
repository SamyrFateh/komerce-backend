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
      '../js/b-group-view.js',
      '../js/b-share-cart.js',
      '../js/group/group-api.js',
      '../js/group/group-helpers.js',
      '../js/group/group-render-creator.js',
      '../js/group/group-state.js',
      '../js/b-friendly-group-redirect.js',
      '../js/b-share-phone-guard.js',
    ],
    boutique: [
      '../js/b-group-cart-flow.js',
    ],
    css: [
      '../css/group-cart-flow.css',
      '../css/hero-cart-proxy.css',
      '../css/share-cart.css',
      '../css/shared-followup.css',
    ],
    tests: [
      '../tests/unit/group-render-creator.test.js',
      '../tests/unit/b-friendly-group-redirect.test.js',
      '../tests/unit/b-share-phone-guard.test.js',
    ],
  },

  docs: ['REFACTOR_SUMMARY.md'],
  contract: {
    exposes: [],
    internalApi: [
      'b-share-cart.js / partage de panier',
      'b-group-view.js / vue groupe',
      'group-api.js / group-state.js / group-helpers.js / group-render-creator.js',
      'b-group-cart-flow.js / orchestration entrée groupe',
    ],
    consumes: [
      'auth — identité et téléphone',
      'platform-ops — bus, store et utilitaires',
      'orders — snapshot explicite du panier personnel',
      'payments — règlement de part selon le contrat backend',
    ],
  },
  authority: 'boutique — shared-cart possède seul le cycle groupe et la vue participant.',
  invariants: [
    'participant en lecture seule hors actions explicitement autorisées',
    'aucun appel au catalogue vivant pour une fiche snapshot partagée',
    'panier personnel et panier partagé restent distincts',
  ],
};
