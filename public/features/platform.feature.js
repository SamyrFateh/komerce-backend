/**
 * @feature       platform
 * @type          frontend-transversal
 * @domain        platform
 * @status        production
 * @owner         dashboards
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      scripts/feature-registry-check.js
 */
'use strict';

module.exports = {

  name:     'platform',
  type:     'frontend-transversal',
  domain:   'platform',
  status:   'production',
  owner:    'dashboards',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  service: "Infrastructure transversale dashboards (auth-guard, service worker, composants colis partages, QR viewer).",

  perimeter: {
    in:  ['js/*, sw.js — utilitaires partages hors admin/'],
    out: ['vues admin (consomment ces utilitaires)'],
  },

  files: {
    js: [
      '../js/auth-guard.js',
      '../js/parcel-components.js',
      '../js/qr-viewer.js',
      '../sw.js',
    ],
  },

  contract: {
    exposes:  [],
    consumes: [],
  },

  authority: 'dashboards — tout changement de perimetre de ce domaine doit etre reflete ici.',

  invariants: [
    'tout fichier js/* ou sw.js hors admin/ doit etre declare ici',
  ],

};
