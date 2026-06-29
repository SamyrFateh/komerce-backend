/**
 * @feature       boutique
 * @type          feature
 * @domain        boutique
 * @status        production
 * @owner         boutique
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      scripts/feature-registry-check.js
 *
 * Manifeste niveau 0 (gouvernance fichiers) pour le domaine frontend
 * "boutique". Généré pour rattacher les modules JS existants (déjà annotés
 * @domain boutique dans leur header) à un manifest réel, afin que
 * scripts/feature-registry-check.js cesse de les compter en orphelins.
 */
'use strict';

module.exports = {

  name:     'boutique',
  type:     'feature',
  domain:   'boutique',
  status:   'production',
  owner:    'boutique',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  service: "Coeur transversal de la boutique (orchestration UI, état partagé, panier/modal de base, utilitaires) — tout ce qui ne relève pas d'un domaine métier dédié.",

  perimeter: {
    in:  ['fichiers js/* annotés @domain boutique'],
    out: ['logique backend équivalente (repo komerce-backend)'],
  },

  files: {
    js: [
      '../js/b-boutique-wow-style.js',
      '../js/b-bus.js',
      '../js/b-cart-core.js',
      '../js/b-cart-pill.js',
      '../js/b-cart.js',
      '../js/b-desktop-global-cart-access.js',
      '../js/b-desktop-sidebar.js',
      '../js/b-desktop-upgrade.js',
      '../js/b-favs.js',
      '../js/b-friendly-group-redirect.js',
      '../js/b-greeting.js',
      '../js/b-group-cart-flow.js',
      '../js/b-home-premium-v1.js',
      '../js/b-mini-cart.js',
      '../js/b-mobile-modal-v1.js',
      '../js/b-mobile-premium-v1.js',
      '../js/b-modal-approche-c-hybrid.js',
      '../js/b-modal-cart.js',
      '../js/b-modal-core.js',
      '../js/b-modal-desktop-enhancers.js',
      '../js/b-modal-image-ux.js',
      '../js/b-modal-nav.js',
      '../js/b-modal-product.js',
      '../js/b-modal-social-proof.js',
      '../js/b-modal.js',
      '../js/b-nav.js',
      '../js/b-scroll-owner.js',
      '../js/b-share-phone-guard.js',
      '../js/b-store.js',
      '../js/b-utils.js',
      '../js/boutique.js',
      '../js/card-config.js',
      '../js/komerce-api.js',
      '../js/main.js',
      '../js/render/render-categories.js',
      '../js/view-models/modal-view-model.js',
    ],
  },

  contract: {
    exposes:  [],
    consumes: [],
  },

  authority: 'boutique — tout changement de périmètre de ce domaine doit être reflété ici.',

  invariants: [
    'tout fichier js/* portant @domain boutique doit être listé dans files.js de ce manifeste',
  ],

};
