/**
 * @feature       operations
 * @type          transversal
 * @domain        operations
 * @status        production
 * @owner         backend-core
 * @since         2025-08
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 */
'use strict';

module.exports = {

  // ── Identite ─────────────────────────────────────────────────────────────
  name:     'operations',
  type:     'transversal',   // feature | transversal
  domain:   'operations',
  status:   'production',   // draft | staging | production | deprecated
  owner:    'backend-core',
  since:    '2025-08',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  // ── Service rendu ────────────────────────────────────────────────────────
  service: 'Exposer la sante applicative, la configuration et les modules actifs — infrastructure d\'exploitation, pas de service metier.',

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'health check, configuration exposee, liste de modules actifs, API d\'operations interne',
    ],
    out: [
      'toute logique metier — operations n\'a pas de regle metier propre',
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  files: {
    services: [
    ],
    routes: [
    ],
    boutique: [
      // Backfill gouvernance globale : socle technique Boutique (bus, state, api-client,
      // utils, scroll, entrée page). Headers @komerce-arch domain=boutique,
      // layer=state|api-client|ui-infrastructure|util — transverse à toutes les
      // features Boutique, ne porte aucune règle métier propre (cf. perimeter.out).
    ],
      tests: [
      'tests/unit/collective-cleanup-tombstones.test.js',
      'tests/unit/config-route.test.js',
      'tests/unit/health.test.js',
      'tests/unit/incident-service.test.js',
      'tests/unit/journal.test.js',
      'tests/unit/modules.test.js',
      'tests/unit/monitoring.test.js',
      'tests/unit/ops-api.test.js',
      'tests/unit/scenarios.test.js',
      'tests/unit/simulator-engine.test.js',
      'tests/unit/simulator-platform-ops.test.js',
      'tests/unit/simulator-route.test.js',
      'tests/unit/state-advancer.test.js',
    ],
  },

  // ── Contrat d'interface ──────────────────────────────────────────────────
  docs: [],

  contract: {
    exposes: [
      'GET /health',
      'GET /api/config',
      'GET /api/modules',
    ],
    consumes: [
      'auth',
      'economic-engine',
      'orders',
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — infrastructure partagee, changement valide par l\'equipe plateforme',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    'aucune ecriture metier ne passe par operations',
  ],

  // ── Classification ────────────────────────────────────────────────────────
  classification: {
    kind:     'technical-transversal',
    decision: 'transversal-technique',
    signals: {
      ownsTables:          false, // pas de tables métier propriétaires
      ownsLifecycle:       false,
      activeService:       false, // expose la santé, ne rend pas de service métier
      multiConsumer:       false, // operations ne consomme pas d'autres features — c'est l'inverse
      ownsMigrations:      false, // aucune migration métier dédiée
      externalSideEffect:  'none',
      surface:             'api',
    },
    rationale: [
      'invariant explicite : aucune écriture métier ne passe par operations',
      'infrastructure pure — santé applicative, config, modules actifs',
      'pas de règle métier propre (service = «pas de service métier»)',
      'consommé transversalement par l\'outillage CI, monitoring, et toutes les features',
    ],
  },

};
