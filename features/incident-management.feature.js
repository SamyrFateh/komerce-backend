/**
 * @feature       incident-management
 * @type          transversal
 * @domain        incident-management
 * @status        production
 * @owner         backend-core
 * @since         2026-07
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 */
'use strict';

module.exports = {
  name: 'incident-management',
  type: 'transversal',
  domain: 'incident-management',
  status: 'production',
  owner: 'backend-core',
  since: '2026-07',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  service: "Détecter, qualifier et résoudre les écarts entre l'état attendu et l'état réel d'une opération, avec impact client traçable.",

  perimeter: {
    in: [
      'création, qualification (type/sévérité/impact client) et résolution d’un incident sous autorité explicite',
      'table incidents possédée par incident-management ; les producteurs cross-feature passent par incident-write-service.js',
      'gouvernance F2 : origin_domain, resolver_domain et resolution_class déterminés dès la création',
      'policy de blocage des transitions physiques irréversibles consommée par Logistics',
      'F3 : due_at persistant, escalade SLA durable vers Action Center et marqueur d’escalade idempotent',
      'F3 : fermeture PHYSICAL_PROOF uniquement après nouvelle preuve scan_events et revalidation synchrone du prédicat',
      'engagement opérationnel réel déclenché par une résolution lorsque l’autorité le permet',
    ],
    out: [
      "logique métier propre au domaine qui a détecté l'écart (logistics, payments, notifications restent propriétaires de leurs propres flux)",
      'preuve physique : scan_events reste lifecycle-owned par Logistics',
      'correction de vérité UPSTREAM_TRUTH : reste propriétaire du domaine resolver_domain',
      'health check / observation technique passive (feature platform-ops)',
    ],
  },

  files: {
    services: [
      'services/incident-service.js',
      'services/incident-write-service.js',
      'services/incident-governance.js',
      'services/incident-escalation.js',
      'services/parcel-transition-guard.js',
    ],
    tests: [
      'tests/unit/incident-service.test.js',
      'tests/unit/incident-write-service.test.js',
      'tests/unit/incident-governance.test.js',
      'tests/unit/incident-escalation.test.js',
      'tests/unit/parcel-transition-guard.test.js',
      'tests/unit/parcel-operations-incident-governance.test.js',
      'tests/integration/incident-f3-postgres.test.js',
    ],
  },

  docs: [],

  db: {
    tables: [
      'incidents: RW!',
      'orders: R',
      'parcels: R',
      'scan_events: R',
    ],
    migrations: [
      'migrations/230_incident_governance_contract.sql',
      'migrations/231_incident_sla_escalation_contract.sql',
    ],
  },

  security: {
    status: 'NOT_APPLICABLE',
    authedRoutesDetected: 0,
    totalRoutes: 0,
    note: 'Aucune route propre. Les mutations cross-feature passent par services/incident-write-service.js, boundary owner incident-management.',
  },

  contract: {
    exposes: [],
    internalApi: [
      { fn: 'listIncidents', file: 'services/incident-service.js' },
      { fn: 'getIncident', file: 'services/incident-service.js' },
      { fn: 'resolveIncident', file: 'services/incident-service.js' },
      { fn: 'escalateIncident', file: 'services/incident-service.js' },
      { fn: 'getIncidentDashboard', file: 'services/incident-service.js' },
      { fn: 'createScanIncident', file: 'services/incident-write-service.js' },
      { fn: 'createReconciliationIncident', file: 'services/incident-write-service.js' },
      { fn: 'createAlertEngineIncidentIfNew', file: 'services/incident-write-service.js' },
      { fn: 'acknowledgeAlertEngineIncident', file: 'services/incident-write-service.js' },
      { fn: 'resolveOpsIncident', file: 'services/incident-write-service.js' },
      { fn: 'resolvePhysicalProofIncident', file: 'services/incident-write-service.js' },
      { fn: 'detachUserFromIncidents', file: 'services/incident-write-service.js' },
      { fn: 'seedIncident', file: 'services/incident-write-service.js' },
      { fn: 'scanOverdueIncidents', file: 'services/incident-escalation.js' },
      { fn: 'assertParcelTransitionAllowed', file: 'services/parcel-transition-guard.js' },
    ],
    consumes: [
      'orders (dépendance data cross-feature observée et gouvernée par O5)',
      'infrastructure (DB/logger/bootstrap techniques)',
      'logistics (producteur d’incidents physiques via incident-write-service ; consommateur du guard de transition F2/F3)',
      'decision-signals (sink durable Action Center pour escalade SLA via signal-service)',
    ],
  },

  debt: {
    knownGaps: [
      { gap: 'UPSTREAM_TRUTH correction reste volontairement hors Incident Management : le domaine resolver corrige sa vérité authoritative, Hub revalide ensuite.', risk: 'aucune autorité inventée ; incident reste bloquant selon policy tant que le prédicat ne repasse pas.' },
    ],
  },

  authority: 'backend-core — tout changement de lifecycle incident doit etre valide par le proprietaire de services/incident-service.js',

  invariants: [
    "jamais de suppression d'incident (soft-close uniquement)",
    'résolution explicite avec raison et type',
    'origin_domain, resolver_domain et resolution_class sont queryables dès la création gouvernée',
    'tout nouvel incident gouverné possède due_at dérivé uniquement de resolution_class',
    'un incident historique UNCLASSIFIED ne peut pas être fermé par un chemin terminal générique',
    'UPSTREAM_TRUTH ne peut jamais être fermé par Incident Management sans correction authoritative amont',
    'PHYSICAL_PROOF ne peut jamais être fermé par un chemin terminal générique : nouvelle preuve + revalidation sont obligatoires',
    'une escalade SLA ne résout jamais l’incident et atteint un sink durable Action Center',
    'le marqueur escalation_level et le signal Action Center sont atomiques dans une même transaction',
    'scan_events reste append-only/lifecycle-owned par Logistics ; Incident Management ne réécrit jamais la preuve',
  ],

  classification: {
    kind: 'business-transversal',
    decision: 'feature-transverse',
    signals: {
      ownsTables: true,
      ownsLifecycle: true,
      activeService: true,
      multiConsumer: true,
      ownsMigrations: true,
      externalSideEffect: 'none',
      surface: 'internal-api',
    },
    rationale: [
      'table incidents riche et lifecycle engageant',
      'API interne d’écriture consommée par plusieurs domaines producteurs derrière la boundary owner',
      'F2 possède la migration 230 pour le triplet d’autorité et la policy de fermeture/blocage',
      'F3 possède la migration 231 pour SLA/escalade et impose la revalidation de preuve physique avant résolution',
    ],
  },
};
