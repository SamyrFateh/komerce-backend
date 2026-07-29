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
      'engagement fournisseur : création, confirmation et réception d\'un bon de commande ' +
        '(feature purchasing, scindée d\'orders au Lot O1.4, 2026-07-12) — orders ne fait que ' +
        'consommer purchasing (lecture) et libérer les bons de commande liés à l\'annulation ' +
        '(cancel-order-purchase-orders.js, reste dans orders car appelé exclusivement par ' +
        'order-status-machine.js)',
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  docs: [
    'docs/doctrine/DOCTRINE_ANNULATION.md',
  ],

  files: {
    utils: [
      'utils/orderParcelLinkRules.js',
    ],
    services: [
      'services/order-service.js',
      'services/verify-qr-collection.js',
      'services/qr-collection-core.js',
      'services/invoice-service.js',
      'services/order-cost-snapshot.js',
      'services/invoice-public-token.js',
      'services/order-status-machine.js',
      'services/admin-order-refund.js',
      'services/cancel-order-purchase-orders.js',
      'services/order-payment-confirmation.js',
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
      'tests/unit/parcels.test.js',
      'tests/unit/qr.test.js',
      'tests/unit/verify-qr-collection.test.js',
      'tests/integration/admin-order-refund-payment-service.test.js',
      'tests/unit/cash-operations.test.js',
      'tests/unit/confirm-payment-cycle.test.js',
      'tests/unit/order-status-machine.test.js',
      // Rapatriés depuis features/notification.feature.js (doublon singulier
      // supprimé, audit 2026-07-06 §2d) — mal rangés là-bas : ils testent en
      // réalité routes/orders.js et ses sous-routers (déjà possédés ci-dessus
      // dans files.routes), pas le domaine notification.
      'tests/unit/orders-aggregator-route.test.js',
      'tests/unit/orders-cancel-route.test.js',
      'tests/unit/orders-create-route.test.js',
      'tests/unit/orders-detail.test.js',
      'tests/unit/orders-list.test.js',
      'tests/unit/orders-status-route.test.js',
      'tests/unit/invoice-service.test.js',
    ],
  },

  // ── Contrat d'interface ──────────────────────────────────────────────────
  // ── Tables DB (inféré, audit 2026-07-06, §axe2 ; revérifié Lot O1.4 2026-07-12) ─
  // Généré par parsing réel des appels .query() (pas un grep de mots) :
  // R = lu par cette feature, W = écrit par cette feature, RW = les deux.
  // Une table listée ici pour PLUSIEURS features est une vraie propriété
  // partagée détectée dans le code, pas un artefact de méthode — à
  // documenter explicitement si volontaire, ou à re-scoper sinon.
  // Champ auto-généré : à corriger à la main si une requête dynamique
  // (nom de table construit par variable) a échappé au scan.
  //
  // purchase_orders reste ici en RW mais désormais réduit à une seule
  // responsabilité : cancel-order-purchase-orders.js (appelé exclusivement par
  // order-status-machine.js) libère les bons de commande liés à l'annulation
  // d'une commande. La création, confirmation et réception d'un bon de commande
  // appartiennent désormais à la feature purchasing (scindée d'orders au Lot
  // O1.4). product_suppliers et suppliers ont quitté orders — plus aucun
  // fichier resté dans orders ne les touche (vérifié par grep, 2026-07-12).
  db: {
    tables: [
      'alerts: W',
      'cart_shares: W',
      'customs_history: W',
      'disputes: W',
      'invoices: RW',
      'order_comments: W',
      'order_item_cost_imputations: RW',
      'order_items: RW',
      'order_status_history: RW',
      'orders: RW',
      'parcel_items: R',
      'parcels: R',
      'product_variants: R',  // W-via:product-admin-service (adjustStock variantes)
      'products: R',          // W-via:product-admin-service (adjustStock — order-payment-confirmation.js, order-status-machine.js)
      'purchase_orders: RW',  // désormais restreint à la libération à l'annulation (cancel-order-purchase-orders.js) — voir note ci-dessus
      'recipients: RW',
      'refunds: R',
      'relais: R',
      'scans: W',
      'sms_log: W',
      'users: R',
    ],
  },

  security: {
    status: 'CONFIRMED_MIXED',
    authedRoutesDetected: 31,
    totalRoutes: 33,
    note: "31/33 routes protégées. 2 routes publiques par design : GET /api/invoices/public/:token (token de facture partageable, lecture seule) ; GET /api/orders/retrait/:token (capability token QR de retrait, validé côté service par verify-qr-collection.js). (Recompté après scission de la feature purchasing, Lot O1.4, 2026-07-12 : 10 routes /api/purchasing/** retirées, toutes authentifiées.)",
  },
  contract: {
    exposes: [
      'GET/POST /api/orders',
      'GET /api/orders/:ref',
      'POST /api/orders/:id/cancel',
      'GET /api/invoices/public/:token',
      // Rapatriées depuis le route-registry (audit 2026-07-06, lot interface-inverse)
      // — routes réelles câblées via bootstrap/api-routes.js, jamais déclarées jusqu'ici.
      'GET /api/admin/orders',
      'DELETE /api/admin/orders/:id',
      'POST /api/admin/orders/:id/refund',
      'POST /api/hub/orders/mark-ordered',
      'GET /api/invoices',
      'GET /api/invoices/:orderId',
      'POST /api/invoices/:orderId/deliver',
      'GET /api/invoices/:orderId/download',
      'GET /api/invoices/:orderId/json',
      'POST /api/orders/:id/cancel-backorder',
      'PATCH /api/orders/:id/cost',
      'GET /api/orders/:id/history',
      'POST /api/orders/:id/mark-availability',
      'GET /api/orders/:id/parcels',
      'POST /api/orders/:id/partial-ship',
      'POST /api/orders/:id/qr-token',
      'PATCH /api/orders/:id/status',
      'GET /api/orders/:id/sub-orders',
      'GET /api/orders/credits',
      'PATCH /api/orders/parcels/:parcelId/status',
      'GET /api/orders/problems',
      'GET /api/orders/relais',
      'GET /api/orders/retrait/:token',
      'PATCH /api/orders/sub-orders/:subId/status',
      'GET /api/v2/orders',
      'GET /api/v2/orders/:ref',
      'POST /api/v2/orders/:ref/confirm-cash',
      'POST /api/v2/orders/:ref/create-parcel',
      'GET /api/v2/orders/pending-cash',
      'GET /api/v2/orders/ready-for-parcel',
    ],
    // O7.3 (provider orders) : formalise transitionOrderStatus() comme
    // capacité exposée cross-feature. Ownership déjà confirmé O7.1 (WRITER !=
    // LIFECYCLE OWNER — orders reste seul lifecycle owner, le simulateur ne
    // fait que déclencher via cette fonction, jamais d'écriture directe sur
    // orders.status). Le reste de la state machine (ORDER_STATUSES,
    // VALID_TRANSITIONS, TRANSITION_ROLES, STATUS_RANK, STATUS_TIMESTAMP,
    // isForwardTransition, appendOrderHistoryNote) reste interne à orders,
    // non exposé cross-feature. Voir docs/O7_3_BOUNDARY_ANALYSIS.md.
    internalApi: [
      { fn: 'transitionOrderStatus', file: 'services/order-status-machine.js' },
    ],
    consumes: [
      "business-rules (FF-C1 2026-07-29 — lecture du référentiel de règles métier ; preuve: routes/orders/create.js -> utils/rules.js ; routes/orders/qr.js -> utils/rules.js ; routes/orders/list.js -> utils/rules.js ; +1)",
'wallet (application credit)',
      'economic-engine (cout figure a la commande)',
      'logistics (rattachement colis)',
      'catalog (lecture produit)',
      'purchasing (lecture — engagement fournisseur déclenché par une commande ; scindée d\'orders au Lot O1.4)',
      'loyalty (remise palier au checkout + recalcul apres commande — services/loyalty-service.js getLoyaltyDiscount/recalculateLoyalty, O7.3 provider loyalty)',
      'payments (marque un remboursement — services/payment-service.js markRefunded, O7.3 provider payments)',
      'auth',
      'customs',
      'dashboard',
      'documents',
      'notification',
      'payment',
      'refunds',
    ],
  },

  // ── Dette assumée / documentée ────────────────────────────────────────────
  // (audit 2026-07-06, §2b — corrigé après vérification empirique du code réel :
  // le contrat déclaré n'était pas simplement désynchronisé du nom de route,
  // il pointait vers un chemin qui n'a jamais existé sous cette forme exacte.)
  debt: {
    knownGaps: [
      { gap: 'ancien contrat déclaré "GET /api/invoices/:token" (sans /public) : ' +
             'aucune route ne sert ce chemin exact. Le vrai mécanisme public par ' +
             'jeton existe bien, mais sous /api/invoices/public/:token (routes/invoices.js). ' +
             'Un second mécanisme, GET /api/client/invoices (session authentifiée, ' +
             'routes/client-auth.js), coexiste mais appartient à une autre feature — ' +
             'orders ne le possède pas et ne doit pas le déclarer dans son propre contrat.',
        risk: 'si un client externe (app mobile, intégration WhatsApp) construit encore ' +
              'l\'URL sans /public, il reçoit un 404 — à vérifier avant de considérer ' +
              'ce point clos.',
      },
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — tout changement de la machine de statut ou du schema order_reference doit etre valide par le proprietaire de order-status-machine.js',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    'annulation libre et 100% avant ordered (plancher 24h) ; commande ferme des ordered — demande wallet-only ensuite (DOCTRINE_ANNULATION)',
    'le badge Remboursable/Ferme du suivi EST le contrat : il ne dit jamais autre chose que ce que le code fait',
    { statement: 'tout remboursement retourne au payeur, jamais au destinataire',
      test: 'tests/invariants/orders.refund-to-payer.test.js' },
    'reference de commande lisible et unique',
    'snapshot de cout figure a la creation, jamais recalcule retroactivement',
    'transition de statut uniquement via order-status-machine.js',
    'annulation libere les achats fournisseurs lies dans la meme transaction',
  ],

};
