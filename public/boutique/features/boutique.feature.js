/**
 * @feature       boutique
 * @type          transversal
 * @domain        boutique
 * @status        production
 * @owner         boutique
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      scripts/feature-registry-check.js
 *
 * Alias historique de composition. Le split P3 a retiré tout ownership de
 * source active ; Git conserve l'ancien fourre-tout.
 */
'use strict';

module.exports = {
  name: 'boutique',
  type: 'transversal',
  domain: 'boutique',
  status: 'production',
  owner: 'boutique',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',
  canonicalFeature: null,
  sliceKind: 'frontend-transversal',

  service: 'Alias de compatibilité documentaire de la composition Boutique.',
  perimeter: {
    in: ['tests transverses historiques et bundles générés'],
    out: ['ownership de code source, état applicatif et règles métier'],
  },

  files: {
    dist: [
      '../css/dist/base.css',
      '../css/dist/desktop.css',
    ],
    tests: [
      '../tests/e2e/modal.spec.js',
      '../tests/e2e/cart.spec.js',
      '../tests/e2e/checkout.spec.js',
      '../tests/e2e/group.spec.js',
      '../tests/e2e/catalog.spec.js',
      '../tests/e2e/resilience.spec.js',
      '../tests/e2e/render-integrity.spec.js',
      '../tests/contracts.spec.js',
      '../tests/unit/b-bus.test.js',
      '../tests/unit/b-modal-cart.test.js',
      '../tests/unit/boutique-core.unit.test.js',
      '../tests/unit/render-categories.test.js',
      '../tests/unit/setup.js',
    ],
  },

  docs: [],
  contract: {
    exposes: [],
    internalApi: [],
    consumes: [
      'platform-ops — socle et shell techniques',
      'orders — panier personnel et suivi commande',
      'catalog — découverte produit',
      'shared-cart — panier partagé',
    ],
  },
  authority: 'aucune autorité de fichier source ; les slices canoniques sont propriétaires.',
  invariants: [
    'aucun fichier source js ou css non généré ne revient dans ce manifeste',
    'le nombre total d arêtes files.* reste inférieur ou égal à 15',
  ],
};
