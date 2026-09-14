/**
 * @feature       sourcing
 * @type          feature
 * @domain        sourcing
 * @status        production
 * @owner         backend-core
 * @since         2026-07 (extrait de logistics — Lot O1.3, Business Feature Ontology Refactor)
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 */
'use strict';

module.exports = {

  // ── Identite ─────────────────────────────────────────────────────────────
  name:     'sourcing',
  type:     'feature',
  domain:   'sourcing',
  status:   'production',
  owner:    'backend-core',
  since:    '2026-07',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  classification: {
    "axis": "business",
    "kind": "business-feature",
    "decision": "feature-autonome",
    "signals": {
      "ownsTables": true,
      "ownsLifecycle": true,
      "activeService": true,
      "multiConsumer": true,
      "ownsMigrations": true,
      "externalSideEffect": "none",
      "surface": "api+service"
    },
    "rationale": [
      "possède sourcing_candidates, leur journal et le lifecycle raw_imported vers décision/import catalogue ; la fiche produit finale reste à catalog",
      "porte ses migrations et invariants de qualification/rejouabilité tout en consommant catalog et pricing sans reprendre leur ownership"
    ]
  },

  service: 'Identifier, qualifier et arbitrer des opportunités fournisseur ou produit ' +
           '(scan pricing, décision garder/watchlist/rejeter) avant leur entrée dans le catalogue.',

  perimeter: {
    in: [
      'ingestion catalogue fournisseur brut (dispatch CSV / saisie manuelle / API)',
      'shadow ingestion NormalizedSupplierProduct V2 vers Source/Capture/Observation, sans bascule d autorite',
      'Candidate Retrieval et Resolution shadow des Observations vers Canonical Product/Offer/Unit sans Selection',
      'preuve multi-source read-only avant essai de projection canonique Product',
      'projection canonique Product read-only en shadow, consensus-only avec conflits préservés',
      'comparaison parallèle read-only entre projection Product canonique et autorité historique reliée',
      'scan de candidat (pricing-engine) et décision garder / watchlist / rejeter',
      'cycle de vie du candidat : raw_imported → normalized → scanned → imported_to_catalog / rejected / watchlist',
      'transformation candidat → produit (déclenchement, pas la fiche catalogue elle-même)',
      'journal d\'événements candidat (audit, correction manuelle, scan, décision)',
      'persistence lifecycle des sourcing_candidates issus des imports catalog via frontière owner dédiée',
    ],
    out: [
      'connecteurs fournisseur eux-mêmes et normalisation NormalizedSupplierProduct (feature catalog, ' +
        'services/suppliers/connectors/* + services/supplier-catalog-scanner.js restent dans catalog — ' +
        'leur service principal reste l\'entrée catalogue, pas la qualification)',
      'orchestration d\'import idempotent supplier_catalog_imports (feature catalog, ' +
        'services/suppliers/catalog-import-orchestrator.js)',
      'enrichissement FR de la fiche produit après import (feature catalog, catalog-enrichment)',
      'fiche produit elle-même une fois créée (feature catalog)',
      'moteur margin/rail admin economic-engine (routes/sourcing.js, services/sourcing-analysis.js, ' +
        'services/sourcing-mutations.js) — HOMONYME sans rapport : voir note ci-dessous',
      'calcul de prix (feature economic-engine, pricing-engine, consommé ici en lecture)',
      'Selection fournisseur, publication, exposition commerciale et commande fournisseur',
    ],
  },

  ambiguityNote: 'sourcing (cette feature, qualification candidats) != sourcing-engine ' +
    'admin margin/rail (economic-engine, routes/sourcing.js) — homonymes, domaines disjoints.',

  files: {
    middleware: [
      'middleware/require-sourcing-global-authority.js',
    ],
    migrations: [
      'migrations/041_sourcing_candidates.sql',
      'migrations/076_sourcing_candidates_unique.sql',
      'migrations/088_sourcing_standalone_fixes.sql',
      'migrations/102_sourcing_candidates_raw_payload.sql',
      'migrations/149_sourcing_workspace_business_refs.sql',
      'migrations/226_sourcing_observation_foundation.sql',
      'migrations/227_sourcing_resolution_foundation.sql',
    ],
    scripts: [
      'scripts/sourcing-shadow-proof-staging.js',
      'scripts/sourcing-product-projection-trial-staging.js',
      'scripts/sourcing-product-read-comparison-staging.js',
      'scripts/catalog-product-read-cutover-trial-staging.js',
    ],
    services: [
      'services/sourcing-candidate-import-service.js',
      'services/sourcing-observation-shadow-plan.js',
      'services/sourcing-observation-shadow-service.js',
      'services/sourcing-resolution-evidence.js',
      'services/sourcing-shadow-resolution-service.js',
      'services/sourcing-shadow-proof-service.js',
      'services/sourcing-canonical-product-projection.js',
      'services/sourcing-catalog-product-linkage.js',
      'services/sourcing-product-read-comparison.js',
      'services/catalog-product-read-cutover-trial.js',
      'services/sourcing-candidate-actions.js',
      'services/sourcing-workspace.js',
    ],
    routes: [
      'routes/sourcing-scanner.js',
      'routes/admin-sourcing-workspace.js',
    ],
    tests: [
      'tests/unit/sourcing-scanner.test.js',
      'tests/unit/sourcing-candidate-import-service.test.js',
      'tests/unit/sourcing-observation-shadow-plan.test.js',
      'tests/unit/sourcing-observation-shadow-service.test.js',
      'tests/unit/sourcing-resolution-evidence.test.js',
      'tests/unit/sourcing-shadow-resolution-service.test.js',
      'tests/unit/sourcing-shadow-proof-service.test.js',
      'tests/unit/sourcing-canonical-product-projection.test.js',
      'tests/unit/sourcing-catalog-product-linkage.test.js',
      'tests/unit/catalog-product-route-canary.test.js',
      'tests/unit/sourcing-product-read-comparison.test.js',
      'tests/unit/catalog-product-read-cutover-trial.test.js',
      'tests/unit/admin-sourcing-workspace-route.test.js',
      'tests/unit/sourcing-workspace.test.js',
      'tests/unit/sourcing-candidate-actions.test.js',
      'tests/unit/require-sourcing-global-authority.test.js',
      'tests/unit/sourcing-observation-foundation-migration.test.js',
      'tests/unit/sourcing-resolution-foundation-migration.test.js',
    ],
  },

  repos: {
    backend: 'routes/sourcing-scanner.js + services/sourcing-candidate-import-service.js ; ' +
             'le service owner persiste le lifecycle sourcing_candidates pour les imports déclenchés par catalog.',
  },

  db: {
    tables: [
      'sourcing_candidates: RW!',
      'sourcing_candidate_events: RW!',
      'sourcing_sources: RW!',
      'sourcing_source_provides: W!',
      'sourcing_captures: RW!',
      'sourcing_observations: RW!',
      'sourcing_observation_evidence: RW!',
      'sourcing_canonical_entities: RW!',
      'sourcing_canonical_entity_refs: W!',
      'sourcing_match_proposals: W!',
      'sourcing_resolution_decisions: RW!',
      'sourcing_resolution_bindings: RW!',
      'supplier_catalog_imports: R',
      'products: R',
      'catalog_media: R',
      'product_variants: R',
      'product_skus: R',
      'product_sku_media: R',
    ],
  },

  security: {
    status: 'CONFIRMED',
    authedRoutesDetected: 23,
    totalRoutes: 23,
    note: 'Toutes les routes /api/admin/sourcing/* exigent authenticate + role admin (requireAdminOrFounder).',
  },

  contract: {
    exposes: [
      'GET /api/admin/sourcing/connectors',
      'POST /api/admin/sourcing/catalogs/import',
      'GET /api/admin/sourcing/catalogs',
      'GET /api/admin/sourcing/candidates',
      'GET /api/admin/sourcing/candidates/:id',
      'PUT /api/admin/sourcing/candidates/:id',
      'POST /api/admin/sourcing/candidates/:id/scan',
      'POST /api/admin/sourcing/candidates/scan-batch',
      'POST /api/admin/sourcing/candidates/:id/import-product',
      'POST /api/admin/sourcing/candidates/:id/reject',
      'POST /api/admin/sourcing/candidates/:id/watchlist',
      'GET /api/admin/workspaces/sourcing',
      'POST /api/admin/workspaces/sourcing/imports',
      'POST /api/admin/workspaces/sourcing/products/:productRef/update',
      'POST /api/admin/workspaces/sourcing/candidates/:candidateRef/update',
      'POST /api/admin/workspaces/sourcing/candidates/:candidateRef/scan',
      'POST /api/admin/workspaces/sourcing/candidates/:candidateRef/promote',
      'POST /api/admin/workspaces/sourcing/candidates/:candidateRef/watchlist',
      'POST /api/admin/workspaces/sourcing/candidates/:candidateRef/reject',
      'POST /api/admin/workspaces/sourcing/suppliers',
      'POST /api/admin/workspaces/sourcing/suppliers/:partnerRef/update',
      'POST /api/admin/workspaces/sourcing/suppliers/:partnerRef/deactivate',
      'POST /api/admin/workspaces/sourcing/suppliers/:partnerRef/activate',
    ],
    internalApi: [
      { fn: 'upsertCandidateFromCatalogImport', file: 'services/sourcing-candidate-import-service.js' },
      { fn: 'archiveMissingCandidatesFromCatalogImport', file: 'services/sourcing-candidate-import-service.js' },
      { fn: 'recordCatalogImportObservationsShadow', file: 'services/sourcing-observation-shadow-service.js' },
      { fn: 'resolveCaptureShadow', file: 'services/sourcing-shadow-resolution-service.js' },
      { fn: 'collectShadowProof', file: 'services/sourcing-shadow-proof-service.js' },
      { fn: 'collectCanonicalProductProjections', file: 'services/sourcing-canonical-product-projection.js' },
      { fn: 'collectCanonicalProductProjectionById', file: 'services/sourcing-canonical-product-projection.js' },
      { fn: 'findCanonicalProductIdsForCatalogProduct', file: 'services/sourcing-catalog-product-linkage.js' },
      { fn: 'applyCanonicalSourceReadSeam', file: 'services/catalog-product-read-cutover-trial.js' },
      { fn: 'collectProductReadComparison', file: 'services/sourcing-product-read-comparison.js' },
      { fn: 'collectCatalogProductReadCutoverTrial', file: 'services/catalog-product-read-cutover-trial.js' },
    ],
    consumes: [
      'infrastructure (dépendance technique transversale observée : DB, logger, helpers ou bootstrap possédés par infrastructure)',
      'catalog (connecteurs fournisseur, catalog-import-orchestrator, catalog-enrichment, ' +
        'supplier-catalog-scanner pour le scan pricing, catalog-candidate-product-service pour créer le brouillon products, ' +
        'et catalog-promotion.js pour promouvoir normalized_source_contract V2 vers catalog_media/product_variants/' +
        'product_skus/product_sku_media dans la transaction de POST .../import-product)',
      'economic-engine (pricing-engine.loadGlobalConfig — config de scan)',
      'auth',
      'dashboard (registre partenaires partagé via partner-admin-service ; 4E filtre strictement partner_type=sourcing)',
    ],
  },

  debt: {
    knownGaps: [
      { gap: 'ONTOLOGY_GAP — migrations/041_sourcing_candidates.sql crée conjointement supplier_catalog_imports et sourcing_candidates/sourcing_candidate_events.',
        risk: 'aucun impact runtime — documentaire uniquement.' },
      { gap: 'ONTOLOGY_GAP — supplier-catalog-scanner.js et catalog-import-orchestrator.js restent dans catalog malgré leur rôle dans le pipeline sourcing.',
        risk: 'aucun — frontière runtime explicite.' },
    ],
  },

  authority: 'backend-core — tout changement du cycle de vie candidat (states, transitions) ' +
             'doit être validé par le propriétaire de routes/sourcing-scanner.js',

  invariants: [
    'un candidat exclu (rejet manuel ou auto-exclusion douane/légale) n\'est jamais ré-importable (ING-5 verrou 1)',
    'une devise hors whitelist (AED, EUR, USD, KMF) ne produit jamais de purchase_price_kmf faux (ING-5 verrou 2)',
    'un candidat déjà importé (état imported_to_catalog + product_id) ne peut pas être ré-importé',
    'le payload fournisseur brut est conservé intégralement (raw_payload) pour rejouabilité',
    'une ré-observation V2 crée une nouvelle Capture et de nouvelles Observations ; elle ne mute jamais une Observation existante',
    'un échec du writer shadow ne bloque jamais l import sourcing_candidates autoritatif',
    'Candidate Retrieval réduit l espace de comparaison mais ne décide jamais seul de l identité',
    'Resolution ne compare jamais prix, stock, fret ou délai et ne sélectionne aucun fournisseur',
    'un LINK automatique PR 3 exige une preuve forte non contradictoire : source_ref exacte, contexte Offer même Source+parent, ou GTIN exact',
    'le Product projection trial reste ferme tant que la preuve multi-source n est pas invariant-safe et cross-source',
    'la projection Product shadow ne projette aucun prix, devise, stock, MOQ, délai, sellable_unit ou Supplier Order Identity',
    'un conflit descriptif multi-source est préservé explicitement et ne devient jamais une valeur canonique silencieuse',
    'la comparaison Product parallèle ne fabrique jamais un lien catalogue : seul sourcing_candidates.product_id autorise la parité products',
    'l absence de produit catalogue relié bloque le gate de cutover sans invalider la projection canonique',
  ],

};
