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
 * "boutique". GÃ©nÃ©rÃ© pour rattacher les modules JS existants (dÃ©jÃ  annotÃ©s
 * @domain boutique dans leur header) Ã  un manifest rÃ©el, afin que
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
  // sans identite metier unique â€” l'equivalent frontend du manifeste dash
  // `platform` (type frontend-transversal). Ne pas rattacher a un
  // canonicalFeature unique : ce serait un rattachement arbitraire, pas une
  // identite metier verifiee. ~19 fichiers catalog/shared-cart mal ranges ici
  // restent une dette connue et documentee (docs/BUSINESS_FEATURE_GRAPH.md
  // Â§O4), hors perimetre de deplacement de fichiers pour ce lot.
  canonicalFeature: null,
  sliceKind: 'frontend-transversal',

  service: "Coeur transversal de la boutique (orchestration UI, Ã©tat partagÃ©, panier/modal de base, utilitaires) â€” tout ce qui ne relÃ¨ve pas d'un domaine mÃ©tier dÃ©diÃ©.",

  perimeter: {
    in:  ['fichiers js/* annotÃ©s @domain boutique'],
    out: ['logique backend Ã©quivalente (repo komerce-backend)'],
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
      '../js/anti-fouc.js',
      '../js/hero-bootstrap.js',
      '../js/b-favs.js',
      '../js/b-group-cart-flow.js',
      '../js/b-mini-cart.js',
      '../js/b-nav.js',
      '../js/b-scroll-owner.js',
      '../js/b-store.js',
      '../js/b-utils.js',
      '../js/boutique.js',
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
      // b-modal-cart.test.js reste ici : son require() rÃ©el cible b-cart.js
      // (reste transversal), pas b-modal-cart.js (parti en shared-cart-modal)
      // â€” nom de fichier trompeur, vÃ©rifiÃ© avant classement, non renommÃ©.
      '../tests/unit/b-modal-cart.test.js',
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
    // MigrÃ© depuis exposes (audit 2026-07-06, lot UNPARSEABLE) : socle technique
    // transverse â€” exports JS internes, pas des routes HTTP.
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
      'auth â€” b-greeting.js appelle /api/auth/me',
      'catalog â€” b-cart.js, b-desktop-sidebar.js, b-nav.js, boutique.js importent b-catalog.js, shop-schema.js, b-pager.js, b-subcat.js, home-controller.js',
      'checkout â€” b-nav.js, boutique.js importent b-checkout.js',
      'modal-product â€” b-modal-core.js, b-modal.js importent b-modal-suggestions.js',
      'tracking â€” b-nav.js, boutique.js importent b-tracking.js',
      'wallet â€” b-nav.js importe b-wallet.js',
    ],
  },

  authority: 'boutique â€” tout changement de pÃ©rimÃ¨tre de ce domaine doit Ãªtre reflÃ©tÃ© ici.',

  invariants: [
    'tout fichier js/* portant @domain boutique doit Ãªtre listÃ© dans files.js de ce manifeste',
    'tout CSS transversal (tokens/reset/layout) ou gÃ©nÃ©rique boutique (cart/desktop/interactions) doit Ãªtre listÃ© dans files.css',
    'tout test unitaire/spec couvrant un fichier files.js de ce manifeste doit Ãªtre listÃ© dans files.tests',
  ],
};
