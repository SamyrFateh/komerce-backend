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
      'services/cash-reminder-service.js',
      'services/paypal-client.js',
      'services/payment-paypal.js',
      'services/payment-cash-confirm.js',
      'services/payment-stripe.js',
      'services/create-stripe-order-intent.js',
      'services/confirm-pickup-cash-payment.js',
      'services/payment-paypal-events.js',
      'services/cash-operations.js',
    ],
    routes: [
      'routes/cash.js',
      'routes/payments.js',
      'routes/pickup-pay-cash.js',
      'routes/payments-paypal.js',
    ],
    boutique: [
      'js/b-checkout.js',
      'js/b-checkout-render.js',
      'js/b-paypal.js',
      'js/event-pay.js',
    ],
  },

  // ── Dépôts ───────────────────────────────────────────────────────────────
  repos: {
    backend: 'services/ + routes/ ci-dessus',
    boutique: 'js/b-checkout*.js + js/b-paypal.js + js/event-pay.js — dépôt "bout", voir docs/BOUTIQUE_OWNERSHIP_LIVE.md',
  },

  // ── Contrat d'interface ──────────────────────────────────────────────────
  contract: {
    exposes: [
      'POST /api/payments/stripe/intent',
      'POST /api/payments/paypal/webhook',
      'POST /api/payments/cash/confirm',
    ],
    consumes: [
      'orders (commande a payer)',
      'auth-identity (verification du payeur)',
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — tout changement de webhook ou de logique d\'idempotence doit etre valide par le proprietaire de payment-service.js',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    'idempotence stricte sur tout webhook (Stripe, PayPal)',
    'aucun secret de paiement en dur dans le code',
    'un paiement confirme ne peut etre confirme deux fois',
  ],

};
