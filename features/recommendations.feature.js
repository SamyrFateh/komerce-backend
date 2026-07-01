/**
 * @feature       recommendations
 * @type          feature
 * @domain        recommendations
 * @status        staging
 * @owner         backend-core
 * @since         2026-02
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 */
'use strict';

module.exports = {

  // ── Identite ─────────────────────────────────────────────────────────────
  name:     'recommendations',
  type:     'feature',   // feature | transversal
  domain:   'recommendations',
  status:   'staging',   // draft | staging | production | deprecated
  owner:    'backend-core',
  since:    '2026-02',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  // ── Service rendu ────────────────────────────────────────────────────────
  service: 'Classer et suggerer des produits boutique selon un moteur de ranking dedie.',

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'moteur de classement boutique',
      'endpoint de suggestions',
    ],
    out: [
      'donnees produit source (feature catalog)',
      'prix affiche (feature economic-engine)',
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  files: {
    services: [
      'services/boutique-ranking-engine.js',
    
      'services/radar-queries.js',
      'services/signal-service.js',],
    routes: [
      'routes/boutique-suggestions.js',
    
      'routes/signals.js',],
    tests: [
      'tests/unit/radar-queries.test.js',
      'tests/unit/signals.test.js',
      'tests/unit/signal-service.test.js',
      'tests/unit/boutique-suggestions.test.js',
    ],
  },

  // ── Contrat d'interface ──────────────────────────────────────────────────
  contract: {
    exposes: [
      'GET /api/boutique/suggestions',
    ],
    consumes: ['catalog (lecture produit)',
      'auth',
      'logistics',
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — tout changement de formule de classement doit etre valide par le proprietaire de boutique-ranking-engine.js',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    'le ranking ne modifie jamais les donnees produit, lecture seule sur catalog',
  ],

};
