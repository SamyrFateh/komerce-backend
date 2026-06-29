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
  },

  contract: {
    exposes:  [],
    consumes: [],
  },

  authority: 'boutique — tout changement de perimetre de ce domaine doit etre reflete ici.',

  invariants: [
    'tout fichier js/* portant @domain shared-cart doit etre liste dans files.js de ce manifeste',
  ],

};
