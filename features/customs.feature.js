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
  domain:   'customs',
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
    
      'services/customs-shipment-service.js',],
    routes: [
      'routes/admin/customs.js',
      'routes/admin-customs-shipments.js',
      'routes/admin-customs-categories.js',
    ],
    migrations: [
      'migrations/015b_customs_enrichment.sql',
      'migrations/034_customs_shipments.sql',
      'migrations/036b_seed_customs_categories.sql',
      'migrations/091_freeze_customs_classification_order_items.sql',
      'migrations/092_customs_shipments_declaration_workflow.sql',
      'migrations/093_customs_invoice_document_type.sql',
    ],
      dash: [
      // dashboards/admin views — Lot 4
      'dashboards/admin/js/views/CustomsView.js',
      'dashboards/admin/js/views/TransitaireView.js',
    ],
        tests: [
      'tests/unit/admin-customs-categories.test.js',
      'tests/unit/admin-customs-route.test.js',
      'tests/unit/admin-customs-shipments.test.js',
      'tests/unit/customs-analytics.test.js',
      'tests/unit/customs-classification.test.js',
      'tests/unit/customs-shipment-service.test.js',
    ],
  },

  // ── Contrat d'interface ──────────────────────────────────────────────────
  docs: [
    'docs/adr/ADR-001-customs-shipments.md',
    'docs/adr/ADR-004-customs-rate-coherence.md',
    'docs/doctrine/DOUANE_DECLARATION_PIVOT.md',
    'docs/specs/SPEC_KEYSTONE_DOUANE.md',
  ],

  contract: {
    exposes: [
      'GET /api/admin/customs-shipments',
      // Rapatriées depuis le route-registry (audit 2026-07-06, lot interface-inverse)
      // — routes réelles câblées via bootstrap/api-routes.js, jamais déclarées jusqu'ici.
      'GET /api/admin/customs',
      'GET /api/admin/customs-categories',
      'POST /api/admin/customs-categories',
      'DELETE /api/admin/customs-categories/:key',
      'GET /api/admin/customs-categories/:key',
      'PUT /api/admin/customs-categories/:key',
      'PUT /api/admin/customs-categories/:key/toggle',
      'POST /api/admin/customs-shipments',
      'DELETE /api/admin/customs-shipments/:id',
      'GET /api/admin/customs-shipments/:id',
      'PATCH /api/admin/customs-shipments/:id',
      'POST /api/admin/customs-shipments/:id/activate',
      'GET /api/admin/customs-shipments/:id/analytics',
      'POST /api/admin/customs-shipments/:id/deactivate',
      'POST /api/admin/customs-shipments/:id/declare',
      'GET /api/admin/customs-shipments/analytics',
      'GET /api/admin/customs-shipments/analytics/trends',
      'GET /api/admin/customs-shipments/rates/effective',
      'GET /api/admin/customs-shipments/status/pending',
    ],
    consumes: ['logistics (colis a classer)',
      'documents (facture douane generee)',
      'auth',
      'economic-engine',
    ],
  },

  // ── Dette assumée / documentée ────────────────────────────────────────────
  // (audit 2026-07-06, §2a — reclassé après vérification empirique)
  debt: {
    plannedInterfaces: [
      { endpoint: 'POST /api/admin/customs/classify',
        status: 'non développé',
        decision: 'à trancher — la classification actuelle est 100% automatique ' +
                  '(services/customs-classification.js:resolveFrozenClassification, ' +
                  'appelée au gel de commande, jamais exposée en HTTP). Un endpoint de ' +
                  'reclassification manuelle admin serait une nouvelle capacité, pas une ' +
                  'régression — à ne construire que si un besoin métier réel de correction ' +
                  'a posteriori est confirmé, et alors dans le respect de la doctrine ' +
                  '"la déclaration est instrumentée, jamais optimisée".',
      },
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — toute regle de classification doit etre validee par le proprietaire de customs-classification.js, conformement a docs/doctrine/DOUANE_DECLARATION_PIVOT.md',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    'la declaration est instrumentee, jamais optimisee pour reduire un cout',
  ],

};
