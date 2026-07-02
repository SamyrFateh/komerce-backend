/**
 * @feature       legacy-control-tower
 * @type          feature
 * @domain        legacy-control-tower
 * @status        deprecated
 * @owner         dashboards
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      scripts/feature-registry-check.js
 */
'use strict';

module.exports = {

  name:     'legacy-control-tower',
  type:     'feature',
  domain:   'legacy-control-tower',
  status:   'deprecated',
  owner:    'dashboards',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  service: "Ancien control tower (v5/v6/v7) — conserve pour control-tower.html, supersede par dashboards/admin/.",

  perimeter: {
    in:  ['dashboards/admin-legacy/js/** — code legacy CT'],
    out: ['dashboards/admin/ (remplacement actif)'],
  },

  files: {
    js: [
      '../dashboards/admin-legacy/js/ct-api.js',
      '../dashboards/admin-legacy/js/ct-app-v6.js',
      '../dashboards/admin-legacy/js/ct-app-v7.js',
      '../dashboards/admin-legacy/js/ct-app.js',
      '../dashboards/admin-legacy/js/ct-notifications.js',
      '../dashboards/admin-legacy/js/ct-platform.js',
      '../dashboards/admin-legacy/js/ct-scenarios.js',
      '../dashboards/admin-legacy/js/ct-views-accounting.js',
      '../dashboards/admin-legacy/js/ct-views-action-center.js',
      '../dashboards/admin-legacy/js/ct-views-clients.js',
      '../dashboards/admin-legacy/js/ct-views-customs.js',
      '../dashboards/admin-legacy/js/ct-views-dashboard-radar.js',
      '../dashboards/admin-legacy/js/ct-views-economic-legacy.js',
      '../dashboards/admin-legacy/js/ct-views-economic.js',
      '../dashboards/admin-legacy/js/ct-views-hub-relais.js',
      '../dashboards/admin-legacy/js/ct-views-inventory.js',
      '../dashboards/admin-legacy/js/ct-views-pickup-secret.js',
      '../dashboards/admin-legacy/js/ct-views-pilotage-fin.js',
      '../dashboards/admin-legacy/js/ct-views-pilotage-op.js',
      '../dashboards/admin-legacy/js/ct-views-pilotage.js',
      '../dashboards/admin-legacy/js/ct-views-previsions.js',
      '../dashboards/admin-legacy/js/ct-views-pricing-strategy.js',
      '../dashboards/admin-legacy/js/ct-views-pricing-workshop.js',
      '../dashboards/admin-legacy/js/ct-views-pricing.js',
      '../dashboards/admin-legacy/js/ct-views-problems.js',
      '../dashboards/admin-legacy/js/ct-views-sales.js',
      '../dashboards/admin-legacy/js/ct-views-sante.js',
      '../dashboards/admin-legacy/js/ct-views-settings.js',
      '../dashboards/admin-legacy/js/ct-views-shared-carts.js',
      '../dashboards/admin-legacy/js/ct-views-simulator.js',
      '../dashboards/admin-legacy/js/ct-views-sourcing-scanner.js',
      '../dashboards/admin-legacy/js/ct-views-sourcing.js',
      '../dashboards/admin-legacy/js/ct-views-suppliers.js',
      '../dashboards/admin-legacy/js/ct-views-transitaire.js',
      '../dashboards/admin-legacy/js/ct-views-v6.js',
      '../dashboards/admin-legacy/js/ct-views-v7.js',
      '../dashboards/admin-legacy/js/ct-views.js',
    ],
  },

  docs: [],

  contract: {
    exposes:  [],
    consumes: [],
  },

  authority: 'dashboards — tout changement de perimetre de ce domaine doit etre reflete ici.',

  invariants: [
    'tout fichier legacy doit rester ici jusqu a sa suppression definitive',
  ],

};
