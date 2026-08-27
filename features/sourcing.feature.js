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
  type:     'feature',   // feature | transversal
  domain:   'sourcing',
  status:   'production',   // draft | staging | production | deprecated
  owner:    'backend-core',
  since:    '2026-07',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  // ── Service rendu ────────────────────────────────────────────────────────
  service: 'Identifier, qualifier et arbitrer des opportunités fournisseur ou produit ' +
           '(scan pricing, décision garder/watchlist/rejeter) avant leur entrée dans le catalogue.',

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'ingestion catalogue fournisseur brut (dispatch CSV / saisie manuelle / API)',
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
    ],
  },

  // ── Note de désambiguïsation (Lot O1.3) ─────────────────────────────────
  // "sourcing" désigne deux choses distinctes dans ce codebase, homonymes,
  // sans rapport métier :
  //   1. CETTE feature : qualification de candidats fournisseur avant
  //      catalogue (routes/sourcing-scanner.js, tables sourcing_candidates*).
  //   2. Le moteur margin/rail admin d'economic-engine (routes/sourcing.js,
  //      services/sourcing-analysis.js, services/sourcing-mutations.js) :
  //      analyse marge/poids/rail de transport sur les produits déjà en
  //      catalogue. N'écrit jamais sourcing_candidates. Reste dans
  //      economic-engine — non traité par ce lot (hors périmètre O1).
  // Ne pas fusionner les deux au prochain lot sans relire le code réel.
  ambiguityNote: 'sourcing (cette feature, qualification candidats) != sourcing-engine ' +
    'admin margin/rail (economic-engine, routes/sourcing.js) — homonymes, domaines disjoints.',

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  files: {
    middleware: [
      'middleware/require-sourcing-global-authority.js',
    ],
    migrations: [
      // 041 crée aussi supplier_catalog_imports (table catalog) dans le même
      // fichier — migration jointe catalog/sourcing à la création du pipeline
      // (avril 2026), non scindée depuis. Déclarée ici parce que sourcing_candidates
      // et sourcing_candidate_events en sont le contenu majoritaire ; catalog ne
      // déclare aucune migration pour son côté supplier_catalog_imports à ce jour
      // (aucun conflit de déclaration constaté) — voir ONTOLOGY_GAP livrable O1.3.
      'migrations/041_sourcing_candidates.sql',
      'migrations/076_sourcing_candidates_unique.sql',
      'migrations/088_sourcing_standalone_fixes.sql',
      'migrations/102_sourcing_candidates_raw_payload.sql',
      'migrations/149_sourcing_workspace_business_refs.sql',
    ],
    services: [
      'services/sourcing-candidate-import-service.js',
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
      'tests/unit/admin-sourcing-workspace-route.test.js',
      'tests/unit/sourcing-workspace.test.js',
      'tests/unit/sourcing-candidate-actions.test.js',
      'tests/unit/require-sourcing-global-authority.test.js',
    ],
  },

  // ── Dépôts ────────────────────────────────────────────────────────────────
  repos: {
    backend: 'routes/sourcing-scanner.js + services/sourcing-candidate-import-service.js ; ' +
             'le service owner persiste le lifecycle sourcing_candidates pour les imports déclenchés par catalog.',
  },

  // ── Tables DB ────────────────────────────────────────────────────────────
  // sourcing est le lifecycle owner unique de sourcing_candidates*.
  // catalog peut déclencher leur création/ré-import/archivage, mais passe par
  // services/sourcing-candidate-import-service.js : aucun SQL cross-owner.
  // Inversement, sourcing déclenche la création d'un produit catalog via
  // services/catalog-candidate-product-service.js sans écrire products.
  db: {
    tables: [
      'sourcing_candidates: RW!',        // OWNER (campagne WRITER-NOT-OWNER, 2026-08)
      'sourcing_candidate_events: RW!',  // OWNER (campagne WRITER-NOT-OWNER, 2026-08)
      'supplier_catalog_imports: R',    // W-via:catalog-import-orchestrator (feature catalog)
      // PDC-8 Lot 6 — import-product ouvre une transaction dédiée (db.getClient)
      // qui inclut les appels catalog owner dans la même transaction.
      'catalog_media: R',        // W-via:catalog-promotion (feature catalog)
      'product_variants: R',     // W-via:catalog-promotion (feature catalog)
      'product_skus: R',         // W-via:catalog-promotion (feature catalog), R pour la réconciliation
      'product_sku_media: R',    // W-via:catalog-promotion (feature catalog)
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

  // ── Dette assumée / documentée ────────────────────────────────────────────
  debt: {
    knownGaps: [
      { gap: 'ONTOLOGY_GAP — migrations/041_sourcing_candidates.sql crée conjointement ' +
             'supplier_catalog_imports (table catalog) et sourcing_candidates/' +
             'sourcing_candidate_events (tables sourcing) dans le même fichier. Non scindée ' +
             'dans ce lot (O1 ne traite pas la frontière fine catalog/sourcing).',
        risk: 'aucun impact runtime — documentaire uniquement. À rescoper si un futur lot ' +
              'scinde formellement les migrations par feature.' },
      { gap: 'ONTOLOGY_GAP — supplier-catalog-scanner.js et catalog-import-orchestrator.js ' +
             'restent dans catalog malgré leur rôle dans le pipeline sourcing : leur service principal ' +
             'reste l entrée catalogue. La persistence candidate est désormais explicitement déléguée ' +
             'au lifecycle owner sourcing via sourcing-candidate-import-service.',
        risk: 'aucun — frontière runtime explicite ; aucun SQL sourcing_candidates* ne reste dans catalog-import-orchestrator.' },
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — tout changement du cycle de vie candidat (states, transitions) ' +
             'doit être validé par le propriétaire de routes/sourcing-scanner.js',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    'un candidat exclu (rejet manuel ou auto-exclusion douane/légale) n\'est jamais ré-importable (ING-5 verrou 1)',
    'une devise hors whitelist (AED, EUR, USD, KMF) ne produit jamais de purchase_price_kmf faux (ING-5 verrou 2)',
    'un candidat déjà importé (état imported_to_catalog + product_id) ne peut pas être ré-importé',
    'le payload fournisseur brut est conservé intégralement (raw_payload) pour rejouabilité',
  ],

};
