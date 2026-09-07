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
      'collecte QR au retrait',
      'projection checkout boutique : finalisation d’une sélection en commande, sans ownership de l’encaissement',
    ],
    out: [
      'encaissement du paiement (feature payments)',
      'logique panier partage (feature shared-cart, consommatrice d\'orders)',
      'remboursement (feature refunds, lecture seule sur orders)',
      'tarification (feature economic-engine, orders ne fait que la consommer)',
      'matérialisation, conservation et téléchargement des factures (feature documents ; orders ne fournit que l’événement confirmé et les données source)',
      'engagement fournisseur : création, confirmation, réception et annulation d\'un bon de commande ' +
        '(feature purchasing, scindée d\'orders au Lot O1.4, 2026-07-12) — orders déclenche ' +
        'la synchronisation d\'annulation via l\'API interne purchasing, sans SQL direct sur purchase_orders',
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  docs: [
    'docs/doctrine/DOCTRINE_ANNULATION.md',
    'docs/doctrine/CHECKOUT_UNIFIED_ATTACK.md',
  ],

  files: {
    utils: [
      'utils/orderParcelLinkRules.js',
    ],
    services: [
      'services/order-service.js',
      'services/verify-qr-collection.js',
      'services/qr-collection-core.js',
      'services/order-cost-snapshot.js',
      'services/order-display-snapshot.js',
      'services/order-status-machine.js',
      'services/order-checkout-service.js',
      'services/order-checkout-item-resolution.js',
      'services/order-checkout-persistence.js',
      'services/order-post-commit-hooks.js',
      'services/admin-order-refund.js',
      'services/cancel-order-purchase-orders.js',
      'services/order-payment-confirmation.js',
      'services/order-item-availability-service.js',
      'services/order-mutation-service.js',
      'services/payment-service.js',
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
      'routes/order-api-v2.js',
    ],
    boutique: [
      // Projection checkout frontend canonique — décision produit 2026-08.
      // Le domaine UI reste "checkout", mais l'owner métier est orders.
      'js/b-checkout.js',
      'js/b-checkout-render.js',
      'css/checkout-vertical-rail.css',
    ],
    tests: [
      // E2E fonctionnel — preuve d'unicite de remise (Lot 1 retrait-secours).
      'tests/e2e-api/orders.single-collect.e2e.test.js',
      // E2E fonctionnel Feature First — orders est PROPRIETAIRE ;
      // auth, catalog, logistics et business-rules sont traversees.
      'tests/e2e-api/orders.cancellation-doctrine.e2e.test.js',
      // E2E fonctionnel Feature First (chantier E2E positive-contracts).
      // Scénario vertical : orders est la feature PROPRIETAIRE ; auth,
      // catalog, payments et logistics sont traversées, pas co-proprietaires.
      'tests/e2e-api/orders.checkout-payment-cycle.e2e.test.js',
      'tests/unit/admin-order-refund.test.js',
      'tests/unit/cancel-order-purchase-orders.test.js',
      'tests/unit/delete-order-cascade.test.js',
      'tests/unit/hub-mark-ordered.test.js',
      'tests/unit/order-api-v2.test.js',
      'tests/unit/order-cost-snapshot.test.js',
      'tests/unit/order-display-snapshot.test.js',
      'tests/integration/order-display-snapshot.test.js',
      'tests/unit/order-payment-confirmation.test.js',
      'tests/unit/order-checkout-service-relay-boundary.test.js',
      'tests/unit/order-checkout-item-resolution.test.js',
      'tests/unit/order-checkout-persistence.test.js',
      'tests/unit/order-post-commit-hooks.test.js',
      'tests/unit/order-item-availability-service.test.js',
      'tests/unit/order-mutation-service.test.js',
      'tests/unit/payment-service.test.js',
      'tests/unit/order-service.test.js',
      'tests/unit/orderParcelLinkRules.test.js',
      'tests/unit/orders-parcels-route.test.js',
      'tests/unit/parcels.test.js',
      'tests/unit/qr.test.js',
      'tests/unit/qr-collection-core.test.js',
      'tests/unit/verify-qr-collection.test.js',
      'tests/integration/admin-order-refund-payment-service.test.js',
      'tests/unit/cash-operations.test.js',
      'tests/unit/confirm-payment-cycle.test.js',
      'tests/unit/order-status-machine.test.js',
      'tests/unit/order-status-client-notifications.test.js',
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
    ],
  },

  // ── Contrat d'interface ──────────────────────────────────────────────────
  // ── Tables DB (inféré, audit 2026-07-06, §axe2 ; revérifié campagne WNO 2026-08) ─
  // Généré par parsing réel des appels .query() (pas un grep de mots) :
  // R = lu par cette feature, W = écrit par cette feature, RW = les deux.
  // Une table listée ici pour PLUSIEURS features est une vraie propriété
  // partagée détectée dans le code, pas un artefact de méthode — à
  // documenter explicitement si volontaire, ou à re-scoper sinon.
  // Champ auto-généré : à corriger à la main si une requête dynamique
  // (nom de table construit par variable) a échappé au scan.
  //
  // LOT1 WRITER-NOT-OWNER : purchase_orders a quitté le périmètre DB d'orders.
  // cancel-order-purchase-orders.js est désormais un wrapper sans SQL vers
  // services/purchasing-cancel-service.js, propriétaire du lifecycle PO.
  db: {
    tables: [
      'customs_history: W',
      'disputes: W',
      'order_comments: W',
      'order_item_cost_imputations: RW',
      'order_items: RW!',  // OWNER (campagne WRITER-NOT-OWNER, 2026-08)
      'order_status_history: RW',
      'orders: RW!',  // OWNER (campagne WRITER-NOT-OWNER, 2026-08)
      'parcel_items: R',
      'parcels: R',
      'product_variants: R',  // W-via:product-admin-service (adjustStock variantes)
      'products: R',          // W-via:product-admin-service (adjustStock — order-payment-confirmation.js, order-status-machine.js)
      'recipients: RW',
      'refunds: R',
      'relais: R',
      'sms_log: W',
      'users: R',
    ],
  },

  security: {
    status: 'CONFIRMED_MIXED',
    authedRoutesDetected: 31,
    totalRoutes: 33,
    note: "La facture a été transférée à documents et n'expose plus de route publique. La seule capability publique restante dans orders est GET /api/orders/retrait/:token, validée par verify-qr-collection.js.",
  },
  contract: {
    exposes: [
      'GET/POST /api/orders',
      'GET /api/orders/:ref',
      'POST /api/orders/:id/cancel',
      // Rapatriées depuis le route-registry (audit 2026-07-06, lot interface-inverse)
      // — routes réelles câblées via bootstrap/api-routes.js, jamais déclarées jusqu'ici.
      'GET /api/admin/orders',
      'DELETE /api/admin/orders/:id',
      'POST /api/admin/orders/:id/refund',
      'POST /api/hub/orders/mark-ordered',
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
      // LOT11 ? persistence canonique orders.payment_status.
      // La matrice m?tier de transition reste fournie par payments/payment-status-validator.
      { fn: 'markPaid', file: 'services/payment-service.js' },
      { fn: 'markRefunded', file: 'services/payment-service.js' },
      { fn: 'markFailed', file: 'services/payment-service.js' },
      // Non-production uniquement : chaos-test explicite, écriture conservée chez l'owner payment.
      { fn: 'forcePaymentStatusForSimulation', file: 'services/payment-service.js' },
      { fn: 'setInventoryCompletion', file: 'services/order-mutation-service.js' },
      { fn: 'recomputeCustomsCosts', file: 'services/order-mutation-service.js' },
      { fn: 'backfillRoutingFields', file: 'services/order-mutation-service.js' },
      { fn: 'setStripePaymentId', file: 'services/order-mutation-service.js' },
      { fn: 'setPaypalOrderId', file: 'services/order-mutation-service.js' },
      { fn: 'setPaypalCaptureMetadata', file: 'services/order-mutation-service.js' },
      { fn: 'setPaypalCaptureId', file: 'services/order-mutation-service.js' },
      { fn: 'appendOrderNote', file: 'services/order-mutation-service.js' },
      { fn: 'markCashPaidAt', file: 'services/order-mutation-service.js' },
      { fn: 'markCashReminderSent', file: 'services/order-mutation-service.js' },
      { fn: 'setWalletApplied', file: 'services/order-mutation-service.js' },
      { fn: 'setSupplierSnapshot', file: 'services/order-mutation-service.js' },
      { fn: 'setComputedStatus', file: 'services/order-mutation-service.js' },
      { fn: 'writePickupSecret', file: 'services/order-mutation-service.js' },
      { fn: 'setPickupAttemptState', file: 'services/order-mutation-service.js' },
      { fn: 'setPickupAttemptsOnly', file: 'services/order-mutation-service.js' },
      { fn: 'setExceptionalPickupAttemptState', file: 'services/order-mutation-service.js' },
      { fn: 'setCollectedByName', file: 'services/order-mutation-service.js' },
      { fn: 'recordPickupRegeneration', file: 'services/order-mutation-service.js' },
      { fn: 'markPickupSecretRevealed', file: 'services/order-mutation-service.js' },
      { fn: 'finalizePickupCollection', file: 'services/order-mutation-service.js' },
      { fn: 'updateOrderItemAvailabilityDetails', file: 'services/order-item-availability-service.js' },
      { fn: 'setOrderItemAvailabilityStatus', file: 'services/order-item-availability-service.js' },
      // Projection frontend orders : points d'entrée consommés notamment
      // par shared-cart ; payment reste une capacité traversée.
      { fn: 'checkoutCart', file: 'public/boutique/js/b-checkout.js' },
      { fn: 'makeInput', file: 'public/boutique/js/b-checkout.js' },
    ],
    consumes: [
      'platform-ops (monitoring/exploitation transverse observé dans le code)',
      'infrastructure (dépendance technique transversale observée : DB, logger, helpers ou bootstrap possédés par infrastructure)',
      "business-rules (FF-C1 2026-07-29 — lecture du référentiel de règles métier ; preuve: routes/orders/create.js -> utils/rules.js ; routes/orders/qr.js -> utils/rules.js ; routes/orders/list.js -> utils/rules.js ; +1)",
'wallet (application credit)',
      'economic-engine (cout figure a la commande)',
      'logistics (rattachement colis)',
      'catalog (lecture produit)',
      'local-stock (Vague 2 D2 — allocateForOrderItem à la création de commande, ' +
        'consumeAllocationsForOrder/releaseAllocationsForOrder sur les transitions ' +
        'confirmed/cancelled ; preuve: routes/orders/create.js -> services/local-stock-service.js ; ' +
        'services/order-status-machine.js -> services/local-stock-service.js)',
      'market (P3 — resolveDisplaySnapshot() résout le contexte marché du client ' +
        'via utils/currency.js ; preuve: services/order-display-snapshot.js -> utils/currency.js)',
      'purchasing (engagement fournisseur + sync annulation via syncPurchaseOrdersOnOrderCancel ; aucun SQL direct orders -> purchase_orders)',
      'loyalty (remise palier au checkout + recalcul apres commande — services/loyalty-service.js getLoyaltyDiscount/recalculateLoyalty, O7.3 provider loyalty)',
      'payments (marque un remboursement — services/payment-service.js markRefunded, O7.3 provider payments)',
      'auth',
      'auth-identity (projection checkout boutique : identité client et téléphone)',
      'customs',
      'documents',
      'notifications (projection idempotente du retrait disponible)',
      'refunds',
      'shared-cart (projection frontend orders-client uniquement : consommation via shared-cart-surface-api.js / shared-cart-library-api.js ; aucun import direct des internes group/* ; côté backend, appelle services/cart-share-service.js markShareConvertedToOrder pour lier une commande à un lien de partage — campagne WRITER-NOT-OWNER 2026-08, plus de SQL direct sur cart_shares)',
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
    { statement: 'reference de commande lisible et unique',
      test: 'tests/e2e-api/orders.cancellation-doctrine.e2e.test.js' },
    { statement: 'snapshot de cout figure a la creation, jamais recalcule retroactivement',
      test: 'tests/e2e-api/orders.cancellation-doctrine.e2e.test.js' },
    'transition de statut uniquement via order-status-machine.js',
    'annulation libere les achats fournisseurs lies dans la meme transaction via purchasing',
  ],

  // ── Classification ────────────────────────────────────────────────────────
  classification: {
    axis:     'business',
    kind:     'business-feature',
    decision: 'feature-autonome',
    signals: {
      ownsTables:          true,
      ownsLifecycle:       true,
      activeService:       true,
      multiConsumer:       true,
      ownsMigrations:      false,
      externalSideEffect:  'none',
      surface:             'api+service',
    },
    rationale: [
      'possède le cycle de vie et la machine de statut de la commande, ainsi que ses invariants de transition',
      'expose la commande à plusieurs consommateurs métier sans posséder leurs cycles de paiement, document ou logistique',
      'la facture est un effet documentaire consommant la commande confirmée et appartient à documents',
    ],
  },

};
