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
    css: [
      '../css/tokens.css',
      '../css/reset.css',
      '../css/layout.css',
      '../css/boutique-desktop.css',
      '../css/cart.css',
      '../css/interactions.css',
      '../css/dist/base.css',
      '../css/dist/desktop.css',
    ],
    scripts: [
      '../apply-komerce-cleanup.js',
    ],
    tests: [
      '../tests/boutique.spec.js',
      '../tests/contracts.spec.js',
      '../tests/unit/b-friendly-group-redirect.test.js',
      '../tests/unit/b-mobile-modal-v1.test.js',
      '../tests/unit/b-modal-cart.test.js',
      '../tests/unit/b-share-phone-guard.test.js',
      '../tests/unit/boutique-core.unit.test.js',
      '../tests/unit/render-categories.test.js',
      '../tests/unit/setup.js',
    ],
  },

  docs: [],

  contract: {
    exposes: [
      'bus (b-bus.js)',
      'store / dom / state (b-store.js)',
      'utils / fmt / sanitize / apiGet / apiPost (b-utils.js)',
      'scroll-owner / isDesktop (b-scroll-owner.js)',
      'cart-core / showToast / cartTotal / cartQty (b-cart-core.js)',
      'cart / openCart / closeCart / renderCart / clearCart (b-cart.js)',
      'modal / openModal (b-modal.js)',
    ],
    consumes: [
      'auth — b-greeting.js appelle /api/auth/me',
      'catalog — b-cart.js, b-desktop-sidebar.js, b-nav.js, boutique.js importent b-catalog.js, shop-schema.js, b-pager.js, b-subcat.js, home-controller.js',
      'checkout — b-nav.js, boutique.js importent b-checkout.js',
      'modal-product — b-modal-core.js, b-modal.js importent b-modal-suggestions.js',
      'shared-cart — b-modal-approche-c-hybrid.js, b-nav.js, boutique.js importent b-share-cart.js, b-group-view.js',
      'tracking — b-nav.js, boutique.js importent b-tracking.js',
      'wallet — b-nav.js importe b-wallet.js',
    ],
  },

  authority: 'boutique — tout changement de périmètre de ce domaine doit être reflété ici.',

  invariants: [
    'tout fichier js/* portant @domain boutique doit être listé dans files.js de ce manifeste',
    'tout CSS transversal (tokens/reset/layout) ou générique boutique (cart/desktop/interactions) doit être listé dans files.css',
    'tout test unitaire/spec couvrant un fichier files.js de ce manifeste doit être listé dans files.tests',
  ],

};
