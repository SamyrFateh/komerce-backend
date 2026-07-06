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
      // ── Tranche raffinerie (DOCTRINE_CATALOGUE, 2026-07) ──
      'raffinerie catalogue : donnee source EN conservee, eligibilite douane/transport (catalog_exclusions), enrichissement FR, overrides traces, approbation humaine unique',
      'glossaire metier EN->FR (catalog_glossary)',
      // ── K-4 (DOCTRINE_CATALOGUE §6, 2026-07) ──
      'file d\'approbation admin (etage 6) : approve/reject/override en un ecran, seul point de validation humaine avant lifecycle_status=\'active\'',
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
    ],
    docs: [
      'docs/doctrine/DOCTRINE_CATALOGUE.md',
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
      // K-4 — file d'approbation (etage 6)
      'dashboards/admin/js/views/CatalogApprovalView.js',
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
      'tests/unit/catalog-eligibility.test.js',
      'tests/unit/scan-engine-content-verification.test.js',
      'tests/unit/scan-engine-extras.test.js',
      'tests/unit/catalog-public-view.test.js',
      'tests/unit/catalog-enrichment.test.js',
      'tests/unit/catalog-overrides.test.js',
      'tests/unit/catalog-approval.test.js',
    ],

},

  // ── Dépôts ───────────────────────────────────────────────────────────────
  repos: {
    backend: 'services/ + routes/ ci-dessus',
    boutique: 'catalogue vivant, cartes produit et modal produit catalogue — gouvernés en détail par docs/boutique/BOUTIQUE_COMPONENT_OWNERSHIP.md et docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md',
  },

  // ── Contrat d'interface ──────────────────────────────────────────────────
  // ── Tables DB (inféré, audit 2026-07-06, §axe2) ─────────────────────────
  // Généré par parsing réel des appels .query() (pas un grep de mots) :
  // R = lu par cette feature, W = écrit par cette feature, RW = les deux.
  // Une table listée ici pour PLUSIEURS features est une vraie propriété
  // partagée détectée dans le code, pas un artefact de méthode — à
  // documenter explicitement si volontaire, ou à re-scoper sinon.
  // Champ auto-généré : à corriger à la main si une requête dynamique
  // (nom de table construit par variable) a échappé au scan.
  db: {
    tables: [
      'alerts: W',
      'boutique_categories: RW',
      'boutique_subcategories: RW',
      'catalog_exclusions: R',
      'catalog_field_overrides: RW',
      'catalog_glossary: R',
      'order_items: R',
      'orders: R',
      'price_history: W',
      'product_variants: RW',
      'products: RW',
      'sourcing_candidate_events: W',
      'sourcing_candidates: W',
      'supplier_catalog_imports: W',
    ],
  },

  contract: {
    exposes: [
      'GET /api/products',
      'GET /api/admin/catalog/approval-queue',
      'POST /api/admin/catalog/approval-queue/:id/approve',
      'POST /api/admin/catalog/approval-queue/:id/reject',
      'POST /api/admin/catalog/approval-queue/:id/override',
      // Rapatriées depuis le route-registry (audit 2026-07-06, lot interface-inverse)
      // — routes réelles câblées via bootstrap/api-routes.js, jamais déclarées jusqu'ici.
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
      'GET /api/products/:id',
      'PUT /api/products/:id',
      'POST /api/products/:id/image',
      'POST /api/products/:id/images',
      'GET /api/products/:id/variants',
      'PUT /api/products/:id/variants',
      'DELETE /api/products/:id/variants/:variantId',
      'GET /api/products/categories',
      'GET /api/products/subcategories',
    ],
    consumes: ['economic-engine (prix calcule)',
      'shared-cart (ne pas reutiliser la modal catalogue pour la fiche snapshot)',
      'auth',
    ],
  },

  // ── Dette assumée / documentée ────────────────────────────────────────────
  // (audit 2026-07-06, §2a/§2b — reclassé après vérification empirique : ce
  // n'est pas un simple "jamais construit", c'est un contrat rendu obsolète
  // par la refonte K-4, ce qui change la décision à prendre.)
  debt: {
    knownGaps: [
      { gap: 'contrat historique "POST /api/admin/products/:id/publish" : aucune route ne ' +
             'le sert. Depuis la refonte K-4 (file d\'approbation, services/catalog-approval.js), ' +
             'la publication (lifecycle_status → \'active\') se fait exclusivement via ' +
             'POST /api/admin/catalog/approval-queue/:id/approve (ou :id/override), jamais ' +
             'par un endpoint /publish dédié.',
        risk: 'aucun — le mécanisme de publication existe et est couvert par le contrat ' +
              'ci-dessus ; la ligne obsolète documentait une intention pré-K-4 abandonnée. ' +
              'À retirer définitivement du manifeste dès confirmation par le propriétaire ' +
              'de la feature qu\'aucun appelant n\'attend encore /publish.',
      },
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — tout nouveau connecteur fournisseur doit etre valide par le proprietaire de normalized-product.js ; toute modification modal catalogue doit suivre docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    'un produit publie a toujours passe product-publication-guard.js',
    'jamais de creation produit par formulaire vide : tout entre par un connecteur (le manuel EST un connecteur)',
    'la donnee source (name_source, EN) ne se perd jamais : retraduction + litiges fournisseur',
    'toute retouche manuelle est un override trace (catalog_field_overrides), jamais une edition de la fiche generee',
    'la boutique ne lit que les champs publies : les champs de cuisine (source, content_source...) lui sont invisibles',
    'le prompt d\'enrichissement est du code : versionne dans le depot (PROMPT_VERSION), chaque run trace dans catalog_enrichment_runs, un echec IA ne bloque jamais un import',
    'la modal produit affiche le catalogue vivant et ne doit pas servir de fiche snapshot panier partage',
    'le parcours mobile Voir en grand appartient a b-modal-image-ux.js et modal-media.css',
    'aucune fiche candidate issue du pipeline (connector_raw/ai_enriched) ne passe lifecycle_status=\'active\' sans etre passee par la file d\'approbation (etage 6, services/catalog-approval.js) — meme si needs_review est faux',
  ],

};
