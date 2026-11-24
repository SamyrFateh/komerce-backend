/**
 * @feature       refunds
 * @type          feature
 * @domain        refunds
 * @status        production
 * @owner         backend-core
 * @since         2025-11
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 */
'use strict';

module.exports = {

  // ── Identite ─────────────────────────────────────────────────────────────
  name:     'refunds',
  type:     'feature',   // feature | transversal
  domain:   'refunds',
  status:   'production',   // draft | staging | production | deprecated
  owner:    'backend-core',
  since:    '2025-11',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  classification: {
    "axis": "business",
    "kind": "business-transversal",
    "decision": "feature-transverse",
    "signals": {
      "ownsTables": true,
      "ownsLifecycle": true,
      "activeService": true,
      "multiConsumer": true,
      "ownsMigrations": false,
      "externalSideEffect": "refund",
      "surface": "service"
    },
    "rationale": [
      "orchestre transversalement le remboursement entre paiement, wallet et documents tout en conservant la trace refunds du flux compensatoire",
      "ne constitue pas un domaine métier isolé : il coordonne les frontières propriétaires des features sources et garantit l idempotence par événement"
    ]
  },

  // ── Service rendu ────────────────────────────────────────────────────────
  service: 'Rembourser un client de facon tracable et sans double remboursement, quel que soit le flux appelant.',

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'service de remboursement transverse et son orchestration',
    ],
    out: [
      'credit wallet lui-meme (feature wallet, consommee ici)',
      'reçu de remboursement document (feature documents, consommee ici)',
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  files: {
    // G8 UI opérateur F1/F2 : formulaire staging, aucun déclencheur de virement.
    utils: [
      'public/g8-remboursements.html',
      'public/css/g8-remboursements.css',
      'public/js/g8-remboursements.js',
      'public/g6-sav-compensation.html',
      'public/js/g6-sav-compensation.js',
    ],
    migrations: [
      'migrations/416_fable_local_item_refund_reservations.sql',
      'migrations/417_fable_cash_refund_custody_handoff.sql',
      'migrations/418_fable_manual_mobile_money_refund.sql',
    ],
    services: [
      'services/refund-service.js',
      'services/item-refund-reservation-service.js',
      'services/n27-remnant-cancellation-service.js',
      'services/local-item-refund-reservation.js',
      'services/local-mobile-refund-handoff.js',
      'services/local-cash-refund-handoff.js',
      'services/item-refund-psp-orchestrator.js',
      'services/refund-intent-ledger.js',
      'services/paypal-refund-authority.js',
      'services/stripe-refund-authority.js',
      'services/sav-ledger-refund.js',
      'services/refund-evidence-verifier.js',
      'services/refund-intent-reconciliation.js',
    ],
    routes: [],
    tests: [
      // E2E fonctionnel Feature First — refunds est PROPRIETAIRE du scenario ;
      // orders, payments, wallet, catalog et logistics sont traversees.
      'tests/e2e-api/refunds.no-double-application.e2e.test.js',
      // E2E fonctionnel — chantier currency debt, LOT 7. Les 4 colonnes de
      // flux financier (refunds/store_credits/cash_collections/cash_deposits),
      // 43 fichiers chacune. Montants réellement remis à une personne :
      // les arrondir à l'unité lui faisait perdre des centimes.
      'tests/e2e-api/refunds.credits-cash-numeric.e2e.test.js',
      'tests/unit/refund-service.test.js',
      'tests/unit/item-refund-reservation-service.test.js',
      'tests/unit/local-item-refund-reservation.test.js',
      'tests/e2e-api/refunds.local-shortage-reservation.e2e.test.js',
      'tests/integration/fable-cash-refund-handoff-postgres.test.js',
      'tests/unit/g8-remboursements.test.js',
      'tests/unit/n27-remnant-cancellation.test.js',
      'tests/unit/g6-negative-scenarios.test.js',
      'tests/unit/g6-n26b-compensation-screen.test.js',
      'tests/staging-canonical/g8-refunds-readonly.spec.js',
      'tests/unit/item-refund-psp-orchestrator.test.js',
      'tests/e2e-api/refunds.item-partial-physical.e2e.test.js',
      'tests/unit/refund-intent-ledger.test.js',
      'tests/unit/paypal-refund-authority.test.js',
      'tests/unit/stripe-refund-authority.test.js',
      'tests/e2e-api/refunds.stripe-business-intent-concurrency.e2e.test.js',
      'tests/e2e-api/refunds.stripe-crash-boundaries.e2e.test.js',
      'tests/unit/sav-ledger-refund.test.js',
      'tests/unit/refund-evidence-verifier.test.js',
      'tests/unit/refund-intent-reconciliation.test.js',
      'tests/e2e-api/refunds.intents-reconciliation.e2e.test.js',
      'tests/e2e-api/refunds.intents-physical-concurrency.e2e.test.js',
      'tests/e2e-api/refunds.intent-provider-reference-unique.e2e.test.js',
      'tests/e2e-api/refunds.durable-intent-ledger.e2e.test.js',
      'tests/unit/refund-stripe-txn-known-risk.test.js',
      'tests/unit/refund-receipt-html.test.js',
    ],
  },

  // ── Contrat d'interface ──────────────────────────────────────────────────
  docs: [],

  // ── Tables DB (inféré, audit 2026-07-06, §axe2) ─────────────────────────
  // Généré par parsing réel des appels .query() (pas un grep de mots) :
  // R = lu par cette feature, W = écrit par cette feature, RW = les deux.
  // Une table listée ici pour PLUSIEURS features est une vraie propriété
  // partagée détectée dans le code, pas un artefact de méthode — à
  // documenter explicitement si volontaire, ou à re-scoper sinon.
  // Champ auto-généré : à corriger à la main si une requête dynamique
  // (nom de table construit par variable) a échappé au scan.
  db: {
    tables: [
      'orders: R',
      'refunds: RW',
      'refund_execution_intents: RW',
      'order_item_refund_reservations: RW',
      'local_item_refund_reservations: RW',
      'local_cash_refund_authorizations: RW',
      'local_cash_refund_payouts: RW',
      'local_mobile_refund_handoffs: RW',
      'order_items: R',
      'products: R',
      'incidents: R',
      'international_shipment_relay_receipts: R',
      'purchase_lines: R',
      'purchase_orders: R',
      'parcels: R',
      'parcel_items: R',
      'wallets: R',
    ],
  },

  security: {
    status: 'CONFIRMED_PROTECTED',
    authedRoutesDetected: 0,
    totalRoutes: 0,
    note: "Feature sans routes HTTP directes. Le remboursement est déclenché exclusivement via services internes (refund-service.js) appelés par d'autres features protégées (orders, payments). Aucune surface d'attaque externe.",
  },
  contract: {
    exposes: [],
    // Migré depuis exposes (audit 2026-07-06, lot UNPARSEABLE) : pas de route
    // HTTP propre — remboursement déclenché exclusivement par appel de
    // fonction interne depuis les features consommatrices (orders, shared-cart).
    internalApi: [
      'processRefund(orderOrCartId, reason)',
    ],
    consumes: [
      'market (prorata SAV dans les devises figées via fx-authority)',
      'infrastructure (dépendance technique transversale observée :