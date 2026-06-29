/**
 * @feature       payment
 * @type          feature
 * @domain        payment
 * @status        production
 * @owner         boutique
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      scripts/feature-registry-check.js
 *
 * Manifeste niveau 0 (gouvernance fichiers) pour le domaine frontend
 * "payment". Genere pour rattacher les modules JS existants (deja annotes
 * @domain payment dans leur header) a un manifest reel, afin que
 * scripts/feature-registry-check.js cesse de les compter en orphelins.
 */
'use strict';

module.exports = {

  name:     'payment',
  type:     'feature',
  domain:   'payment',
  status:   'production',
  owner:    'boutique',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  service: "Integration paiement (PayPal) — rendu et orchestration du flux de paiement tiers.",

  perimeter: {
    in:  ['fichiers js/* annotes @domain payment'],
    out: ['logique backend equivalente (repo komerce-backend, feature payments)'],
  },

  files: {
    js: [
      '../js/b-paypal.js',
    ],
  },

  contract: {
    exposes:  [],
    consumes: [],
  },

  authority: 'boutique — tout changement de perimetre de ce domaine doit etre reflete ici.',

  invariants: [
    'tout fichier js/* portant @domain payment doit etre liste dans files.js de ce manifeste',
  ],

};
