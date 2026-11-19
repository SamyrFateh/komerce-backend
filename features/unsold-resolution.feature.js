/**
 * @feature       unsold-resolution
 * @type          feature
 * @domain        unsold-resolution
 * @status        production
 * @owner         backend-core
 * @since         2026-07
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 */
'use strict';

module.exports = {

  // ── Identite ─────────────────────────────────────────────────────────────
  name:     'unsold-resolution',
  type:     'feature',   // feature | transversal
  domain:   'unsold-resolution',
  status:   'production',   // draft | staging | production | deprecated
  owner:    'backend-core',
  since:    '2026-07',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  // ── Service rendu ────────────────────────────────────────────────────────
  service: "Garder les colis non retirés sous responsabilité du relais ; la liquidation " +
           "n'est autorisée qu'après clôture physique, juridique et financière certifiée.",

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      "scan historique J+14 bloqué faute de clôture de garde et de droits client certifiée",
      "mutation de l'invendu uniquement pour des commandes non payées et un état available",
      "projection GET en lecture seule pour le responsable pays, filtrée en SQL sur les marchés operations.read délégués",
      "prohibition de la promotion ou cession de marchandises payées tant que les droits de retrait persistent",
    ],
    out: [
      'réception, affectation et dispatch des articles au hub (feature inventory — aucun point de contact technique : ' +
        'pas de table écrite en commun, pas de require croisé)',
      "décision de publication produit (feature catalog)",
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  files: {
    migrations: [
      'migrations/415_paid_no_show_liquidation_guard.sql',
      'migrations/419_paid_no_show_payment_transition_guard.sql',
    ],
    routes: [
      'routes/unsold.js',
    ],
    dash: [
      'dashboards/admin/js/api-client-unsold.js',
      'dashboards/canonical/unsold.html',
      'dashboards/canonical/js/unsold-workspace.js',
    ],
    tests: [
      'tests/unit/unsold.test.js',
      'tests/unit/unsold-workspace.test.js',
      'tests/local-chromium/g6e-unsold.spec.js',
      'tests/e2e-api/unsold-resolution.pipeline-real-db.e2e.test.js',
    ],
  },

  // ── Contrat d'interface ──────────────────────────────────────────────────
  docs: [],

  // ── Tables DB ─────────────────────────────────────────────────────────
  // Scission de inventory.feature.js (Lot O2, audit BUSINESS_FEATURE_ONTOLOGY_O2,
  // 2026-07-12) — voir §A2 du livrable : zéro dépendance croisée avec inventory,
  // zéro table écrite en commun, lifecycle et bénéficiaire distincts.
  db: {
    tables: [
      'unsold_items: RW',
      'v_unsold_pipeline: R',
      'orders: R',
      'products: R',
    ],
  },

  security: {
    status: 'CONFIRMED_PROTECTED',
    authedRoutesDetected: 7,
    totalRoutes: 7,
    note: '7/7 routes protégées — hérité de inventory (audit gen-security-360.js), à revérifier au prochain passage.',
  },
  contract: {
    exposes: [
      'GET /api/unsold',
      'GET /api/unsold/:id',
      'PATCH /api/unsold/:id',
      'POST /api/unsold/:id/resolve',
      'GET /api/unsold/:id/whatsapp',
      'POST /api/unsold/scan',
      'GET /api/unsold/stats/summary',
    ],
    consumes: ['orders (commande source de l\'invendu)', 'catalog (produit concerné)', 'auth', 'market-delegation', 'infrastructure (dépendance technique transversale observée : DB, logger, helpers ou bootstrap possédés par infrastructure)'],
  },

  // ── Dette assumée / documentée ────────────────────────────────────────────
  debt: {
    knownGaps: [
      'F3 #4115 : sortie du no-show par colis, relances, arbitrage de marché et réconciliation du code de retrait / argent / stock non certifiés. Le scanner automatique est bloqué.',
      'La fonction SQL legacy auto_unsold() demeure installée ; les migrations 415/419 bloquent la liquidation payée et la transition inverse invendu → payé. Procédure no-show par colis et arbitrage financier restent à construire.',
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — tout changement de calcul de liquidation doit etre valide par le proprietaire de routes/unsold.js',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    { statement: "aucun invendu d'une commande payée ne peut être vendu, donné, détruit ou annoncé via les routes unsold",
      test: 'tests/e2e-api/unsold-resolution.pipeline-real-db.e2e.test.js' },
    { statement: 'le délai J+14 ne crée ni droit de propriété ni permission de liquidation automatique',
      test: 'tests/unit/unsold.test.js' },
    'un invendu résolu ne revient jamais en available',
    'toute résolution possède un statut terminal autorisé et un horodatage resolved_at',
  ],

  // ── Classification ────────────────────────────────────────────────────────
  classification: {
    kind:     'business-feature',
    decision: 'feature-autonome',
    signals: {
      ownsTables:          true,  // unsold_items, propriété exclusive
      ownsLifecycle:       true,  // available → 4 terminaux, irréversible
      activeService:       true,  // "arbitrer et liquider une valeur immobilisée"
      multiConsumer:       false, // consommé uniquement par admin commercial / dashboard
      ownsMigrations:      false, // exception documentée (comme refunds)
      externalSideEffect:  'none',
      surface:             'api',
    },
    rationale: [
      "table propriétaire unsold_items, sans dépendance croisée avec inventory_items (grep croisé négatif dans les deux sens)",
      "lifecycle irréversible propre : available → sold_whatsapp | sold_reseller | donated | destroyed",
      "service rendu autonome distinct de inventory : liquider une valeur immobilisée ≠ dispatcher un article reçu",
      "pas de migration dédiée identifiée — exception connue documentée dans la doctrine (cf. refunds)",
    ],
  },

};
