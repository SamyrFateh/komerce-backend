/**
 * @feature       orders
 * @type          feature
 * @domain        orders
 * @status        production
 * @owner         backend-core
 * @since         2025-09
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 */
'use strict';

module.exports = {

  // ── Identite ─────────────────────────────────────────────────────────────
  name:     'orders',
  type:     'feature',   // feature | transversal
  domain:   'orders',
  status:   'production',   // draft | staging | production | deprecated
  owner:    'backend-core',
  since:    '2025-09',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  // ── Service rendu ────────────────────────────────────────────────────────
  service: 'Faire exister une commande, de la creation au statut final, avec un cout figure et une reference lisible.',

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'creation, annulation, machine de statut de la commande',
      'snapshot de cout a la commande',
      'rattachement aux colis et aux achats fournisseurs',
      'facturation et token public de facture',
      'collecte QR au retrait',
    ],
    out: [
      'encaissement du paiement (feature payments)',
      'logique panier partage (feature shared-cart, consommatrice d\'orders)',
      'remboursement (feature refunds, lecture seule sur orders)',
      'tarification (feature economic-engine, orders ne fait que la consommer)',
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  files: {
    utils: [
      'utils/orderParcelLinkRules.js',
    ],
    services: [
      'services/order-service.js',
      'services/verify-qr-collection.js',
      'services/repair-ordered-without-purchase-orders.js',
      'services/invoice-service.js',
      'services/order-cost-snapshot.js',
      'services/invoice-public-token.js',
      'services/receive-purchase-order.js',
      'services/order-status-machine.js',
      'services/repair-ordered-purchasing.js',
      'services/admin-order-refund.js',
      'services/cancel-order-purchase-orders.js',
    
      'services/order-payment-confirmation.js',
      'services/purchasing-receive-service.js',
      'services/purchasing-trigger-service.js',],
    routes: [
      'routes/admin/orders.js',
      'routes/admin/delete-order-cascade.js',
      'routes/orders.js',
      'routes/orders/detail.js',
      'routes/orders/parcels.js',
      'routes/orders/status.js',
      'routes/orders/create.js',
      'routes/orders/qr.js',
      'routes/orders/list.js',
      'routes/orders/cancel.js',
      'routes/hub-mark-ordered.js',
      'routes/invoices.js',
      'routes/order-api-v2.js',
    
      'routes/purchasing.js',],
      migrations: [
      'migrations/049_pickup_secret_attempts.sql',
      'migrations/060_add_pending_at_confirmed_at.sql',
    ],
      tests: [
      'tests/unit/admin-order-refund.test.js',
      'tests/unit/cancel-order-purchase-orders.test.js',
      'tests/unit/delete-order-cascade.test.js',
      'tests/unit/hub-mark-ordered.test.js',
      'tests/unit/invoice-public-token.test.js',
      'tests/unit/invoices-route.test.js',
      'tests/unit/order-api-v2.test.js',
      'tests/unit/order-cost-snapshot.test.js',
      'tests/unit/order-payment-confirmation.test.js',
      'tests/unit/order-service.test.js',
      'tests/unit/orderParcelLinkRules.test.js',
      'tests/unit/orders-parcels-route.test.js',
      'tests/unit/parcels-route.test.js',
      'tests/unit/parcels.test.js',
      'tests/unit/qr.test.js',
      'tests/unit/receive-purchase-order.test.js',
      'tests/unit/repair-ordered-purchasing.test.js',
      'tests/unit/verify-qr-collection.test.js',
      'tests/integration/admin-order-refund-payment-service.test.js',
      'tests/unit/cash-operations.test.js',
      'tests/unit/confirm-payment-cycle.test.js',
      'tests/unit/order-status-machine.test.js',
      'tests/unit/repair-ordered-without-purchase-orders.test.js',
    ],
  },

  // ── Contrat d'interface ──────────────────────────────────────────────────
  docs: [],

  contract: {
    exposes: [
      'GET/POST /api/orders',
      'GET /api/orders/:id',
      'POST /api/orders/:id/cancel',
      'GET /api/invoices/:token',
    ],
    consumes: ['wallet (application credit)',
      'economic-engine (cout figure a la commande)',
      'logistics (rattachement colis)',
      'catalog (lecture produit)',
      'auth',
      'customs',
      'dashboard',
      'documents',
      'notification',
      'payment',
      'refunds',
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — tout changement de la machine de statut ou du schema order_reference doit etre valide par le proprietaire de order-status-machine.js',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    'reference de commande lisible et unique',
    'snapshot de cout figure a la creation, jamais recalcule retroactivement',
    'transition de statut uniquement via order-status-machine.js',
    'annulation libere les achats fournisseurs lies dans la meme transaction',
  ],

};
