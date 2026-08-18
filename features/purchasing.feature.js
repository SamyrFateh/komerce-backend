/**
 * @feature       purchasing
 * @type          feature
 * @domain        purchasing
 * @status        production
 * @owner         backend-core
 * @since         2025-09
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 */
'use strict';

module.exports = {

  // ── Identite ─────────────────────────────────────────────────────────────
  name:     'purchasing',
  type:     'feature',   // feature | transversal
  domain:   'purchasing',
  status:   'production',   // draft | staging | production | deprecated
  owner:    'backend-core',
  since:    '2025-09',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  // ── Service rendu ────────────────────────────────────────────────────────
  service: 'Transformer un besoin d\'approvisionnement issu d\'une commande en engagement fournisseur traçable (bon de commande), puis constater sa réception.',

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'déclenchement automatique d\'un bon de commande (purchase_order) quand une commande client nécessite un réassort fournisseur',
      'notification/confirmation du fournisseur (manuel ou WhatsApp) et suivi du statut du bon de commande',
      'réception (partielle ou totale) d\'un bon de commande, et rattachement au flux logistique',
      'synchronisation d\'annulation : pending/notified suivent l\'annulation de la commande ; les POs engagées déclenchent une alerte sans forçage',
      'réparation/rattrapage des commandes marquées "ordered" sans (ou avec) bon de commande cohérent (outils admin de correction)',
      'gestion des fournisseurs et de leur mapping produit (routes/purchasing.js /suppliers/*)',
      'administration transverse des bons de commande, historiquement exposée depuis le dashboard ' +
        '(services/purchasing-admin-service.js — retaggé @domain purchasing au Lot O2, ' +
        'écrit orders/product_suppliers/purchase_orders/suppliers)',
    ],
    out: [
      'cycle de vie de la commande cliente elle-même — orders reste seul propriétaire de order-status-machine.js ' +
        '(feature orders, scindée au Lot O1.4)',
      'confirmation de paiement client (order-payment-confirmation.js, reste dans orders)',
      'mouvement physique du colis une fois reçu (feature logistics, lecture seule sur purchase_orders/product_suppliers)',
      'entrée catalogue / import fournisseur en amont (feature catalog — sourcing/catalog-import, hors périmètre purchasing)',
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  docs: [],

  files: {
    services: [
      'services/purchasing-trigger-service.js',
      'services/purchasing-receive-service.js',
      'services/purchasing-cancel-service.js',
      'services/receive-purchase-order.js',
      'services/repair-ordered-purchasing.js',
      'services/repair-ordered-without-purchase-orders.js',
      'services/purchasing-admin-service.js',
    ],
    routes: [
      'routes/purchasing.js',
    ],
    migrations: [],
    tests: [
      // E2E fonctionnel Feature First — purchasing est PROPRIETAIRE ;
      // orders, catalog et logistics sont traversees.
      'tests/e2e-api/purchasing.no-duplicate-po.e2e.test.js',
      'tests/unit/purchasing.test.js',                              // triggerPurchasing (purchasing-trigger-service)
      'tests/unit/purchasing-receive-service.test.js',
      'tests/unit/purchasing-cancel-service.test.js',
      'tests/unit/purchasing-route.test.js',                        // couche HTTP routes/purchasing.js
      'tests/unit/purchasing-trigger-service.test.js',
      'tests/unit/receive-purchase-order.test.js',
      'tests/unit/repair-ordered-purchasing.test.js',
      'tests/unit/repair-ordered-without-purchase-orders.test.js',
      'tests/unit/purchasing-admin-service.test.js',
    ],
  },

  // ── Tables DB (vérifiées par grep .query() réel + headers @komerce-arch, ─
  // Lot O1.4 2026-07-12 ; revérifié campagne WNO 2026-08). purchase_orders est
  // la table propre à la feature : création, statut, réception ET synchronisation
  // d'annulation sont désormais toutes portées par purchasing.
  // suppliers et product_suppliers sont écrites par routes/purchasing.js
  // mais restent lues par catalog et logistics — lecture cross-feature normale.
  // orders passe R → RW au Lot O2 : services/purchasing-admin-service.js
  // y écrit également (outils admin de correction).
  db: {
    tables: [
      'order_items: R',
      'orders: R',  // W-via orders/order-mutation-service ? LOT11
      'product_suppliers: RW',
      'products: R',
      'purchase_orders: RW!',  // OWNER (campagne WRITER-NOT-OWNER, 2026-08)
      'relais: R',
      'suppliers: RW',
    ],
  },

  security: {
    status: 'CONFIRMED_PROTECTED',
    authedRoutesDetected: 10,
    totalRoutes: 10,
    note: '10/10 routes protégées (guard admin appliqué sur chaque route de routes/purchasing.js — GET/POST/DELETE confondus, y compris le référentiel fournisseur).',
  },
  contract: {
    exposes: [
      'GET /api/purchasing',
      'GET /api/purchasing/suppliers',
      'POST /api/purchasing/suppliers',
      'POST /api/purchasing/suppliers/:id/map',
      'DELETE /api/purchasing/suppliers/:id',
      'GET /api/purchasing/order/:order_id/completeness',
      'GET /api/purchasing/:order_id',
      'POST /api/purchasing/:order_id/confirm',
      'POST /api/purchasing/:id/receive',
      'DELETE /api/purchasing/po/:po_id',
    ],
    // Frontières service-à-service : purchasing reste l'autorité et les
    // consommateurs déclenchent une capacité, jamais un SQL dans ses tables.
    internalApi: [
      { fn: 'triggerPurchasing', file: 'services/purchasing-trigger-service.js' },
      { fn: 'repairOrderedWithoutPurchaseOrders', file: 'services/repair-ordered-without-purchase-orders.js' },
      { fn: 'syncPurchaseOrdersOnOrderCancel', file: 'services/purchasing-cancel-service.js' },
    ],
    consumes: [
      'infrastructure (dépendance technique transversale observée : DB, logger, helpers ou bootstrap possédés par infrastructure)',
      'orders (lecture : order_items, orders — le besoin d\'achat et l\'intention d\'annulation naissent d\'une commande client)',
      'auth (garde admin)',
      'notifications (notification fournisseur WhatsApp, via services/notification-service.js)',
      'logistics (declenche scan preparation + notification client apres reception hub complete — services/scan-operations.js triggerScan3, O7.2 Cycle C)',
    ],
  },

  // ── Dette assumée / documentée ────────────────────────────────────────────
  debt: {
    knownGaps: [
      { gap: 'services/purchasing-admin-service.js écrit purchase_orders, product_suppliers, suppliers ' +
             'et orders, et est consommé par routes/purchasing.js — mais son header porte encore ' +
             '@domain dashboard (rattaché historiquement au manifest dashboard.feature.js). Son service ' +
             'réel est un service d\'achat (purchasing), pas une projection dashboard.',
        risk: 'multi-writer réel non résolu sur purchase_orders/suppliers/product_suppliers entre ' +
              'purchasing (ce manifest) et dashboard (via purchasing-admin-service.js) — documenté en ' +
              'ONTOLOGY_GAP plutôt que déplacé sans audit de flux (hors périmètre O1.4, qui liste ' +
              'explicitement les 5 services + routes/purchasing.js comme seul ownership candidat vérifié).',
      },
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — tout changement du flux d\'engagement fournisseur (déclenchement, confirmation, réception, annulation) doit rester derrière les services propriétaires purchasing',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    { statement: 'un besoin d\'achat déjà couvert par un bon de commande existant ne recrée jamais de doublon (idempotence applicative anti-replay, I-SWEEP-3B)',
      test: 'tests/e2e-api/purchasing.no-duplicate-po.e2e.test.js' },
    'purchasing peut consommer et lire la commande cliente, mais ne possède jamais son cycle de vie — toute mutation de orders.status continue de passer exclusivement par order-status-machine.js (feature orders)',
    'une réception ne peut être appliquée qu\'à un bon de commande existant et cohérent',
    'aucun consommateur cross-feature ne modifie purchase_orders directement : la synchronisation d\'annulation passe par purchasing-cancel-service.js',
  ],

  // ── Classification (manifest créé au Lot O1.4) ──────────────────────────
  classification: {
    kind:     'business-feature',
    decision: 'feature-autonome',
    signals: {
      ownsTables:          true,   // purchase_orders + écriture suppliers/product_suppliers
      ownsLifecycle:       true,   // statut du bon de commande (créé → confirmé → reçu/annulé), idempotence anti-replay
      activeService:       true,   // "transformer", "déclencher", "constater" — verbes actifs
      multiConsumer:       false,
      ownsMigrations:      false,
      externalSideEffect:  'outbound-message',
      surface:             'api',
    },
    rationale: [
      'possède sa propre table (purchase_orders) avec un cycle de statut et un invariant d\'idempotence anti-replay propres',
      'scindé de orders (Lot O1.4, 2026-07-12) : orders fait exister la commande cliente et garantit son cycle d\'état ' +
        '(order-status-machine.js) ; purchasing transforme un besoin d\'approvisionnement en engagement fournisseur — ' +
        'deux services métier distincts, orders consomme purchasing sans jamais lui déléguer son propre cycle de vie',
    ],
  },

};
