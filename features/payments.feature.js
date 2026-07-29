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
  type:     'feature',   // feature | transversal
  domain:   'payment',
  status:   'production',   // draft | staging | production | deprecated
  owner:    'backend-core',
  since:    '2025-09',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  // ── Service rendu ────────────────────────────────────────────────────────
  service: 'Encaisser un paiement (carte, PayPal, especes au retrait) et confirmer son etat de facon idempotente.',

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'integration Stripe et PayPal (intent, webhook, evenements)',
      'paiement cash au retrait et relances cash',
      'confirmation de paiement et idempotence webhook',
    ],
    out: [
      'creation de la commande elle-meme (feature orders)',
      'remboursement (feature refunds, qui consomme payments en lecture)',
      'credit wallet (feature wallet-loyalty)',
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  files: {
    services: [
      'services/payment-service.js',
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
    
      'services/reconciliation-service.js',],
    routes: [
      'routes/cash.js',
      'routes/payments.js',
      'routes/pickup-pay-cash.js',
      'routes/payments-paypal.js',
    ],
    migrations: [
      'migrations/079_paypal_payment_mode.sql',
    ],
    boutique: [
      'js/b-checkout.js',
      'js/b-checkout-render.js',
      'js/b-paypal.js',
      // Backfill gouvernance globale : css/paypal.css est le seul CSS payment-specific
      // pertinent (cart.css est multi-domaine — panier personnel/checkout/OTP — laissé
      // en dette explicite, voir BOUTIQUE_COMPONENT_OWNERSHIP.md §Backfill).
      'css/paypal.css',
    ],
    tests: [
      'tests/unit/payment-cash-confirm.test.js',
      'tests/unit/payment-paypal.test.js',
      'tests/unit/payment-service.test.js',
      'tests/unit/payment-stripe.test.js',
      'tests/unit/payments-webhook.test.js',
      'tests/unit/paypal-client.test.js',
      'tests/unit/paypal-webhook.test.js',
      // Rapatriés depuis features/payment.feature.js (doublon supprimé,
      // audit 2026-07-06 §2c) — services/routes étaient déjà ici, seuls ces
      // tests traînaient encore dans l'ancien manifeste.
      'tests/unit/cash-operations-service.test.js',
      'tests/unit/cash-reminder-service.test.js',
      'tests/unit/cash-route.test.js',
      'tests/unit/confirm-pickup-cash-payment.test.js',
      'tests/unit/create-stripe-order-intent.test.js',
      'tests/unit/payment-paypal-events.test.js',
      'tests/unit/payments-paypal.test.js',
      'tests/unit/payments-route.test.js',
      'tests/unit/pickup-pay-cash.test.js',
      'tests/unit/reconciliation-service.test.js',
    ],
  },

  // ── Dépôts ───────────────────────────────────────────────────────────────
  repos: {
    backend: 'services/ + routes/ ci-dessus',
    boutique: 'js/b-checkout*.js + js/b-paypal.js — dépôt "bout", voir docs/BOUTIQUE_OWNERSHIP_LIVE.md',
  },

  // ── Contrat d'interface ──────────────────────────────────────────────────
  docs: [
    'docs/PAYPAL_IMPLEMENTATION_GUIDE.md',
    'docs/chantier/FLOW_AUDIT_CASH_G1.md',
    'docs/chantier/FLOW_AUDIT_STRIPE_G2.md',
    'docs/chantier/I_SWEEP_1_PICKUP_CASH_PATCH.md',
    'docs/chantier/STRIPE_WEBHOOK_AUDIT_D2.md',
    'docs/ops/PAYPAL_POSITIONNEMENT.md',
  ],

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
      'alerts: W',
      'cash_collections: RW',
      'cash_deposits: RW',
      'incidents: RW',
      'order_items: R',
      // order_status_history : W-via:order-status-machine (appendOrderHistoryNote — payment-paypal.js)
      'orders: RW',
      'parcel_items: R',
      'parcels: RW',
      'paypal_events_processed: RW',
      // refunds : W-via:refund-service (recordExternalRefund — payment-paypal.js)
      'scan_events: R',
      'stripe_events_processed: RW',
      'users: R',
    ],
  },

  security: {
    status: 'CONFIRMED_MIXED',
    authedRoutesDetected: 13,
    totalRoutes: 18,
    note: "13/18 routes protégées. 2 webhooks légitimement publics : POST /stripe/webhook (signature Stripe), POST /paypal/webhook (vérifié applicativement). 3 routes publiques par design : GET /api/payments/config (clés publiques), POST /api/payments/paypal/create-order et /capture/:id (flux de paiement boutique public — pas d'accès au profil client).",
  },
  contract: {
    exposes: [
      'POST /api/payments/stripe/intent',
      'POST /api/payments/paypal/webhook',
      'POST /api/payments/cash/confirm',
      // Rapatriées depuis le route-registry (audit 2026-07-06, lot interface-inverse)
      // — routes réelles câblées via bootstrap/api-routes.js, jamais déclarées jusqu'ici.
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
    // O7.3 (provider payments) : surface unique regroupant TOUS les
    // consumers cross-feature de payments (mission §7 — un provider, une
    // surface, pas une par consumer) :
    //   - markPaid : consommé par logistics (parcel-auto-create-service.js)
    //     et wallet (wallet-service.js), déclaré depuis O7.2 Cycle B/D.
    //   - markRefunded : consommé par orders (admin-order-refund.js), O7.3.
    //   - makeInput (frontend, b-checkout-render.js via b-checkout.js) :
    //     consommé par shared-cart (b-share-cart.js) pour un style de champ
    //     uniforme — réutilisation d'utilitaire UI, scope boutique, pas un
    //     service métier backend. Reste un import ES nommé simple (pas un
    //     barrel), déjà minimal. makeIntlPhoneInput a été retiré de ce
    //     périmètre (appartenait réellement à auth-identity, via b-phone.js —
    //     voir docs/O7_3_BOUNDARY_ANALYSIS.md).
    internalApi: [
      { fn: 'markPaid', file: 'services/payment-service.js' },
      { fn: 'markRefunded', file: 'services/payment-service.js' },
      { fn: 'makeInput', file: 'public/boutique/js/b-checkout.js' },
    ],
    consumes: [
      "platform-ops (FF-C1 2026-07-29 — monitoring et exploitation technique ; preuve: routes/payments.js -> services/monitoring.js)",

      "auth (FF-C1 2026-07-29 — garde de route et contexte d’identité ; preuve: routes/cash.js -> middleware/auth.js ; routes/payments.js -> middleware/auth.js ; routes/pickup-pay-cash.js -> middleware/auth.js ; +2)",

      "refunds (FF-C1 2026-07-29 — orchestration du remboursement ; preuve: services/payment-paypal.js -> services/refund-service.js)",

      "documents (FF-C1 2026-07-29 — émission ou lecture documentaire ; preuve: services/payment-paypal.js -> services/documents/refund-receipt.js)",

      "notifications (FF-C1 2026-07-29 — émission de message ; preuve: services/cash-reminder-service.js -> services/notification-service.js ; services/payment-paypal.js -> services/notification-service.js ; services/payment-cash-confirm.js -> services/notification-service.js ; +2)",

      "business-rules (FF-C1 2026-07-29 — lecture du référentiel de règles métier ; preuve: services/cash-reminder-service.js -> utils/rules.js)",

      'orders (commande a payer)',
      'auth-identity (verification du payeur)',
      'logistics (generation du code retrait pickup au moment du paiement — services/pickup-secret-service.js ; lecture du statut agrege colis pour reconciliation — utils/parcels.js ; O7.2 Cycle B)',
      'wallet (checkout consulte le solde applicable via /api/wallet — public/boutique/js/b-checkout.js, O7.2 Cycle D)',
      'loyalty (declenche le recalcul de palier apres paiement confirme — services/loyalty-service.js handleOrderConfirmed, O7.3 provider loyalty)',
      'purchasing (declenche verification/reapprovisionnement apres encaissement — services/purchasing-trigger-service.js triggerPurchasing, O7.3 provider purchasing)',
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — tout changement de webhook ou de logique d\'idempotence doit etre valide par le proprietaire de payment-service.js',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    { statement: 'idempotence stricte sur tout webhook (Stripe, PayPal)',
      test: 'tests/invariants/payments.webhook-idempotency.test.js' },
    'aucun secret de paiement en dur dans le code',
    { statement: 'un paiement confirme ne peut etre confirme deux fois',
      test: 'tests/invariants/payments.no-double-confirm.test.js' },
  ],

};
