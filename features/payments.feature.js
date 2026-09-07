/**
 * @feature       payments
 * @type          feature
 * @domain        payment
 * @status        production
 * @owner         backend-core
 * @since         2025-09
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 */
'use strict';

module.exports = {

  // ── Identite ─────────────────────────────────────────────────────────────
  name:     'payments',
  type:     'feature',
  domain:   'payment',
  status:   'production',
  owner:    'backend-core',
  since:    '2025-09',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  classification: {
    "axis": "business",
    "kind": "business-feature",
    "decision": "feature-autonome",
    "signals": {
      "ownsTables": true,
      "ownsLifecycle": true,
      "activeService": true,
      "multiConsumer": true,
      "ownsMigrations": true,
      "externalSideEffect": "payment",
      "surface": "api+webhook+service"
    },
    "rationale": [
      "possède confirmation et idempotence des encaissements Stripe, PayPal, Mobile Money et cash ainsi que les journaux/transactions externes",
      "borne l effet externe de paiement par provider, montant, devise et anti-double-confirmation ; orders ne possède que la commande à payer"
    ]
  },

  // ── Service rendu ────────────────────────────────────────────────────────
  service: 'Encaisser un paiement (carte, PayPal, Mobile Money, especes au retrait) et confirmer son etat de facon idempotente.',

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'integration Stripe et PayPal (intent, capture, webhook, evenements)',
      'Mobile Money multi-provider par marché (Orange Money CM, MTN MoMo CG)',
      'réconciliation périodique des paiements Mobile Money pending si callback perdu',
      'paiement cash au retrait et relances cash',
      'confirmation de paiement et idempotence webhook/callback',
    ],
    out: [
      'creation de la commande elle-meme (feature orders)',
      'orchestration du checkout boutique (projection frontend de orders)',
      'remboursement (feature refunds, qui consomme payments en lecture)',
      'credit wallet (feature wallet-loyalty)',
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  files: {
    services: [
      'services/payment-status-validator.js',
      'services/cash-reminder-service.js',
      'services/paypal-client.js',
      'services/payment-paypal.js',
      'services/payment-cash-confirm.js',
      'services/payment-stripe.js',
      'services/create-stripe-order-intent.js',
      'services/confirm-pickup-cash-payment.js',
      'services/payment-paypal-events.js',
      'services/cash-operations.js',
      'services/cash-deposit-service.js',
      'services/reconciliation-service.js',
      'services/payment-mobile-money.js',
      'services/mobile-money-reconciliation.js',
      'services/mobile-money/registry.js',
      'services/mobile-money/orange-money-cm.js',
      'services/mobile-money/mtn-momo-cg.js',
    ],
    routes: [
      'routes/cash.js',
      'routes/payments.js',
      'routes/pickup-pay-cash.js',
      'routes/payments-paypal.js',
      'routes/payments-mobile-money.js',
    ],
    migrations: [
      'migrations/079_paypal_payment_mode.sql',
      'migrations/148_cash_deposit_business_reference.sql',
      'migrations/169_mobile_money_foundation.sql',
    ],
    boutique: [
      // Payment-specific uniquement. Le tunnel général b-checkout* appartient
      // désormais à la projection frontend de orders.
      'js/b-paypal.js',
      'css/paypal.css',
    ],
    tests: [
      'tests/e2e-api/payments.paypal-webhook-contract.e2e.test.js',
      'tests/e2e-api/payments.paypal-amount-currency.e2e.test.js',
      'tests/unit/payment-cash-confirm.test.js',
      'tests/unit/payment-paypal.test.js',
      'tests/unit/payment-status-validator.test.js',
      'tests/unit/payment-stripe.test.js',
      'tests/unit/payments-webhook.test.js',
      'tests/unit/paypal-client.test.js',
      'tests/unit/cash-operations-service.test.js',
      'tests/unit/cash-deposit-service.test.js',
      'tests/unit/cash-reminder-service.test.js',
      'tests/unit/cash-route.test.js',
      'tests/unit/confirm-pickup-cash-payment.test.js',
      'tests/unit/create-stripe-order-intent.test.js',
      'tests/unit/payment-paypal-events.test.js',
      'tests/unit/payments-paypal.test.js',
      'tests/unit/payments-route.test.js',
      'tests/unit/pickup-pay-cash.test.js',
      'tests/unit/reconciliation-service.test.js',
      'tests/unit/mobile-money-providers.test.js',
      'tests/unit/payment-mobile-money.test.js',
      'tests/unit/mobile-money-reconciliation.test.js',
    ],
  },

  // ── Dépôts ───────────────────────────────────────────────────────────────
  repos: {
    backend: 'services/ + routes/ ci-dessus',
    boutique: 'js/b-paypal.js + css/paypal.css — dépôt "bout", checkout général rattaché à orders',
  },

  // ── Contrat d'interface ──────────────────────────────────────────────────
  docs: [
    'docs/PAYPAL_IMPLEMENTATION_GUIDE.md',
    'docs/contract/MOBILE_MONEY_PAYMENT.md',
    'docs/chantier/FLOW_AUDIT_CASH_G1.md',
    'docs/chantier/FLOW_AUDIT_STRIPE_G2.md',
    'docs/chantier/I_SWEEP_1_PICKUP_CASH_PATCH.md',
    'docs/chantier/STRIPE_WEBHOOK_AUDIT_D2.md',
    'docs/ops/PAYPAL_POSITIONNEMENT.md',
  ],

  // ── Tables DB ─────────────────────────────────────────────────────────────
  db: {
    tables: [
      'cash_collections: RW',
      'cash_deposits: RW',
      'incidents: R',
      'market_payment_providers: R',
      'mobile_money_transactions: RW',
      'order_items: R',
      'orders: R',
      'parcel_items: R',
      'parcels: R',
      'paypal_events_processed: RW',
      'scan_events: R',
      'stripe_events_processed: RW',
      'users: R',
    ],
  },

  security: {
    status: 'CONFIRMED_MIXED',
    authedRoutesDetected: 13,
    totalRoutes: 18,
    note: "Stripe/PayPal conservent leurs gardes existantes. Mobile Money ajoute des routes utilisateur protégées et un callback public qui n'accorde aucune confiance au body : toute confirmation relit le statut serveur-à-serveur chez le provider. Les secrets providers restent exclusivement en environnement.",
  },
  contract: {
    exposes: [
      'POST /api/payments/stripe/intent',
      'POST /api/payments/paypal/webhook',
      'POST /api/payments/cash/confirm',
      'GET /api/payments/mobile-money/availability',
      'POST /api/payments/mobile-money/initiate',
      'GET /api/payments/mobile-money/transactions/:transactionId',
      'POST /api/payments/mobile-money/transactions/:transactionId/refresh',
      'POST /api/payments/mobile-money/callback/:provider/:transactionId',
      'GET /api/payments/mobile-money/admin/pending',
      'POST /api/cash/collect/:orderId',
      'GET /api/cash/collections',
      'POST /api/cash/deposit',
      'GET /api/cash/deposits',
      'POST /api/cash/deposits/:id/dispute',
      'POST /api/cash/deposits/:id/verify',
      'GET /api/cash/reconciliation',
      'GET /api/cash/reconciliation/agents',
      'GET /api/cash/uncollected',
      'GET /api/payments/config',
      'POST /api/payments/paypal/capture/:paypalOrderId',
      'POST /api/payments/paypal/create-order',
      'POST /api/payments/paypal/refund/:orderId',
      'GET /api/payments/rates',
      'POST /api/payments/stripe/webhook',
    ],
    internalApi: [],
    consumes: [
      'auth-identity (dépendance data cross-feature observée et gouvernée par O5)',
      'incident-management (incident persistence via incident-write-service)',
      'infrastructure (DB, logger, Currency Boundary et bootstrap)',
      'platform-ops (monitoring et exploitation technique)',
      'auth (garde de route et contexte identité)',
      'refunds (orchestration du remboursement)',
      'documents (émission facture/reçu)',
      'notifications (émission de message)',
      'business-rules (lecture du référentiel de règles métier)',
      'orders (commande a payer et point d entrée unique payment -> stock)',
      'market (market_id et devise native du rail)',
      'logistics (generation du code retrait pickup au moment du paiement)',
      'loyalty (recalcul de palier apres paiement confirme)',
      'purchasing (verification/reapprovisionnement apres encaissement)',
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — tout changement de provider, callback, webhook ou logique d idempotence paiement doit etre valide par le propriétaire payments.',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    { statement: 'idempotence stricte sur tout webhook/callback externe',
      test: 'tests/invariants/payments.webhook-idempotency.test.js' },
    { statement: 'une capture PayPal ne confirme la commande que si elle est COMPLETED, en EUR et conforme au montant figé de la commande',
      test: 'tests/e2e-api/payments.paypal-amount-currency.e2e.test.js' },
    { statement: 'Mobile Money ne confirme jamais sur le body callback : le statut est relu chez le provider et montant/devise sont comparés au snapshot transactionnel',
      test: 'tests/unit/payment-mobile-money.test.js' },
    { statement: 'un callback Mobile Money perdu est repris par une réconciliation périodique bornée et idempotente',
      test: 'tests/unit/mobile-money-reconciliation.test.js' },
    'aucun secret de paiement en dur dans le code',
    { statement: 'un paiement confirme ne peut etre confirme deux fois',
      test: 'tests/invariants/payments.no-double-confirm.test.js' },
    'un provider activé en DB mais non configuré runtime reste indisponible (fail-closed, aucun fallback silencieux)',
  ],

};