/**
 * @feature       inventory
 * @type          feature
 * @domain        inventory
 * @status        staging
 * @owner         backend-core
 * @since         2026-01
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 */
'use strict';

module.exports = {

  // ── Identite ─────────────────────────────────────────────────────────────
  name:     'inventory',
  type:     'feature',   // feature | transversal
  domain:   'inventory',
  status:   'staging',   // draft | staging | production | deprecated
  owner:    'backend-core',
  since:    '2026-01',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  // ── Service rendu ────────────────────────────────────────────────────────
  service: 'Suivre le niveau de stock disponible pour un produit.',

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'suivi de stock et endpoint de lecture/mise a jour',
    ],
    out: [
      'decision de publication produit (feature catalog, qui consomme inventory)',
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  files: {
    services: [
      'services/inventory-service.js',
    ],
    routes: [
      'routes/inventory-api.js',
    ],
  },

  // ── Contrat d'interface ──────────────────────────────────────────────────
  contract: {
    exposes: [
      'GET /api/inventory/:productId',
    ],
    consumes: [
      'catalog (produit concerne)',
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — tout changement de calcul de disponibilite doit etre valide par le proprietaire de inventory-service.js',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    'le stock ne descend jamais sous zero sans flag explicite de surventee assumee',
  ],

};
