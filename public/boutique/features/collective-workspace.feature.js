/**
 * @feature       collective-workspace
 * @type          feature
 * @domain        collective-workspace
 * @status        production
 * @owner         boutique
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      scripts/feature-registry-check.js
 *
 * Manifeste niveau 0 (gouvernance fichiers) pour le domaine frontend
 * "collective-workspace". Généré pour rattacher les modules JS existants (déjà annotés
 * @domain collective-workspace dans leur header) à un manifest réel, afin que
 * scripts/feature-registry-check.js cesse de les compter en orphelins.
 */
'use strict';

module.exports = {

  name:     'collective-workspace',
  type:     'feature',
  domain:   'collective-workspace',
  status:   'production',
  owner:    'boutique',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  service: "Espace de travail collectif événementiel (vues manage/pay/public) pour la gestion partagée d'un événement.",

  perimeter: {
    in:  ['fichiers js/* annotés @domain collective-workspace'],
    out: ['logique backend équivalente (repo komerce-backend)'],
  },

  files: {
    js: [
      '../js/event-manage.js',
      '../js/event-pay.js',
      '../js/event-public.js',
    ],
    css: [
      '../css/event.css',
      '../css/dist/event.css',
    ],
    tests: [
      '../tests/unit/event-pay.test.js',
    ],
  },

  docs: [],

  contract: {
    exposes: [
      'event-manage.js / gestion workspace collectif',
      'event-pay.js / paiement collectif',
      'event-public.js / vue publique workspace',
    ],
    consumes: [
      'API — event-manage.js appelle /api/collective-workspaces/me/*',
      'API — event-pay.js appelle /api/collective-payments/*',
      'API — event-public.js appelle /api/collective-workspaces/public/*',
    ],
  },

  authority: 'boutique — tout changement de périmètre de ce domaine doit être reflété ici.',

  invariants: [
    'tout fichier js/* portant @domain collective-workspace doit être listé dans files.js de ce manifeste',
    'tout CSS/test des pages événement (event.css, dist/event.css) doit être listé dans files.css / files.tests',
  ],

};
