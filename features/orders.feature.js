/**
 * @feature       orders
 * @type          feature
 * @domain        orders
 * @status        production
 * @owner         backend-core
 * @since         2025-09
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      docs/doctrine/BACKEND_FEATURE_REGISTRY.md
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
    ],
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
    ],
  },

  // ── Contrat d'interface ──────────────────────────────────────────────────
  contract: {
    exposes: [
      'GET/POST /api/orders',
      'GET /api/orders/:id',
      'POST /api/orders/:id/cancel',
      'GET /api/invoices/:token',
    ],
    consumes: [
      'wallet-loyalty (application credit)',
      'economic-engine (cout figure a la commande)',
      'logistics (rattachement colis)',
      'catalog (lecture produit)',
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
