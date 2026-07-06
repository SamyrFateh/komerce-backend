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
      tests: [
      'tests/integration/api.test.js',
      'tests/integration/isweep-invariants.test.js',
      'tests/integration/isweep-services.test.js',
      'tests/integration/isweep-transactional-flows.test.js',
      'tests/integration/relais-idor-probe.test.js',
      'tests/integration/security-grid.test.js',
      'tests/unit/b-checkout-pure.test.js',
      'tests/unit/relais-idor-probe.test.js',
      'tests/unit/validators.test.js',
      // Rapatriés depuis features/operations.feature.js (doublon supprimé,
      // audit 2026-07-06 §2c) — services/routes étaient déjà ici, seuls ces
      // tests traînaient encore dans l'ancien manifeste.
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
      'GET /api/modules',
    ],
    consumes: [],
  },

  // ── Dette assumée / documentée ────────────────────────────────────────────
  // (audit 2026-07-06 §2c — vérifié empiriquement contre bootstrap/api-routes.js)
  debt: {
    knownGaps: [
      { gap: 'ancien contrat déclaré "GET /api/config" : routes/config.js existe bel et ' +
             'bien et expose 5 endpoints réels (GET/PUT /api/config/rules, ' +
             '/api/config/rules/:key, /api/config/rules/:key/reset, ' +
             '/api/config/rules/:key/history) — mais ce fichier n\'est require() ni monté ' +
             'nulle part dans bootstrap/api-routes.js ni server.js. Ce n\'est pas un contrat ' +
             'désynchronisé d\'un chemin : c\'est du code mort jamais câblé.',
        risk: 'moyen — 5 endpoints de gestion de règles métier (config runtime) sont ' +
              'invisibles et inaccessibles en admin. Décision produit à trancher : câbler ' +
              'routes/config.js sous un préfixe (ex. app.use(\'/api/config\', require(\'./routes/config\'))) ' +
              'si le besoin existe encore, ou supprimer le fichier si obsolète. Ne pas ' +
              'rajouter "GET /api/config" à exposes tant que ce choix n\'est pas fait — ' +
              'ce serait re-déclarer une route qui ne répond toujours pas.',
      },
    ],
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
