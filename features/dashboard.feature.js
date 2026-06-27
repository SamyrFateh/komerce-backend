/**
 * @feature       dashboard
 * @type          feature
 * @domain        dashboard
 * @status        production
 * @owner         backend-core
 * @since         2025-08
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 */
'use strict';

module.exports = {

  // ── Identite ─────────────────────────────────────────────────────────────
  name:     'dashboard',
  type:     'feature',   // feature | transversal
  domain:   'dashboard',
  status:   'production',   // draft | staging | production | deprecated
  owner:    'backend-core',
  since:    '2025-08',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  // ── Service rendu ────────────────────────────────────────────────────────
  service: 'Donner une vue agregee en lecture sur l\'activite (admin, hub, relais, finance) sans jamais ecrire dans le domaine des autres features.',

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'requetes agregees admin/hub/relais/finance',
      'cache de dashboard',
      'ecrans d\'administration transverses (users, partners, system, rules, risk)',
    ],
    out: [
      'toute ecriture metier — dashboard lit, ne decide jamais a la place de la feature source',
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  files: {
    services: [
      'services/relay-dashboard-queries.js',
      'services/purchasing-admin-service.js',
      'services/dashboard-cache.js',
      'services/dashboard-clients-queries.js',
      'services/hub-dashboard-queries.js',
      'services/dashboard-metrics.js',
      'services/dashboard-ops-queries.js',
    ],
    routes: [
      'routes/dashboard-hub.js',
      'routes/admin/users.js',
      'routes/admin/partners.js',
      'routes/admin/system.js',
      'routes/admin/index.js',
      'routes/admin/dashboard.js',
      'routes/dashboard-shared.js',
      'routes/hub-dashboard.js',
      'routes/admin-dashboard.js',
      'routes/admin-radar.js',
      'routes/dashboard.js',
      'routes/dashboard-clients.js',
      'routes/admin.js',
      'routes/admin-loyalty.js',
      'routes/admin-risk-provisions.js',
      'routes/admin-rules.js',
      'routes/dashboard-ops.js',
      'routes/relay-dashboard.js',
    ],
    dash: [
      'dashboards/admin/index.html',
      'dashboards/admin/portal-pilotage.html',
      'dashboards/admin/portal-pilotage.js',
      'hub/index.html',
      'relais/index.html',
      'js/auth-guard.js',
      'js/parcel-components.js',
      'js/qr-viewer.js',
    ],
  },

  // ── Dépôts ───────────────────────────────────────────────────────────────
  repos: {
    backend: 'services/ + routes/ ci-dessus',
    dash: 'dépôt "dash" — pas encore de doctrine d\'ownership équivalente à la boutique ; ' +
          'dette connue, à construire sur le même modèle que docs/BOUTIQUE_OWNERSHIP_LIVE.md',
  },

  // ── Contrat d'interface ──────────────────────────────────────────────────
  contract: {
    exposes: [
      'GET /api/admin/dashboard',
      'GET /api/dashboard/*',
    ],
    consumes: [
      'orders, payments, logistics, economic-engine, wallet-loyalty, customs (lecture seule sur toutes)',
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — toute nouvelle vue agregee doit etre validee par le proprietaire de dashboard-metrics.js',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    'dashboard n\'ecrit jamais dans le domaine d\'une autre feature — toute action ecrite redirige vers la feature proprietaire',
  ],

  // ── Contrats positifs exécutables ────────────────────────────────────────
  // Rendent l'invariant prose ci-dessus vérifiable par machine, par couche.
  contracts: {

    // BACKEND — lecture seule : aucun fichier service de dashboard ne doit
    // contenir d'écriture SQL ni de mutation. L'invariant n'est plus une promesse,
    // c'est un test. (SKIP propre tant que services/ n'est pas dans le checkout.)
    boundary: {
      scope: 'services',
      forbid: [
        { rx: /\b(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM)\b/i, why: 'écriture SQL dans une feature lecture-seule' },
        { rx: /\.(create|update|destroy|save|insert)\s*\(/,      why: 'mutation ORM dans une feature lecture-seule' },
      ],
    },

    // DASHBOARD (frontend) — même doctrine de rendu que la boutique : les écrans
    // critiques doivent contenir leurs ancres de montage. C'est la dette que ce
    // manifeste documentait lui-même (« à construire sur le modèle boutique »).
    'render-static': [
      {
        artifact: 'dashboards/admin/index.html',
        label:    'écran admin = conteneur pilotage présent',
        mustContain: [ /id=["']portal-pilotage["']|data-dashboard-root/ ],
      },
    ],
  },

};
