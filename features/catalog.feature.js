/**
 * @feature       catalog
 * @type          feature
 * @domain        catalog
 * @status        production
 * @owner         backend-core
 * @since         2025-09
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 */
'use strict';

module.exports = {

  // ── Identite ─────────────────────────────────────────────────────────────
  name:     'catalog',
  type:     'feature',   // feature | transversal
  domain:   'catalog',
  status:   'production',   // draft | staging | production | deprecated
  owner:    'backend-core',
  since:    '2025-09',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  // ── Service rendu ────────────────────────────────────────────────────────
  service: 'Publier un produit fournisseur dans la boutique, avec ses connecteurs d\'import, son audit de prix et sa consultation catalogue.',

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'connecteurs fournisseurs (CSV, API, manuel, Noon)',
      'publication et audit prix produit',
      'categories boutique admin',
      'catalogue vivant Boutique : grille, cartes produit, ouverture fiche produit',
      'modal produit catalogue : rendu produit, media, lightbox mobile, suggestions et actions panier personnel',
    ],
    out: [
      'calcul du prix final (feature economic-engine)',
      'mise en avant / classement (feature recommendations)',
      'fiche snapshot lecture seule du panier partage (feature shared-cart)',
      'checkout final et paiement (features orders/payments)',
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  files: {
    utils: [
      'utils/categories-cache.js',
    ],
    services: [
      'services/product-publication-guard.js',
      'services/product-admin-service.js',
      'services/product-price-audit.js',
      'services/suppliers/normalized-product.js',
      'services/suppliers/connectors/api-connector.base.js',
      'services/suppliers/connectors/manual-connector.js',
      'services/suppliers/connectors/csv-connector.js',
      'services/suppliers/connectors/noon-connector.js',
      'services/supplier-catalog-scanner.js',
      'services/suppliers/catalog-import-orchestrator.js',
    ],
    routes: [
      'routes/products.js',
      'routes/admin-boutique-categories.js',
      'routes/categories.js',
    ],
    migrations: [
      'migrations/021_products_weight_kg.sql',
      'migrations/025_add_subcategory.sql',
      'migrations/042_sync_products_columns.sql',
      'migrations/061_boutique_categories.sql',
      'migrations/062_boutique_categories_seed.sql',
      'migrations/064_enrich_test_products.sql',
      'migrations/072_boutique_category_images.sql',
      'migrations/072a_boutique_category_images.sql',
      'migrations/072b_boutique_category_images.sql',
      'migrations/077_boutique_categories_image_theme.sql',
      'migrations/081_product_ref.sql',
      'migrations/082_fix_label_fr_mojibake.sql',
      'migrations/087_normalize_sourcing_duplicate_columns.sql',
      'migrations/088_sourcing_standalone_fixes.sql',
      'migrations/migrate-categories-v2.sql',
      'migrations/patch_variants.sql',
    ],
    scripts: [
      'scripts/migration-037-fix-products.js',
      'scripts/migration-038-replace-products.js',
      'scripts/migration-039-french-descriptions.js',
    ],
    boutique: [
      'js/b-catalog.js',
      'js/b-catalog-desktop-enhancers.js',
      'js/b-product-open-contract.js',
      'js/product-store.js',
      'js/controllers/home-controller.js',
      'js/render/render-categories.js',
      'js/render/render-home-sections.js',
      'js/render/render-product-card.js',
      'js/view-models/product-card-model.js',
      'js/view-models/product-card-view-model.js',
      'js/b-modal.js',
      'js/b-modal-core.js',
      'js/b-modal-product.js',
      'js/b-modal-image-ux.js',
      'js/b-modal-social-proof.js',
      'js/b-modal-nav.js',
      'js/b-modal-suggestions.js',
      'js/b-modal-cart.js',
      'js/b-modal-desktop-enhancers.js',
      'js/b-pdp-curation-suggestions.js',
      'js/view-models/modal-view-model.js',
      // Backfill gouvernance globale : header @komerce-arch domain=catalog confirmé
      // (docs/BOUTIQUE_360.json) — schéma/navigation catégories, périmètre "catégories"
      // déjà déclaré ci-dessus en perimeter.in.
      'js/shop-schema.js',
      'js/b-pager.js',
      'js/b-subcat.js',
      'css/products.css',
      'css/categories.css',
      'css/modal-shell.css',
      'css/modal-media.css',
      'css/modal-product.css',
      'css/modal-product-lot4-hybrid.css',
    ],
      dash: [
      // dashboards/admin views — Lot 4
      'dashboards/admin/js/views/SuppliersView.js',
      'dashboards/admin/js/views/SourcingView.js',
      'dashboards/admin/js/views/SourcingScannerView.js',
    ],
    tests: [
      'tests/unit/admin-boutique-categories.test.js',
      'tests/unit/api-connector-base.test.js',
      'tests/unit/categories-cache.test.js',
      'tests/unit/categories.test.js',
      'tests/unit/csv-connector.test.js',
      'tests/unit/manual-connector.test.js',
      'tests/unit/noon-connector.test.js',
      'tests/unit/normalized-product.test.js',
      'tests/unit/product-admin-service.test.js',
      'tests/unit/product-price-audit.test.js',
      'tests/unit/product-publication-guard.test.js',
      'tests/unit/products.test.js',
      'tests/unit/supplier-catalog-scanner.test.js',
      'tests/unit/catalog-import-orchestrator.test.js',
      'tests/unit/scan-engine-content-verification.test.js',
      'tests/unit/scan-engine-extras.test.js',
      'tests/unit/scan-engine.test.js',
      'tests/unit/scan-operations.test.js',
    ],

},

  // ── Dépôts ───────────────────────────────────────────────────────────────
  repos: {
    backend: 'services/ + routes/ ci-dessus',
    boutique: 'catalogue vivant, cartes produit et modal produit catalogue — gouvernés en détail par docs/boutique/BOUTIQUE_COMPONENT_OWNERSHIP.md et docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md',
  },

  // ── Contrat d'interface ──────────────────────────────────────────────────
  docs: [
    'docs/SOURCING_ENGINE.md',
    'docs/SUPPLIERS_CONNECTORS.md',
    'docs/adr/ADR-005-suppliers-unifies.md',
    'docs/audit/FRONTEND_AUDIT.md',
    'docs/backend/COMPATIBILITE_SOURCING_VAGUE_3.md',
    'docs/backend/COUTURE_SIMPLIFICATION.md',
    'docs/boutique/BOUTIQUE_ARCHITECTURE.md',
    'docs/boutique/BOUTIQUE_CATEGORY_NAVIGATION_REDESIGN.md',
    'docs/boutique/BOUTIQUE_COMPONENT_OWNERSHIP.md',
    'docs/boutique/BOUTIQUE_CSS_PIPELINE.md',
    'docs/boutique/BOUTIQUE_DESKTOP_REDESIGN_BRIEF.md',
    'docs/boutique/BOUTIQUE_DOCS_INDEX.md',
    'docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md',
    'docs/boutique/BOUTIQUE_PRODUCT_DISPLAY_CONTRACT.md',
    'docs/boutique/BOUTIQUE_WOW_LAYER_ARCHITECTURE.md',
    'docs/boutique/HOTFIX_V3_README.md',
    'docs/boutique/HOTFIX_V4_README.md',
    'docs/boutique/MOBILE_BOUTIQUE_AUDIT.md',
    'docs/boutique/MOBILE_BOUTIQUE_FIXES.md',
    'docs/boutique/README.md',
    'docs/boutique/ROADMAP_MODAL_TEMU.md',
    'docs/boutique/komerce-categories-design.md',
    'docs/chantier/FLOW_AUDIT_SOURCING_G5.md',
    'docs/specs/SPEC_BACKEND_VAGUE_3_VARIANTES_V2.md',
    'docs/specs/SPEC_SUR_MESURE_PAGE.md',
  ],

  contract: {
    exposes: [
      'GET /api/products',
      'POST /api/admin/products/:id/publish',
    ],
    consumes: ['economic-engine (prix calcule)',
      'shared-cart (ne pas reutiliser la modal catalogue pour la fiche snapshot)',
      'auth',
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — tout nouveau connecteur fournisseur doit etre valide par le proprietaire de normalized-product.js ; toute modification modal catalogue doit suivre docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    'un produit publie a toujours passe product-publication-guard.js',
    'la modal produit affiche le catalogue vivant et ne doit pas servir de fiche snapshot panier partage',
    'le parcours mobile Voir en grand appartient a b-modal-image-ux.js et modal-media.css',
  ],

};
