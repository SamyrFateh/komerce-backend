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
    services: [],
    routes: [
      'routes/modules.js',
      'routes/health.js',
      'routes/ops-api.js',
      'routes/config.js',
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

};
