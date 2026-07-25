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

  // Lot O4 (cross-repo feature coverage) : ce manifeste couvre par nature un
  // socle transversal (bus, panier de base, utilitaires, orchestration UI)
  // sans identite metier unique — l'equivalent frontend du manifeste dash
  // `platform` (type frontend-transversal). Ne pas rattacher a un
  // canonicalFeature unique : ce serait un rattachement arbitraire, pas une
  // identite metier verifiee. ~19 fichiers catalog/shared-cart mal ranges ici
  // restent une dette connue et documentee (docs/BUSINESS_FEATURE_GRAPH.md
  // §O4), hors perimetre de deplacement de fichiers pour ce lot.
  canonicalFeature: null,
  sliceKind: 'frontend-transversal',

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
      '../js/b-cart-stepper-guard.js',
      '../js/b-cart.js',
      '../js/cart-product-summary.js',
      '../js/b-desktop-global-cart-access.js',
      '../js/b-desktop-sidebar.js',
      '../js/b-desktop-upgrade.js',
      '../js/b-favs.js',
      '../js/b-friendly-group-redirect.js',
      '../js/b-greeting.js',
      '../js/b-group-cart-flow.js',
      '../js/b-home-premium-v1.js',
      '../js/b-mini-cart.js',
      '../js/b-modal-cart.js',
      '../js/b-modal-core.js',
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
      '../tests/e2e/modal.spec.js',
      '../tests/e2e/cart.spec.js',
      '../tests/e2e/checkout.spec.js',
      '../tests/e2e/group.spec.js',
      '../tests/e2e/catalog.spec.js',
      '../tests/e2e/resilience.spec.js',
      '../tests/e2e/render-integrity.spec.js',
      '../tests/contracts.spec.js',
      '../tests/unit/b-bus.test.js',
      '../tests/unit/b-friendly-group-redirect.test.js',
      '../tests/unit/b-modal-cart.test.js',
      '../tests/unit/b-share-phone-guard.test.js',
      '../tests/unit/boutique-core.unit.test.js',
      '../tests/unit/render-categories.test.js',
      '../tests/unit/setup.js',
    ],
  },

  docs: [
    'AUDIT-RESPONSIVE-UX-2026-06-11.md',
    'CORRECTIONS_APPLIQUEES.md',
    'CORRECTIONS_APPLIQUEES_HEADER_GREETING_2026-07-01.md',
    'CORRECTION_SW_v334.md',
    'README.md',
    'docs/BOUTIQUE_ARCHITECTURE.md',
    'docs/BOUTIQUE_ARCHITECTURE_LIVE.md',
    'docs/BOUTIQUE_AUDIT_2026-06-15.md',
    'docs/BOUTIQUE_CARTOGRAPHY.md',
    'docs/BOUTIQUE_COMPONENT_OWNERSHIP.md',
    'docs/BOUTIQUE_CSS_INJECTION_DOCTRINE.md',
    'docs/BOUTIQUE_CSS_PIPELINE.md',
    'docs/BOUTIQUE_DESKTOP_OWNERSHIP_MAP.md',
    'docs/BOUTIQUE_DESKTOP_RECONCILIATION.md',
    'docs/BOUTIQUE_DESKTOP_REDESIGN_BRIEF.md',
    'docs/BOUTIQUE_DOCS_INDEX.md',
    'docs/BOUTIQUE_INVARIANTS_GATES.md',
    'docs/BOUTIQUE_OWNERSHIP_LIVE.md',
    'docs/BOUTIQUE_SIDE_CART_DOCTRINE.md',
    'docs/BOUTIQUE_SOURCE_OF_TRUTH.md',
    'docs/BOUTIQUE_SPRINTS_PLAN.md',
    'docs/BOUTIQUE_VISUAL_FIXES.md',
    'docs/BOUTIQUE_WOW_LAYER_ARCHITECTURE.md',
    'docs/CARTOGRAPHY_360_BOUTIQUE.md',
    'docs/HOTFIX_V3_README.md',
    'docs/HOTFIX_V4_README.md',
    'docs/MOBILE_BOUTIQUE_AUDIT.md',
    'docs/RUNBOOK_DEBLOCAGE_HOOKS.md',
    'docs/doctrine/FEATURE_DOCTRINE.md',
    'docs/doctrine/FEATURE_SLICE_DOCTRINE.md',
    'docs/doctrine/QUALITY_PYRAMID_DOCTRINE.md',
  ],

  contract: {
    exposes: [],
    // Migré depuis exposes (audit 2026-07-06, lot UNPARSEABLE) : socle technique
    // transverse — exports JS internes, pas des routes HTTP.
    internalApi: [
      'bus (b-bus.js)',
      'store / dom / state (b-store.js)',
      'utils / fmt / sanitize / apiGet / apiPost (b-utils.js)',
      'scroll-owner / isDesktop (b-scroll-owner.js)',
      'cart-core / showToast / cartTotal / cartQty (b-cart-core.js)',
      'cart / openCart / closeCart / renderCart / clearCart (b-cart.js)',
      'cart-stepper-guard / installCartStepperGuard (b-cart-stepper-guard.js)',
      'modal / openModal (b-modal.js)',
    ],
    consumes: [
      'auth — b-greeting.js appelle /api/auth/me',
      'catalog — b-cart.js, b-desktop-sidebar.js, b-nav.js, boutique.js importent b-catalog.js, shop-schema.js, b-pager.js, b-subcat.js, home-controller.js',
      'checkout — b-nav.js, boutique.js importent b-checkout.js',
      'modal-product — b-modal-core.js, b-modal.js importent b-modal-suggestions.js',
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
