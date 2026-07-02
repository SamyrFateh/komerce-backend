/**
 * @feature       shared-cart
 * @type          feature
 * @domain        shared-cart
 * @status        production
 * @owner         boutique
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      scripts/feature-registry-check.js
 *
 * Manifeste niveau 0 (gouvernance fichiers) pour le domaine frontend
 * "shared-cart". Genere pour rattacher les modules JS existants (deja annotes
 * @domain shared-cart dans leur header) a un manifest reel, afin que
 * scripts/feature-registry-check.js cesse de les compter en orphelins.
 */
'use strict';

module.exports = {

  name:     'shared-cart',
  type:     'feature',
  domain:   'shared-cart',
  status:   'production',
  owner:    'boutique',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  service: "Panier partage et flux groupe (creation, gestion, rendu createur/participant, orchestration commande collective).",

  perimeter: {
    in:  ['fichiers js/* annotes @domain shared-cart'],
    out: ['logique backend equivalente (repo komerce-backend, feature shared-cart)'],
  },

  files: {
    js: [
      '../js/b-group-banner.js',
      '../js/b-group-view.js',
      '../js/b-share-cart.js',
      '../js/collective-close-order-service.js',
      '../js/collective-ready-to-order-orchestrator.js',
      '../js/group/group-api.js',
      '../js/group/group-helpers.js',
      '../js/group/group-render-creator.js',
      '../js/group/group-state.js',
    ],
    tests: [
      '../tests/unit/collective-ready-to-order-orchestrator.test.js',
      '../tests/unit/group-render-creator.test.js',
    ],
  },

  docs: [],

  contract: {
    exposes: [
      'b-share-cart.js / partage de panier',
      'b-group-view.js / vue panier groupe',
      'b-group-banner.js / bannière groupe',
      'group-api.js / group-state.js / group-helpers.js / group-render-creator.js',
    ],
    consumes: [
      'auth — b-group-view.js, b-share-cart.js importent b-identity.js ; b-share-cart.js importe b-phone.js',
      'boutique — b-group-view.js, b-share-cart.js, b-group-banner.js importent b-bus.js, b-store.js, b-utils.js, b-cart-core.js, b-cart.js',
      'checkout — b-share-cart.js importe b-checkout.js',
    ],
  },

  authority: 'boutique — tout changement de perimetre de ce domaine doit etre reflete ici.',

  invariants: [
    'tout fichier js/* portant @domain shared-cart doit etre liste dans files.js de ce manifeste',
    'tout test unitaire couvrant un fichier files.js de ce manifeste doit etre liste dans files.tests',
  ],

};
