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
      'table incidents en écriture multi-domaines : logistics (scan-engine), payments (reconciliation-service), notifications (alert-engine), dashboard (ops-api legacy, SQL inline hors incident-service.js)',
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
      'services/incident-write-service.js',
    ],
    tests: [
      'tests/unit/incident-service.test.js',
      'tests/unit/incident-write-service.test.js',
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
      'incidents: RW!',  // OWNER (campagne WRITER-NOT-OWNER, 2026-08)
      'orders: R',
      'parcels: R',
      'scan_events: R',
    ],
  },

  security: {
    status: 'NOT_APPLICABLE',
    authedRoutesDetected: 0,
    totalRoutes: 0,
    note: "Aucune route propre. Les mutations cross-feature passent desormais par services/incident-write-service.js, boundary owner incident-management (LOT9).",
  },
  contract: {
    exposes: [], // aucune route propre — consommé via internalApi

    // DECLARED INTERNAL API OWNER — l'API interne existe réellement dans le code
    // (services/incident-service.js), mais aucune de ses fonctions n'est require()
    // par un fichier de production à ce jour (cf. debt.knownGaps).
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
      { fn: 'detachUserFromIncidents', file: 'services/incident-write-service.js' },
      { fn: 'seedIncident', file: 'services/incident-write-service.js' },
    ],

    // CURRENT RUNTIME WRITERS / PRODUCERS — écrivent réellement dans la table
    // incidents aujourd'hui, mais via SQL inline, pas via incident-service.js.
    consumes: [
      'orders (dépendance data cross-feature observée et gouvernée par O5)',
      'infrastructure (dépendance technique transversale observée : DB, logger, helpers ou bootstrap possédés par infrastructure)',
      'logistics (scan-engine écrit incidents — SQL inline)',
      'payments (reconciliation-service écrit incidents — SQL inline)',
      'notifications (alert-engine écrit incidents — SQL inline)',
      'dashboard / ops-api legacy (écrit incidents — SQL inline)',
    ],

    // TARGET CONSUMERS AFTER WIRING — état visé une fois la dette de câblage
    // résolue (hors périmètre de ce lot, cf. debt.knownGaps).
    targetConsumersAfterWiring: [
      'logistics',
      'payments',
      'notifications',
      'dashboard / ops-api',
    ],
  },

  // ── Dette assumée / documentée ────────────────────────────────────────────
  debt: {
    knownGaps: [
      { gap: "RESOLU LOT9 - les mutations incidents de scan-engine, reconciliation-service, alert-engine, admin et ops-api passent par services/incident-write-service.js.",
        risk: 'nul - boundary owner explicite, executants DB et transactions appelantes preserves.',
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
      multiConsumer:       true,  // table incidents écrite par logistics, payments, notifications, dashboard/ops-api legacy — Signal 4 transversal (écriture directe SQL, pas via incident-service.js — cf. debt.knownGaps)
      ownsMigrations:      false, // exception connue, pas de migration dédiée identifiée
      externalSideEffect:  'none',
      surface:             'internal-api',
    },
    rationale: [
      "table incidents avec 6 CHECK constraints (types, sévérité, statut, résolution, impact client, source) — domaine modélisé, pas une table auxiliaire",
      "lifecycle engageant : open → investigating → resolved/dismissed, une résolution reship crée un incident fils (engagement opérationnel réel)",
      "table incidents écrite symétriquement par 4 domaines distincts (scan-engine/logistics, reconciliation-service/payments, alert-engine/notifications, ops-api/dashboard) — Signal 4 de la doctrine ; câblage effectif via services/incident-service.js encore non fait (SQL inline actuellement, cf. debt.knownGaps)",
      "impact client direct : champs client_impact (none → blocked) et client_notified, une résolution refund déclenche un remboursement",
      "l'ancien invariant «aucune écriture métier ne passe par platform-ops» était mensonger vis-à-vis de cette table — corrigé par ce split",
    ],
  },

};
