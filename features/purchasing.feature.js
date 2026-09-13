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

  name:     'purchasing',
  type:     'feature',
  domain:   'purchasing',
  status:   'production',
  owner:    'backend-core',
  since:    '2025-09',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  service: 'Transformer un besoin d\'approvisionnement issu d\'une commande en engagement fournisseur traçable (bon de commande), puis constater sa réception.',

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
      'Supplier Order Identity universelle : une unité vendable doit se résoudre sans ambiguïté vers exactement une unité commandable fournisseur avant tout engagement',
      'Procurement Route canonique : l\'achat fournisseur est routé vers un Procurement Hub explicite avant la jambe logistique Market ; aucune destination client/Market brute ne peut être assimilée à la destination fournisseur',
      'préflight fournisseur AliExpress avant engagement : réconciliation SKU, stock/prix live, fret Supplier → Procurement Hub et construction fail-closed du payload d\'achat sans exécution automatique',
      'Supplier Fulfillment Readiness dynamique : évaluer SKU × quantité × Procurement Route à partir de l\'identité fournisseur persistée, du refresh live et du fret, sans mutation fournisseur',
      'Supplier Fulfillment Adapter Contract universel : chaque fournisseur déclare son provider et renvoie exclusivement les verdicts canoniques Purchasing, tandis que son payload natif reste opaque au coeur Komerce',
      'Purchase Order exacte : pour une ligne vendue avec sku_id, la PO conserve order_item_id, product_sku_id et la Supplier Order Identity snapshotée ; un mapping produit-level ne peut pas remplacer la variante vendue',
    ],
    out: [
      'cycle de vie de la commande cliente elle-même — orders reste seul propriétaire de order-status-machine.js ' +
        '(feature orders, scindée au Lot O1.4)',
      'confirmation de paiement client (order-payment-confirmation.js, reste dans orders)',
      'mouvement physique du colis une fois reçu (feature logistics, lecture seule sur purchase_orders/product_suppliers)',
      'entrée catalogue / import fournisseur en amont (feature catalog — sourcing/catalog-import, hors périmètre purchasing)',
    ],
  },

  docs: [
    'docs/doctrine/DOCTRINE_SUPPLIER_ORDER_IDENTITY.md',
    'docs/doctrine/DOCTRINE_PROCUREMENT_FULFILLMENT.md',
  ],

  files: {
    services: [
      'services/purchasing-trigger-service.js',
      'services/suppliers/supplier-order-identity.js',
      'services/suppliers/aliexpress-purchase-preflight.js',
      'services/suppliers/supplier-fulfillment-adapter-contract.js',
      'services/suppliers/supplier-fulfillment-readiness.js',
      'services/suppliers/aliexpress-fulfillment-adapter.js',
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
    migrations: [
      'migrations/225_purchase_orders_exact_supplier_identity.sql',
    ],
    tests: [
      'tests/e2e-api/purchasing.no-duplicate-po.e2e.test.js',
      'tests/integration/purchasing-exact-sku-po.test.js',
      'tests/unit/purchasing.test.js',
      'tests/unit/purchasing-receive-service.test.js',
      'tests/unit/purchasing-cancel-service.test.js',
      'tests/unit/purchasing-route.test.js',
      'tests/unit/purchasing-trigger-service.test.js',
      'tests/unit/supplier-order-identity.test.js',
      'tests/unit/aliexpress-purchase-preflight.test.js',
      'tests/unit/supplier-fulfillment-adapter-contract.test.js',
      'tests/unit/supplier-fulfillment-readiness.test.js',
      'tests/unit/receive-purchase-order.test.js',
      'tests/unit/repair-ordered-purchasing.test.js',
      'tests/unit/repair-ordered-without-purchase-orders.test.js',
      'tests/unit/purchasing-admin-service.test.js',
    ],
  },

  db: {
    tables: [
      'order_items: R',
      'orders: R',
      'product_skus: R',
      'product_suppliers: RW',
      'products: R',
      'purchase_orders: RW!',
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
    internalApi: [
      { fn: 'triggerPurchasing', file: 'services/purchasing-trigger-service.js' },
      { fn: 'resolveSupplierUnit', file: 'services/suppliers/supplier-order-identity.js' },
      { fn: 'validateAdapter', file: 'services/suppliers/supplier-fulfillment-adapter-contract.js' },
      { fn: 'evaluateSupplierFulfillmentReadiness', file: 'services/suppliers/supplier-fulfillment-readiness.js' },
      { fn: 'repairOrderedWithoutPurchaseOrders', file: 'services/repair-ordered-without-purchase-orders.js' },
      { fn: 'syncPurchaseOrdersOnOrderCancel', file: 'services/purchasing-cancel-service.js' },
    ],
    consumes: [
      'catalog (contrat V2 sellable_units + Supplier Order Identity fournie par les connecteurs)',
      'infrastructure (dépendance technique transversale observée : DB, logger, helpers ou bootstrap possédés par infrastructure)',
      'orders (lecture : order_items, orders — le besoin d\'achat et l\'intention d\'annulation naissent d\'une commande client)',
      'auth (garde admin)',
      'notifications (notification fournisseur WhatsApp, via services/notification-service.js)',
      'logistics (declenche scan preparation + notification client apres reception hub complete — services/scan-operations.js triggerScan3, O7.2 Cycle C)',
    ],
  },

  debt: {
    knownGaps: [
      { gap: 'services/purchasing-admin-service.js écrit purchase_orders, product_suppliers, suppliers ' +
             'et orders, et est consommé par routes/purchasing.js — mais son header porte encore ' +
             '@domain dashboard (rattaché historiquement au manifest dashboard.feature.js). Son service ' +
             'réel est un service d\'achat (purchasing), pas une projection dashboard.',
        risk: 'multi-writer réel non résolu sur purchase_orders/suppliers/product_suppliers entre ' +
              'purchasing (ce manifest) et dashboard (via purchasing-admin-service.js) — documenté en ' +
              'ONTOLOGY_GAP plutôt que déplacé sans audit de flux.',
      },
    ],
  },

  authority: 'backend-core — tout changement du flux d\'engagement fournisseur (identité commandable, Procurement Route, contrat d\'adapter, readiness dynamique, déclenchement, confirmation, réception, annulation) doit rester derrière les services propriétaires purchasing',

  invariants: [
    { statement: 'un besoin d\'achat déjà couvert par un bon de commande existant ne recrée jamais de doublon (idempotence applicative anti-replay, I-SWEEP-3B)',
      test: 'tests/e2e-api/purchasing.no-duplicate-po.e2e.test.js' },
    { statement: 'une ligne LOCAL_STOCK ne crée jamais de Purchase Order fournisseur ; seules les lignes IMPORT appartiennent au procurement fournisseur',
      test: 'tests/unit/purchasing-trigger-service.test.js' },
    { statement: 'si order_items.sku_id est renseigné, la Purchase Order doit conserver exactement ce product_sku_id, son supplier_unit_ref et sa Supplier Order Identity ; product_suppliers ne peut pas substituer un supplier_sku générique',
      test: 'tests/integration/purchasing-exact-sku-po.test.js' },
    { statement: 'une unité ne devient jamais commandable par heuristique : Supplier Order Identity absente ou ambiguë = blocage',
      test: 'tests/unit/supplier-order-identity.test.js' },
    { statement: 'tout adapter fulfillment est provider-scopé, traite un payload d\'identité opaque et ne peut émettre que les verdicts canoniques Purchasing avec ready cohérent',
      test: 'tests/unit/supplier-fulfillment-adapter-contract.test.js' },
    { statement: 'Fulfillment Ready est un verdict dynamique SKU × quantité × Procurement Route ; identité résolue seule ne suffit pas et aucun preflight ne peut appeler placeOrder ni un paiement',
      test: 'tests/unit/supplier-fulfillment-readiness.test.js' },
    { statement: 'la destination fournisseur est dérivée d\'une Procurement Route explicite ; le moteur actuel n\'ouvre que PROCUREMENT_HUB et refuse une destination Market/client brute ainsi que tout mode direct fournisseur-client implicite',
      test: 'tests/unit/supplier-fulfillment-readiness.test.js' },
    { statement: 'pour AliExpress freight.calculate, l\'identité SKU reste résolue en amont mais le fret utilise uniquement le DTO complexe produit × quantité × destination hub encapsulé sous param_aeop_freight_calculate_for_buyer_d_t_o ; aucun sku_id n\'est inventé',
      test: 'tests/unit/aliexpress-purchase-preflight.test.js' },
    'purchasing peut consommer et lire la commande cliente, mais ne possède jamais son cycle de vie — toute mutation de orders.status continue de passer exclusivement par order-status-machine.js (feature orders)',
    'une réception ne peut être appliquée qu\'à un bon de commande existant et cohérent',
    'aucun consommateur cross-feature ne modifie purchase_orders directement : la synchronisation d\'annulation passe par purchasing-cancel-service.js',
    "tout message WhatsApp fournisseur part d un purchase_order déjà persisté ; un rejeu de notification ne recrée jamais le bon ni ne confirme son statut",
    'un préflight fournisseur ne peut jamais créer de commande fournisseur ni déclencher un paiement ; toute mutation externe exige un gate explicite séparé',
  ],

  classification: {
    kind:     'business-feature',
    decision: 'feature-autonome',
    signals: {
      ownsTables:          true,
      ownsLifecycle:       true,
      activeService:       true,
      multiConsumer:       false,
      ownsMigrations:      true,
      externalSideEffect:  'outbound-message',
      surface:             'api',
    },
    rationale: [
      'possède sa propre table (purchase_orders) avec un cycle de statut et un invariant d\'idempotence anti-replay propres',
      'scindé de orders : purchasing transforme un besoin d\'approvisionnement en engagement fournisseur sans jamais posséder le cycle de vie de la commande cliente',
    ],
  },

};
