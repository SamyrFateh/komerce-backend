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
},

  // ── Dépôts ───────────────────────────────────────────────────────────────
  repos: {
    backend: 'services/ + routes/ ci-dessus',
    boutique: 'catalogue vivant, cartes produit et modal produit catalogue — gouvernés en détail par docs/boutique/BOUTIQUE_COMPONENT_OWNERSHIP.md et docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md',
  },

  // ── Contrat d'interface ──────────────────────────────────────────────────
  contract: {
    exposes: [
      'GET /api/products',
      'POST /api/admin/products/:id/publish',
    ],
    consumes: [
      'economic-engine (prix calcule)',
      'shared-cart (ne pas reutiliser la modal catalogue pour la fiche snapshot)',
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
