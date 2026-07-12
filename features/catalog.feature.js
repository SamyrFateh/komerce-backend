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
  service: 'Raffiner les donnees fournisseur en catalogue canonique, publier les unites vendables et exposer un contrat detail produit stable a la Boutique.',

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'connecteurs fournisseurs (CSV, API, manuel, Noon)',
      'publication et audit prix produit',
      'categories boutique admin',
      'catalogue vivant Boutique : grille, cartes produit, ouverture fiche produit',
      'catalogue canonique : produit, medias publics, axes d options descriptifs et unites vendables SKU',
      'contrat detail produit public : identity, pricing, media, option_axes, sellable_units et delivery_options deja resolues par leurs autorites',
      'modal produit catalogue : contrat d affichage, etat de selection SKU unique, rendu produit, media, lightbox mobile et suggestions',
      // ── Tranche raffinerie (DOCTRINE_CATALOGUE, 2026-07) ──
      'raffinerie catalogue : donnee source EN conservee, eligibilite douane/transport (catalog_exclusions), enrichissement FR, overrides traces, approbation humaine unique',
      'glossaire metier EN->FR (catalog_glossary)',
      // ── K-4 (DOCTRINE_CATALOGUE §6, 2026-07) ──
      'file d approbation admin (etage 6) : approve/reject/override en un ecran, seul point de validation humaine avant lifecycle_status=active',
    ],
    out: [
      'calcul du prix final et valorisation transport (feature economic-engine)',
      'decision de rail, routing et eligibilite logistique dynamique (feature logistics)',
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
      'services/suppliers/connectors/_connector-utils.js',
      'services/suppliers/connectors/noon-connector.js',
      'services/supplier-catalog-scanner.js',
      'services/suppliers/catalog-import-orchestrator.js',
      'services/catalog-eligibility.js',
      'services/catalog-public-view.js',
      'services/catalog-enrichment.js',
      'services/prompts/catalog-enrichment.prompt.js',
      'services/catalog-overrides.js',
      'services/catalog-approval.js',
    ],
    migrations: [
      'migrations/098_catalog_refinery_foundation.sql',
      'migrations/100_catalog_enrichment_runs.sql',
      'migrations/101_variant_images.sql',
      'migrations/104_product_skus.sql',
    ],
    docs: [
      'docs/doctrine/DOCTRINE_CATALOGUE.md',
      'docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md',
      'docs/specs/DECISION_MODELE_STOCK_SKU.md',
    ],
    routes: [
      'routes/products.js',
      'routes/admin-boutique-categories.js',
      'routes/categories.js',
      'routes/admin/catalog-approval.js',
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
      // Backfill gouvernance globale : header @komerce-arch domain=catalog confirme
      // (docs/BOUTIQUE_360.json) — schema/navigation categories, perimetre categories
      // deja declare ci-dessus en perimeter.in.
      'js/shop-schema.js',
      'js/b-pager.js',
      'js/b-subcat.js',
      // Lot O4 (cross-repo feature coverage) : ecart factuel comble — ces 2
      // fichiers sont declares par boutique/features/catalog.feature.js
      // (canonicalFeature: 'catalog') mais n'etaient pas encore revendiques
      // ici, ce qui les faisait apparaitre en TECHNICAL-NODE-WITHOUT-BUSINESS-OWNERSHIP.
      'js/b-cart-product-open-style.js',
      'css/hero.css',
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
      // K-4 — file d approbation (etage 6)
      'dashboards/admin/js/views/CatalogApprovalView.js',
    ],
    tests: [
      'tests/unit/admin-boutique-categories.test.js',
      'tests/unit/api-connector-base.test.js',
      'tests/unit/categories-cache.test.js',
      'tests/unit/categories.test.js',
      'tests/unit/connector-utils.test.js',
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
      'tests/unit/catalog-eligibility.test.js',
      'tests/unit/scan-engine-content-verification.test.js',
      'tests/unit/scan-engine-extras.test.js',
      'tests/unit/catalog-public-view.test.js',
      'tests/unit/catalog-enrichment.test.js',
      'tests/unit/catalog-enrichment-extended.test.js',
      'tests/unit/catalog-enrichment-fixtures.js',
      'tests/unit/catalog-overrides.test.js',
      'tests/unit/catalog-approval.test.js',
    ],
  },

  // ── Depots ───────────────────────────────────────────────────────────────
  repos: {
    backend: 'services/ + routes/ ci-dessus',
    boutique: 'catalogue vivant, cartes produit et modal produit catalogue — gouvernes en detail par docs/boutique/BOUTIQUE_COMPONENT_OWNERSHIP.md et docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md',
  },

  // ── Tables DB ────────────────────────────────────────────────────────────
  db: {
    tables: [
      'alerts: W',
      'boutique_categories: RW',
      'boutique_subcategories: RW',
      'catalog_exclusions: R',
      'catalog_field_overrides: RW',
      'catalog_glossary: R',
      'catalog_enrichment_runs: W',
      'order_items: R',
      'orders: R',
      'price_history: W',
      'product_skus: RW',
      'product_variants: RW',
      'products: RW',
      'sourcing_candidate_events: W',
      'sourcing_candidates: RW',
      'supplier_catalog_imports: W',
    ],
  },

  security: {
    status: 'CONFIRMED_MIXED',
    authedRoutesDetected: 21,
    totalRoutes: 26,
    note: 'Catalogue public en lecture ; mutations produit, SKU, overrides et approbation restent protegees admin. La projection publique detail est whitelistée par catalog-public-view / contrat detail.',
  },

  contract: {
    exposes: [
      'GET /api/products',
      'GET /api/products/:id',
      'GET /api/admin/catalog/approval-queue',
      'POST /api/admin/catalog/approval-queue/:id/approve',
      'POST /api/admin/catalog/approval-queue/:id/reject',
      'POST /api/admin/catalog/approval-queue/:id/override',
      'GET /api/admin/boutique-categories',
      'POST /api/admin/boutique-categories',
      'DELETE /api/admin/boutique-categories/:key',
      'GET /api/admin/boutique-categories/:key',
      'PUT /api/admin/boutique-categories/:key',
      'GET /api/admin/boutique-categories/:key/subcategories',
      'POST /api/admin/boutique-categories/:key/subcategories',
      'DELETE /api/admin/boutique-categories/:key/subcategories/:subKey',
      'PUT /api/admin/boutique-categories/:key/subcategories/:subKey',
      'GET /api/categories',
      'POST /api/products',
      'DELETE /api/products/:id',
      'PUT /api/products/:id',
      'POST /api/products/:id/image',
      'POST /api/products/:id/images',
      'GET /api/products/:id/variants',
      'PUT /api/products/:id/variants',
      'DELETE /api/products/:id/variants/:variantId',
      'GET /api/products/:id/skus',
      'GET /api/products/:id/skus/readiness',
      'POST /api/products/:id/skus',
      'DELETE /api/products/:id/skus/:skuId',
      'GET /api/products/categories',
      'GET /api/products/subcategories',
    ],
    consumes: [
      'economic-engine (prix produit et valorisation commerciale transport)',
      'logistics (rails et eligibilite transport ; le catalog ne decide jamais le rail)',
      'shared-cart (ne pas reutiliser la modal catalogue pour la fiche snapshot)',
      'auth',
    ],
  },

  // ── Dette assumee / documentee ──────────────────────────────────────────
  debt: {
    knownGaps: [
      {
        gap: 'contrat historique POST /api/admin/products/:id/publish : aucune route ne le sert. Depuis K-4, la publication se fait par la file d approbation.',
        risk: 'aucun — mecanisme remplace et couvert ; retirer toute reference historique restante lorsqu elle est rencontree.',
      },
      {
        gap: 'le contrat fournisseur normalise v1 est encore plat et ne preserve pas explicitement media[], option_axes[] et sellable_units[] de sources riches.',
        risk: 'perte structurelle en amont puis reconstruction UI heuristique ; chantier PDC-1 gouverne par DOCTRINE_PRODUCT_DETAIL_CONTRACT.md.',
      },
      {
        gap: 'la modal lit encore le produit brut dans plusieurs modules et modal-view-model.js ne possede pas encore seul l etat derive de selection.',
        risk: 'double intelligence mobile/desktop et logique combo dispersee ; chantiers PDC-3 a PDC-6.',
      },
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — normalized-product possede le contrat source ; catalog possede le catalogue canonique et le contrat detail public ; toute modification modal catalogue suit DOCTRINE_PRODUCT_DETAIL_CONTRACT.md et docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    'un produit publie a toujours passe product-publication-guard.js',
    'jamais de creation produit par formulaire vide : tout entre par un connecteur (le manuel EST un connecteur)',
    'la donnee source ne se perd jamais : une structure riche connue ne doit pas etre aplatie puis reconstruite par heuristique',
    'toute retouche manuelle est un override trace (catalog_field_overrides), jamais une edition de la fiche generee',
    'la boutique ne lit que les champs publies : les champs de cuisine source/content_source lui sont invisibles',
    'une unite vendable = un SKU ; product_variants decrit les axes et ne porte pas la verite de stock cible',
    'le contrat detail compose des faits et resultats proprietaires ; il ne recalcule ni pricing ni routing ni eligibilite rail',
    'le frontend ne decide jamais d un rail ni d un delai universel de livraison',
    'mobile et desktop consomment le meme etat de selection SKU ; un seul owner derive disponibilite et media courants',
    'le prompt d enrichissement est du code : versionne dans le depot, chaque run trace, un echec IA ne bloque jamais un import',
    'la modal produit affiche le catalogue vivant et ne doit pas servir de fiche snapshot panier partage',
    'le parcours mobile Voir en grand appartient a b-modal-image-ux.js et modal-media.css',
    'aucune fiche candidate issue du pipeline ne passe lifecycle_status=active sans etre passee par la file d approbation, meme si needs_review est faux',
  ],
};
