/**
 * @feature       tracking
 * @type          feature
 * @domain        tracking
 * @status        production
 * @owner         boutique
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      scripts/feature-registry-check.js
 *
 * Manifeste niveau 0 (gouvernance fichiers) pour le domaine frontend
 * "tracking". Genere pour rattacher les modules JS existants (deja annotes
 * @domain tracking dans leur header) a un manifest reel, afin que
 * scripts/feature-registry-check.js cesse de les compter en orphelins.
 */
'use strict';

module.exports = {

  name:     'tracking',
  type:     'feature',
  domain:   'tracking',
  status:   'production',
  owner:    'boutique',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  service: "Analytics et tracking evenementiel cote boutique (suivi parcours, evenements UI).",

  perimeter: {
    in:  ['fichiers js/* annotes @domain tracking'],
    out: ['backend analytics (repo komerce-backend, si applicable)'],
  },

  files: {
    js: [
      '../js/b-tracking.js',
    ],
  },

  docs: [],

  contract: {
    exposes: [],
    // Migré depuis exposes (audit 2026-07-06, lot UNPARSEABLE) : export JS
    // interne, pas une route HTTP.
    internalApi: [
      'b-tracking.js / suivi de commande',
    ],
    consumes: [
      'auth — b-tracking.js importe b-phone.js',
      'boutique — b-tracking.js importe b-cart-core.js, b-utils.js',
    ],
  },

  authority: 'boutique — tout changement de perimetre de ce domaine doit etre reflete ici.',

  invariants: [
    'tout fichier js/* portant @domain tracking doit etre liste dans files.js de ce manifeste',
  ],

};
