/**
 * @feature       platform-ops
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
  name:     'platform-ops',
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
      'toute logique metier — platform-ops n\'a pas de regle metier propre',
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  files: {
    services: [
      'services/incident-service.js',
    
      'services/monitoring.js',
      'services/simulator/cleanup.js',
      'services/simulator/engine.js',
      'services/simulator/journal.js',
      'services/simulator/scenarios.js',
      'services/simulator/state-advancer.js',],
    routes: [
      'routes/modules.js',
      'routes/health.js',
      'routes/ops-api.js',
      'routes/config.js',
    
      'routes/simulator.js',],
    boutique: [
      // Backfill gouvernance globale : socle technique Boutique (bus, state, api-client,
      // utils, scroll, entrée page). Headers @komerce-arch domain=boutique,
      // layer=state|api-client|ui-infrastructure|util — transverse à toutes les
      // features Boutique, ne porte aucune règle métier propre (cf. perimeter.out).
      'js/main.js',
      'js/komerce-api.js',
      'js/b-store.js',
      'js/b-bus.js',
      'js/b-utils.js',
      'js/b-scroll-owner.js',
      'index.html',
    ],
  },

  // ── Contrat d'interface ──────────────────────────────────────────────────
  contract: {
    exposes: [
      'GET /health',
      'GET /api/config',
      'GET /api/modules',
    ],
    consumes: [],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — infrastructure partagee, changement valide par l\'equipe plateforme',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    'aucune ecriture metier ne passe par platform-ops',
  ],

  // ── Classification ────────────────────────────────────────────────────────
  classification: {
    kind:     'technical-transversal',
    decision: 'transversal-technique',
    signals: {
      ownsTables:          false, // pas de tables métier propriétaires
      ownsLifecycle:       false,
      activeService:       false, // expose la santé, ne rend pas de service métier
      multiConsumer:       false, // platform-ops ne consomme pas d'autres features — c'est l'inverse
      ownsMigrations:      false, // aucune migration métier dédiée
      externalSideEffect:  'none',
      surface:             'api',
    },
    rationale: [
      'invariant explicite : aucune écriture métier ne passe par platform-ops',
      'infrastructure pure — santé applicative, config, modules actifs',
      'pas de règle métier propre (service = «pas de service métier»)',
      'consommé transversalement par l\'outillage CI, monitoring, et toutes les features',
    ],
  },

};
