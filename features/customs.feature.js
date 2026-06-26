/**
 * @feature       customs
 * @type          feature
 * @domain        douane
 * @status        production
 * @owner         backend-core
 * @since         2025-11
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 */
'use strict';

module.exports = {

  // ── Identite ─────────────────────────────────────────────────────────────
  name:     'customs',
  type:     'feature',   // feature | transversal
  domain:   'douane',
  status:   'production',   // draft | staging | production | deprecated
  owner:    'backend-core',
  since:    '2025-11',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  // ── Service rendu ────────────────────────────────────────────────────────
  service: 'Classer et declarer un colis douanierement ; la declaration est le pivot, jamais une optimisation.',

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'classification douaniere',
      'analytics douane',
      'categories et shipments admin douane',
    ],
    out: [
      'transport physique du colis (feature logistics, qui consomme le statut douane)',
      'generation de la facture douane document (feature documents)',
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  files: {
    services: [
      'services/customs-classification.js',
      'services/customs-analytics.js',
    ],
    routes: [
      'routes/admin/customs.js',
      'routes/admin-customs-shipments.js',
      'routes/admin-customs-categories.js',
    ],
  },

  // ── Contrat d'interface ──────────────────────────────────────────────────
  contract: {
    exposes: [
      'GET /api/admin/customs/shipments',
      'POST /api/admin/customs/classify',
    ],
    consumes: [
      'logistics (colis a classer)',
      'documents (facture douane generee)',
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — toute regle de classification doit etre validee par le proprietaire de customs-classification.js, conformement a docs/doctrine/DOUANE_DECLARATION_PIVOT.md',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    'la declaration est instrumentee, jamais optimisee pour reduire un cout',
  ],

};
