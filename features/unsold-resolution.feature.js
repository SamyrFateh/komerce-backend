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
  service: "Arbitrer et liquider la valeur immobilisée d'une commande invendue " +
           '(WhatsApp, revendeur, don, destruction).',

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      "détection des commandes disponibles depuis 14 jours sans retrait (auto_unsold() sur orders)",
      "arbitrage et résolution d'un invendu : vente WhatsApp, vente revendeur, don, destruction",
      "calcul du prix de liquidation depuis le prix original (politique actuelle : 75% par défaut, ajustable via PATCH avant résolution)",
    ],
    out: [
      'réception, affectation et dispatch des articles au hub (feature inventory — aucun point de contact technique : ' +
        'pas de table écrite en commun, pas de require croisé)',
      "décision de publication produit (feature catalog)",
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  files: {
    routes: [
      'routes/unsold.js',
    ],
    dash: [
      'dashboards/admin/js/api-client-unsold.js',
    ],
    tests: [
      'tests/unit/unsold.test.js',
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
    consumes: ['orders (commande source de l\'invendu)', 'catalog (produit concerné)', 'auth', 'infrastructure (dépendance technique transversale observée : DB, logger, helpers ou bootstrap possédés par infrastructure)'],
  },

  // ── Dette assumée / documentée ────────────────────────────────────────────
  debt: {
    knownGaps: [],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — tout changement de calcul de liquidation doit etre valide par le proprietaire de routes/unsold.js',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
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
