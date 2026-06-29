/**
 * @feature       recommendations
 * @type          feature
 * @domain        recommendations
 * @status        production
 * @owner         boutique
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      scripts/feature-registry-check.js
 *
 * Manifeste niveau 0 (gouvernance fichiers) pour le domaine frontend
 * "recommendations". Genere pour rattacher les modules JS existants (deja annotes
 * @domain recommendations dans leur header) a un manifest reel, afin que
 * scripts/feature-registry-check.js cesse de les compter en orphelins.
 */
'use strict';

module.exports = {

  name:     'recommendations',
  type:     'feature',
  domain:   'recommendations',
  status:   'production',
  owner:    'boutique',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  service: "Suggestions et curation produit (rail de suggestions modal, curation editoriale PDP).",

  perimeter: {
    in:  ['fichiers js/* annotes @domain recommendations'],
    out: ['logique backend equivalente (repo komerce-backend, feature recommendations)'],
  },

  files: {
    js: [
      '../js/b-modal-suggestions.js',
      '../js/b-pdp-curation-suggestions.js',
    ],
  },

  contract: {
    exposes:  [],
    consumes: [],
  },

  authority: 'boutique — tout changement de perimetre de ce domaine doit etre reflete ici.',

  invariants: [
    'tout fichier js/* portant @domain recommendations doit etre liste dans files.js de ce manifeste',
  ],

};
