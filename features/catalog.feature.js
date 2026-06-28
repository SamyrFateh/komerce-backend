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
    ],
    routes: [
      'routes/products.js',
      'routes/admin-boutique-categories.js',
      'routes/categories.js',
    ],
    boutique: [
      'public/boutique/js/b-catalog.js',
      'public/boutique/js/b-catalog-desktop-enhancers.js',
      'public/boutique/js/b-product-open-contract.js',
      'public/boutique/js/product-store.js',
      'public/boutique/js/controllers/home-controller.js',
      'public/boutique/js/render/render-categories.js',
      'public/boutique/js/render/render-home-sections.js',
      'public/boutique/js/render/render-product-card.js',
      'public/boutique/js/view-models/product-card-model.js',
      'public/boutique/js/view-models/product-card-view-model.js',
      'public/boutique/js/b-modal.js',
      'public/boutique/js/b-modal-core.js',
      'public/boutique/js/b-modal-product.js',
      'public/boutique/js/b-modal-image-ux.js',
      'public/boutique/js/b-modal-social-proof.js',
      'public/boutique/js/b-modal-nav.js',
      'public/boutique/js/b-modal-suggestions.js',
      'public/boutique/js/b-modal-cart.js',
      'public/boutique/js/b-modal-desktop-enhancers.js',
      'public/boutique/js/b-pdp-curation-suggestions.js',
      'public/boutique/js/view-models/modal-view-model.js',
      'public/boutique/css/products.css',
      'public/boutique/css/categories.css',
      'public/boutique/css/modal-shell.css',
      'public/boutique/css/modal-media.css',
      'public/boutique/css/modal-product.css',
      'public/boutique/css/modal-product-lot4-hybrid.css',
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
