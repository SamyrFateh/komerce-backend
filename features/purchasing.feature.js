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
      'tests/unit/purchasing-route.test.js',                        // couche HTTP routes/purchasing.js
      'tests/unit/purchasing-trigger-service.test.js',
      'tests/unit/receive-purchase-order.test.js',
      'tests/unit/repair-ordered-purchasing.test.js',
      'tests/unit/repair-ordered-without-purchase-orders.test.js',
      'tests/unit/purchasing-admin-service.test.js',
    ],
  },

  // ── Tables DB (vérifiées par grep .query() réel + headers @komerce-arch, ─
  // Lot O1.4 2026-07-12). purchase_orders est la table réellement propre à la
  // feature (créée, mise à jour de statut, receptionnée). suppliers et
  // product_suppliers sont écrites par routes/purchasing.js (gestion admin du
  // référentiel fournisseur) mais restent lues par catalog (connecteurs
  // fournisseurs) et logistics (rattachement colis) — propriété d'écriture
  // purchasing, lecture cross-feature normale ailleurs.
  // orders passe R → RW au Lot O2 : services/purchasing-admin-service.js
  // (retaggé depuis dashboard) y écrit également (outils admin de correction).
  db: {
    tables: [
      'alerts: W',              // purchasing-trigger-service.js (échec déclenchement), repair-ordered-without-purchase-orders.js
      'order_items: R',
      'orders: RW',
      'product_suppliers: RW',
      'products: R',
      'purchase_orders: RW',
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
    // O7.3 (provider purchasing) : formalise deux services déjà propres
    // (service-à-service, aucune route utilisée comme API interne) mais
    // jamais déclarés. Aucun wrapper créé. Voir docs/O7_3_BOUNDARY_ANALYSIS.md.
    internalApi: [
      { fn: 'triggerPurchasing', file: 'services/purchasing-trigger-service.js' },
      { fn: 'repairOrderedWithoutPurchaseOrders', file: 'services/repair-ordered-without-purchase-orders.js' },
    ],
    consumes: [
      'infrastructure (dépendance technique transversale observée : DB, logger, helpers ou bootstrap possédés par infrastructure)',
      'orders (lecture : order_items, orders — le besoin d\'achat naît d\'une commande client)',
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
  authority: 'backend-core — tout changement du flux d\'engagement fournisseur (déclenchement, confirmation, réception) doit être validé par le propriétaire de services/purchasing-trigger-service.js et services/purchasing-receive-service.js',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    { statement: 'un besoin d\'achat déjà couvert par un bon de commande existant ne recrée jamais de doublon (idempotence applicative anti-replay, I-SWEEP-3B)',
      test: 'tests/e2e-api/purchasing.no-duplicate-po.e2e.test.js' },
    'purchasing peut consommer et lire la commande cliente, mais ne possède jamais son cycle de vie — toute mutation de orders.status continue de passer exclusivement par order-status-machine.js (feature orders)',
    'une réception ne peut être appliquée qu\'à un bon de commande existant et cohérent',
  ],

  // ── Classification (manifest créé au Lot O1.4) ──────────────────────────
  classification: {
    kind:     'business-feature',
    decision: 'feature-autonome',
    signals: {
      ownsTables:          true,   // purchase_orders + écriture suppliers/product_suppliers
      ownsLifecycle:       true,   // statut du bon de commande (créé → confirmé → reçu), idempotence anti-replay
      activeService:       true,   // "transformer", "déclencher", "constater" — verbes actifs
      multiConsumer:       false,  // consommé principalement par routes/purchasing.js et le flux hub (routes/cash.js)
      ownsMigrations:      false,  // tables historiques (purchase_orders, suppliers), pas de migration dédiée trouvée
      externalSideEffect:  'outbound-message',  // notification fournisseur (WhatsApp / admin)
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
