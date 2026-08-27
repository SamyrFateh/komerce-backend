/**
 * @komerce-arch
 * @role          decision-signals-capability-manifest
 * @domain        decision-signals
 * @layer         manifest
 * @criticality   medium
 * @doctrine      docs/doctrine/PILOTING_CAPABILITY_DOCTRINE.md
 * @registry      docs/doctrine/PILOTING_CAPABILITY_REGISTRY.md
 */
'use strict';

module.exports = {
  name:       'decision-signals',
  governedBy: 'docs/doctrine/PILOTING_CAPABILITY_DOCTRINE.md',
  registry:   'docs/doctrine/PILOTING_CAPABILITY_REGISTRY.md',
  status:     'staging',
  owner:      'backend-core',
  since:      '2026-02',

  // ── Capacité rendue (jamais un service client) ──────────────────────────
  capability: 'Detecter et qualifier des signaux operationnels (cash, colis, '
            + 'incidents) a partir des donnees produites par plusieurs '
            + 'features, pour l\'aide a la decision admin.',

  perimeter: {
    in: [
      'generation de signaux depuis des requetes radar cross-feature (cash, colis, incidents)',
      'cycle de vie du signal : acknowledge / resolve / snooze',
      'consultation admin des signaux (routes/signals.js)',
      'Action Center Canonical : projection globale + lifecycle par signal_ref',
    ],
    out: [
      'aucune decision metier engageante : la capability detecte, elle ne tranche aucun statut de commande, colis ou wallet',
      'aucune UI ne devient propriétaire de la donnée source : Action Center reste une projection dashboard de cette capability',
      'classement produit boutique (feature recommendations, qui reste seule proprietaire du ranking)',
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  files: {
    middleware: [
      'middleware/require-decision-signal-global-authority.js',
    ],
    services: [
      'services/radar-queries.js',
      'services/signal-service.js',
      'services/signal-admin-service.js',
      'services/action-center-workspace.js',
    ],
    routes: [
      'routes/signals.js',
      'routes/admin-action-center.js',
    ],
    migrations: [
      'migrations/153_action_center_signal_authority.sql',
    ],
    tests: [
      'tests/unit/radar-queries.test.js',
      'tests/unit/signals.test.js',
      'tests/unit/signal-service.test.js',
      'tests/unit/signal-admin-service.test.js',
      'tests/unit/action-center-workspace.test.js',
      'tests/unit/admin-action-center-route.test.js',
      'tests/unit/require-decision-signal-global-authority.test.js',
      'tests/unit/signals-error-propagation.test.js',
      'tests/unit/action-center-migration-contract.test.js',
    ],
  },

  // ── Tables (constat propre — jamais une table possedee par une feature) ─
  db: {
    tables: [
      'signals: RW',
      // Lectures cross-feature necessaires au calcul du signal — jamais
      // ecrites ici. Tables possedees par d'autres features (cash_collections,
      // cash_deposits, finance_config, incidents, orders, parcels, products,
      // users, wallets) : lecture seule, cf. radar-queries.js / signal-service.js.
    ],
  },

  consumedBy: [
    'dashboard (routes/admin-radar.js, projection en lecture des signaux)',
    'consultation admin directe (routes/signals.js)',
    'dashboard Canonical (Action Center /admin/action-center)',
  ],

  invariants: [
    'un signal est un constat derive, jamais une mutation d\'une table possedee par une autre feature',
    'acknowledge/resolve/snooze changent uniquement l\'etat du signal, jamais l\'etat de la donnee source',
    'open, acknowledged et snoozed forment un seul lifecycle actif ; disparition de la condition => auto-resolution',
    'aucune autorite market n\'est inventee tant que signals ne porte pas un market_id canonique',
  ],

  contract: {
    exposes: [
      'GET /api/admin/action-center',
      'POST /api/admin/action-center/generate',
      'POST /api/admin/action-center/signals/:signalRef/acknowledge',
      'POST /api/admin/action-center/signals/:signalRef/snooze',
      'POST /api/admin/action-center/signals/:signalRef/resolve',
    ],
    consumes: [
      "auth (FF-C1 2026-07-29 — garde de route et contexte d’identité ; preuve: routes/signals.js -> middleware/auth.js)",

      "infrastructure (2026-08-17 — accès DB et logger techniques ; preuve: services/radar-queries.js, services/signal-service.js, routes/signals.js -> db.js / utils/logger.js)",

      "logistics (FF-C1 2026-07-29 — lecture ou orchestration logistique ; preuve: services/radar-queries.js -> utils/parcels.js)",

      "business-rules (FF-C1 2026-07-29 — lecture du référentiel de règles métier ; preuve: services/radar-queries.js -> utils/rules.js)",
    ],
  },
};
