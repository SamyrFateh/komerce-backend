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

  // ── Identite ─────────────────────────────────────────────────────────────
  name:     'incident-management',
  type:     'transversal',   // feature | transversal
  domain:   'incident-management',
  status:   'production',   // draft | staging | production | deprecated
  owner:    'backend-core',
  since:    '2026-07',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  // ── Service rendu ────────────────────────────────────────────────────────
  service: "Détecter, qualifier et résoudre les écarts entre l'état attendu " +
           "et l'état réel d'une opération, avec impact client traçable.",

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'création, qualification (type/sévérité/impact client) et résolution (reship/refund/manual_fix/dismissed/auto_resolved) d\'un incident',
      'table incidents en écriture multi-domaines : logistics (scan-engine), payments (reconciliation-service), notifications (alert-engine), dashboard (ops-api)',
      'engagement opérationnel réel déclenché par une résolution (ex. reship crée un incident fils)',
    ],
    out: [
      "logique métier propre au domaine qui a détecté l'écart (logistics, payments, notifications restent propriétaires de leurs propres flux)",
      'health check / observation technique passive (feature platform-ops)',
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  files: {
    services: [
      'services/incident-service.js',
    ],
    tests: [
      'tests/unit/incident-service.test.js',
    ],
  },

  // ── Contrat d'interface ──────────────────────────────────────────────────
  docs: [],

  // ── Tables DB ─────────────────────────────────────────────────────────
  // Scission de platform-ops.feature.js (Lot O2, audit BUSINESS_FEATURE_ONTOLOGY_O2,
  // 2026-07-12) — voir §A4 du livrable : table propriétaire riche (6 CHECK
  // constraints), lifecycle engageant, multi-consommateurs symétrique (Signal 4
  // de la doctrine — transversal).
  db: {
    tables: [
      'incidents: RW',
      'orders: R',
      'parcels: R',
      'scan_events: R',
    ],
  },

  security: {
    status: 'NOT_APPLICABLE',
    authedRoutesDetected: 0,
    totalRoutes: 0,
    note: "Aucune route propre — service consommé exclusivement via internalApi par d'autres domaines (logistics, payments, notifications, dashboard).",
  },
  contract: {
    exposes: [], // aucune route propre — consommé via internalApi
    internalApi: [
      { fn: 'listIncidents', file: 'services/incident-service.js' },
      { fn: 'getIncident', file: 'services/incident-service.js' },
      { fn: 'resolveIncident', file: 'services/incident-service.js' },
      { fn: 'escalateIncident', file: 'services/incident-service.js' },
      { fn: 'getIncidentDashboard', file: 'services/incident-service.js' },
    ],
    consumes: [
      'logistics (scan-engine écrit incidents)',
      'payments (reconciliation-service écrit incidents)',
      'notifications (alert-engine écrit incidents)',
    ],
  },

  // ── Dette assumée / documentée ────────────────────────────────────────────
  debt: {
    knownGaps: [
      { gap: "routes/ops-api.js écrit incidents directement par SQL inline au lieu de " +
             "passer par incident-service.js. Le service existe, est testé, mais n'est " +
             "require() par aucun fichier de production. Dette de câblage à résoudre. " +
             "Le fichier ops-api.js reste dans platform-ops (écriture documentée " +
             '@db-write-via:legacy) — refacto de câblage explicitement refusé pour ce lot ' +
             '(runtime, comportementalement neutre, hors O2).',
        risk: 'moyen — duplication logique entre ops-api inline SQL et incident-service.js exports',
      },
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — tout changement de lifecycle incident doit etre valide par le proprietaire de services/incident-service.js',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    "jamais de suppression d'incident (soft-close uniquement)",
    'résolution explicite avec raison et type',
    'une résolution reship crée un incident fils',
  ],

  // ── Classification ────────────────────────────────────────────────────────
  classification: {
    kind:     'business-transversal',
    decision: 'feature-transverse',
    signals: {
      ownsTables:          true,  // incidents, table propre avec 6 CHECK constraints
      ownsLifecycle:       true,  // open → investigating → resolved | dismissed
      activeService:       true,  // "détecter, qualifier et résoudre"
      multiConsumer:       true,  // logistics, payments, notifications, dashboard — Signal 4 transversal
      ownsMigrations:      false, // exception connue, pas de migration dédiée identifiée
      externalSideEffect:  'none',
      surface:             'internal-api',
    },
    rationale: [
      "table incidents avec 6 CHECK constraints (types, sévérité, statut, résolution, impact client, source) — domaine modélisé, pas une table auxiliaire",
      "lifecycle engageant : open → investigating → resolved/dismissed, une résolution reship crée un incident fils (engagement opérationnel réel)",
      "multi-consommé symétriquement par 4 domaines distincts (scan-engine/logistics, reconciliation-service/payments, alert-engine/notifications, ops-api/dashboard) — Signal 4 de la doctrine",
      "impact client direct : champs client_impact (none → blocked) et client_notified, une résolution refund déclenche un remboursement",
      "l'ancien invariant «aucune écriture métier ne passe par platform-ops» était mensonger vis-à-vis de cette table — corrigé par ce split",
    ],
  },

};
