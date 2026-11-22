/**
 * @feature       logistics
 * @type          feature
 * @domain        logistics
 * @status        production
 * @owner         backend-core
 * @since         2025-08
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 */
'use strict';

module.exports = {

  // â”€â”€ Identite â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  name:     'logistics',
  type:     'feature',   // feature | transversal
  domain:   'logistics',
  status:   'production',   // draft | staging | production | deprecated
  owner:    'backend-core',
  since:    '2025-08',
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
      "externalSideEffect": "none",
      "surface": "api+service"
    },
    "rationale": [
      "possÃ¨de le cycle physique colis/scan/relais, les secrets de retrait et leurs transitions ; orders et customs gardent leurs propres dÃ©cisions",
      "porte ses tables et migrations opÃ©rationnelles tout en exposant des services consommÃ©s par payments, catalog, purchasing et dashboard"
    ]
  },

  service: 'Faire transiter un colis du scan initial au retrait final, avec tracking client et transporteur.',

  perimeter: {
    in: [
      'scan et operations colis',
      'creation automatique de colis',
      'secrets de retrait',
      'retrait partiel parcel-scoped avec rotation one-shot du secret order-level',
      'compatibilitÃ© verifyâ†’collect : le code courant est revalidÃ© atomiquement Ã  chaque remise physique',
      'tracking client et transitaire',
      'relais et transporteurs',
      'consignes hub prescrites au scan : repack, mesure volume, photo de scelle (bornes de responsabilite)',
      'saisie volumes produits (POST /hub/volume) et photos de scelle (POST /hub/photo)',
      'HUB-001 : identitÃ© physique distincte de l allocation Ã©conomique ; snapshot exact Purchase Order â†’ order item/SKU/Supplier Order Identity â†’ Market/destination',
      'HUB-001 : placement physique et custody append-only ; SPLIT/MERGE/REPACK dÃ©placent la matiÃ¨re sans rÃ©assigner la destination Ã©conomique',
      'HUB-001 : inbound fournisseur potentiellement multi-market, outbound PACKED/DISPATCHED obligatoirement homogÃ¨ne sur exactement un Market',
      'HUB-001 : constat physique LOST/STOLEN/DESTROYED/DAMAGED_UNUSABLE atomique avec l outbox transactionnelle F0',
      'Logistics Control Chain : le HUB est une primitive Logistics transverse aux fournisseurs et Markets ; il mutualise la custody puis spÃ©cialise la sortie en outbound Market sans possÃ©der ni rÃ©Ã©crire les vÃ©ritÃ©s Orders/Purchasing/Market',
    ],
    out: [
      'cout du transport (feature economic-engine)',
      'declaration douaniere (feature customs)',
      'preuve de retrait document (feature documents, consommee ici)',
      'rÃ©paration ou rÃ©interprÃ©tation de Supplier Order Identity / Canonical Unit / Purchase Order : autoritÃ© purchasing+sourcing uniquement',
      'rÃ©assignation commerciale d une ligne, d un Market ou d une destination client depuis le Hub',
    ],
  },

  files: {
    middleware: [
      'middleware/upload-hub.js',
    ],
    migrations: [
      'migrations/095_value_density_foundation.sql',
      'migrations/096_quality_foundation.sql',
      'migrations/233_hub_physical_identity_allocation_custody.sql',
      'migrations/391_hub_sku_physical_codes.sql',
      'migrations/392_hub_order_bag_ownership.sql',
      'migrations/393_hub_order_bag_scan_evidence.sql',
      'migrations/394_hub_packed_bag_box_link.sql',
      'migrations/401_relay_product_return_intake.sql',
      'migrations/309_hub_placement_guard_exclude_outcomes.sql',
      'migrations/313_market_transport_sale_rates.sql',
      'migrations/354_international_shipment_journey.sql',
      'migrations/359_hub_draft_open_and_handover.sql',
      'migrations/366_local_relay_receipt_quantity_guard.sql',
      'migrations/363_parcel_items_physical_proof.sql',
      'migrations/364_shipment_relay_receipts.sql',
    ],
    docs: [
      'docs/doctrine/DOCTRINE_DENSITE_VALEUR.md',
      'docs/doctrine/DOCTRINE_NON_CONFORMITE.md',
      'docs/doctrine/DOCTRINE_TRANSPORT_RAILS.md',
      'docs/doctrine/DOCTRINE_HUB_PHYSICAL_IDENTITY.md',
      'docs/doctrine/DOCTRINE_LOGISTICS_CONTROL_CHAIN.md',
      'docs/ops/NOTE_OPS_CALIBRATION_DENSITE_V5.md',
      'docs/contract/INTERNATIONAL_SHIPMENT_CHAIN_V1_20261101.md',
    ],
    utils: [
      'utils/parcelSync.js',
      'utils/parcels.js',
      'utils/pickup-receipt-html.js',
    ],
    services: [
      'services/parcel-operations.js',
      'services/market-transport-tariff-gate.js',
      'services/market-transport-sale-rates.js',
      'services/market-transport-sale-rate-command.js',
      'services/parcel-item-mutation-service.js',
      'services/local-relay-receipt-service.js',
      'services/parcel-mutation-service.js',
      'services/parcel-order-membership.js',
      'services/parcel-security.js',
      'services/scan-operations.js',
      'services/scan-write-service.js',
      'services/scan-engine.js',
      'services/auto-parcel.js',
      'services/relais-mutation-service.js',
      'services/pickup-secret-service.js',
      'services/pickup-secret-issuer.js',
      'services/pickup-secret-rotation-service.js',
      'services/pickup-agent-lockout.js',
      'services/pickup-secret-customer-rotation-service.js',
      'services/pickup-secret-access-service.js',
      'services/pickup-collection-service.js',
      'services/pickup-collection-recorder.js',
      'services/pickup-exceptional-collection-service.js',
      'services/pickup-code-helpers.js',
      'services/parcel-auto-create-service.js',
      'services/parcel-guards.js',
      'services/parcelOptimizationService.js',
      'services/parcel-service.js',
      'services/hub-operations.js',
      'services/hub-box-shipment-service.js',
      'services/hub-procurement-dossier.js',
      'services/hub-global-board.js',
      'services/hub-receivable.js',
      'services/hub-dubai-projection.js',
      'services/hub-receive-idempotency.js',
      'services/hub-physical-identity.js',
      'services/hub-physical-codes.js',
      'services/hub-bag-box-service.js',
      'services/order-physical-coverage-service.js',
      'services/hub-inbound-reconciliation.js',
      'services/customer-handoff-reconciliation.js',
      'services/hub-reference.js',
      'services/routing.js',
      'services/transport-rails.js',
      'services/international-shipment-journey.js',
      'services/parcel-shipment-handover.js',
      'services/relay-shipment-receipt.js',
      'services/relay-product-return-intake-service.js',
      'services/relay-parcel-item-reconciliation.js',
    ],
    routes: [
      'routes/parcels.js',
      'routes/parcel-api-v2/read.js',
      'routes/parcel-api-v2/scans.js',
      'routes/parcel-api-v2/index.js',
      'routes/parcel-api-v2/helpers.js',
      'routes/transitaire-api.js',
      'routes/client-tracking.js',
      'routes/tracking.js',
      'routes/scans.js',
      'routes/carriers.js',
      'routes/pickup-secret.js',
      'routes/parcel-label.js',
      'routes/transit-dashboard.js',
      'routes/parcel-api-v2.js',
      'routes/relais.js',
      'routes/logistics.js',
      'routes/auto-distribute-api.js',
      'routes/hub.js',
    ],
    boutique: [
      'js/b-tracking.js',
    ],
    dash: [
      'dashboards/admin/js/views/HubRelaisView.js',
      'dashboards/admin/js/views/OrdersLogisticsView.js',
    ],
    tests: [
      'tests/unit/hub-v1-fixture-dependency-inventory.test.js',
      'tests/integration/hub-v1-fixture-dependency-inventory-postgres.test.js',
      'tests/integration/hub-v1-certification-runner-postgres.test.js',
      'tests/integration/auto-parcel-reference-postgres.test.js',
      'tests/integration/auto-parcel-cleanup-postgres.test.js',
      'tests/integration/hub-live-cockpit-postgres.test.js',
      'tests/e2e-api/logistics.hub-live-cockpit-roles.e2e.test.js',
      'tests/integration/hub-physical-proof-postgres.test.js',
      'tests/integration/relay-shipment-receipt-postgres.test.js',
      'tests/unit/relay-product-return-intake.test.js',
      'tests/integration/relay-return-intake-postgres.test.js',
      'tests/unit/relay-shipment-parcel-projection.test.js',
      'tests/unit/market-transport-tariff-gate.test.js',
      'tests/integration/market-transport-sale-rates-postgres.test.js',
      'tests/unit/market-transport-sale-rate-command.test.js',
      'tests/unit/staging-market-transport-sale-rates.test.js',
      'tests/unit/hub-dubai-projection.test.js',
      'tests/unit/hub-global-board.test.js',
      'tests/unit/hub-unsourced-order-dossier.test.js',
      'tests/unit/hub-director-todo-age.test.js',
      'tests/unit/hub-order-status.test.js',
      'tests/e2e-api/orders.pickup-code-vs-authorized-name.e2e.test.js',
      'tests/integration/hub-physical-identity-postgres.test.js',
      'tests/integration/hub-order-bag-ownership-postgres.test.js',
      'tests/unit/hub-physical-codes.test.js',
      'tests/unit/hub-bag-box-ui-contract.test.js',
      'tests/unit/order-physical-coverage-gate.test.js',
      'tests/e2e-api/hub.historical-receipt-coverage.e2e.test.js',
      'tests/integration/hub-physical-hardening-postgres.test.js',
      'tests/integration/hub-volume-photo-contract.test.js',
      'tests/integration/txg05-parcel-items-product-id.test.js',
      'tests/integration/test-harness/seed-helpers.js',
      'tests/unit/auto-distribute-api.test.js',
      'tests/unit/hub-authority-gate.test.js',
      'tests/unit/hub-operations-volume.test.js',
      'tests/unit/upload-hub.test.js',
      'tests/unit/auto-parcel.test.js',
      'tests/unit/carriers.test.js',
      'tests/unit/client-tracking.test.js',
      'tests/unit/hub.test.js',
      'tests/unit/logistics.test.js',
      'tests/unit/parcel-api-v2-helpers.test.js',
      'tests/unit/parcel-api-v2-index.test.js',
      'tests/unit/parcel-api-v2-scans.test.js',
      'tests/unit/parcel-label.test.js',
      'tests/unit/parcel-security.test.js',
      'tests/unit/parcel-service.test.js',
      'tests/unit/parcelOptimizationService.test.js',
      'tests/unit/parcelSync.test.js',
      'tests/unit/parcelSync.partial-pickup.test.js',
      'tests/unit/pickup-receipt-html.test.js',
      'tests/unit/pickup-secret.test.js',
      'tests/unit/pickup-secret-service.test.js',
      'tests/unit/pickup-secret-issuer.test.js',
      'tests/unit/pickup-secret-access-service.test.js',
      'tests/unit/pickup-collection-service.test.js',
      'tests/unit/pickup-collection-recorder.test.js',
      'tests/unit/pickup-exceptional-collection-service.test.js',
      'tests/unit/pickup-code-helpers.test.js',
      'tests/unit/pickup-secret-rotation-service.test.js',
      'tests/unit/pickup-agent-lockout.test.js',
      'tests/unit/pickup-secret-customer-rotation-service.test.js',
      'tests/unit/scan-operations.test.js',
      'tests/unit/scan-write-service.test.js',
      'tests/unit/relais-mutation-service.test.js',
      'tests/unit/scan-engine.test.js',
      'tests/unit/scan-collection-guard.test.js',
      'tests/unit/scan-order-coverage-guard.test.js',
      'tests/e2e-api/logistics.order-coverage-rc2.e2e.test.js',
      'tests/unit/parcel-operations.test.js',
      'tests/unit/parcel-item-mutation-service.test.js',
      'tests/unit/parcel-mutation-service.test.js',
      'tests/unit/parcel-order-membership.test.js',
      'tests/e2e-api/hub-multi-order-parcels.e2e.test.js',
      'tests/e2e-api/hub-membership-readers.e2e.test.js',
      'tests/unit/parcel-guards.test.js',
      'tests/unit/parcel-auto-create-service.test.js',
      'tests/unit/hub-operations.test.js',
      'tests/unit/hub-inbound-reconciliation.test.js',
      'tests/unit/customer-handoff-reconciliation.test.js',
      'tests/unit/hub-reference.test.js',
      'tests/unit/parcels-route.test.js',
      'tests/unit/parcel-api-v2-read.test.js',
      'tests/unit/relais.test.js',
      'tests/unit/routing.test.js',
      'tests/unit/transport-rails.test.js',
      'tests/unit/scans.test.js',
      'tests/unit/tracking.test.js',
      'tests/unit/transit-dashboard.test.js',
      'tests/unit/transitaire-api.test.js',
      'tests/unit/international-shipment-journey.test.js',
      'tests/unit/parcel-shipment-handover.test.js',
      'tests/unit/international-journey-panel.test.js',
    ],
  },

  repos: {
    backend: 'services/ + routes/ ci-dessus',
    boutique: 'js/b-tracking.js â€” dÃ©pÃ´t "bout", voir docs/BOUTIQUE_OWNERSHIP_LIVE.md pour le dÃ©tail DOM/CSS',
  },

  db: {
    tables: [
      'relay_product_return_receipts: RW!',
      'business_rules: R',
      'customs_shipments: R',
      'carriers: RW',
      'hub_custody_events: RW!',
      'hub_box_bags: RW!',
      'hub_physical_unit_placements: RW!',
      'hub_physical_units: RW!',
      'hub_purchase_allocations: RW!',
      'international_shipment_charges: RW!',
      'international_shipment_events: RW!',
      'international_shipment_hub_units: RW!',
      'international_shipment_relay_receipts: RW!',
      'international_shipments: RW!',
      'incidents: R',
      'invoices: R',
      'local_stock: R',
      'local_stock_allocations: R',
      'market_transport_sale_rates: RW!',
      'order_items: RW',
      'orders: R',
      'parcel_events: RW!', // logistics owns append-only trace; no new cross-feature writer
      'parcel_items: RW!',
      'parcels: RW!',
      'pickup_collect_failures: RW!', // R2 #3900: compteur d'Ã©checs agent + relais (migration 413)
      'pickup_code_generations: RW!', // R1 #3900 : gÃ©nÃ©rations de code de retrait par le client (migration 412)
      'pickup_print_tokens: RW!',
      'pickup_reveal_codes: RW!',
      'pickup_verify_attempts: RW',
      'product_suppliers: R',
      'product_sku_physical_codes: RW!',
      'product_variants: R',
      'products: RW',
      'purchase_orders: R',
      'purchase_order_authorizations: R',
      'hub_authorization_grants: R',
      'recipients: R',
      'relais: RW!',
      'scan_events: RW!',
      'scans: RW!',
      'shipments: RW',
      'users: R',
    ],
  },

  security: {
    status: 'CONFIRMED_MIXED',
    authedRoutesDetected: 75,
    totalRoutes: 80,
    note: "75/80 routes protÃ©gÃ©es. 5 routes publiques par design : GET /api/relais, /relais/public, /relais/:id (annuaire public des points relais) ; GET /api/tracking/:token et POST /api/tracking/:token/verify-pickup (capability token documentÃ© â€” pas d'accÃ¨s aux donnÃ©es client sans token valide)m«ëŒ+Š×ž®º+º$zzb¥ââ"À¢ÒÀ¢6öçG&7C¢°¢W‡÷6W3¢°¢ttUBõõ5Bö’÷&6VÇ2rÀ¢uõ5Bö’÷c"÷&6VÇ2ó§&Vb÷66ârÀ¢ttUBö’÷G&6¶–æró§Fö¶VârÀ¢ttUBö’ö6'&–W'2rÀ¢uõ5Bö’ö6'&–W'2rÀ¢tDTÄUDRö’ö6'&–W'2ó¦–BrÀ¢uD4‚ö’ö6'&–W'2ó¦–BrÀ¢uD4‚ö’ö6'&–W'2ö7W7Fö×2ó§&6VÅö–BrÀ¢ttUBö’ö6Æ–VçB÷G&6¶–ærrÀ¢ttUBö’ö‡V"öWFòÖF—7G&–'WFRrÀ¢uõ5Bö’ö‡V"öWFòÖF—7G&–'WFRrÀ¢uõ5Bö’ö‡V"öWFòÖF—7G&–'WFRö6ÆVçWrÀ¢uõ5Bö’ö‡V"ö&F6‚×66ârÀ¢uõ5Bö’ö‡V"÷6²rÀ¢ttUBö’ö‡V"÷VæF–ærrÀ¢uõ5Bö’ö‡V"÷†÷FòrÀ¢uõ5Bö’ö‡V"÷66ârÀ¢uõ5Bö’ö‡V"÷6VÂrÀ¢ttUBö’ö‡V"÷6V&6‚rÀ¢ttUBö’ö‡V"÷7FG2÷vVV²rÀ¢ttUBö’ö‡V"÷FöF’rÀ¢uõ5Bö’ö‡V"÷föÇVÖRrÀ¢ttUBö’öÆöv—7F–72öÆ&VÇ2ó§6†—ÖVçEö–BrÀ¢ttUBö’öÆöv—7F–72öÖæ–fW7Bó§6†—ÖVçEö–BrÀ¢ttUBö’öÆöv—7F–72÷6†—ÖVçG2rÀ¢uõ5Bö’öÆöv—7F–72÷6†—ÖVçG2rÀ¢uD4‚ö’öÆöv—7F–72÷6†—ÖVçG2ó¦–BrÀ¢uõ5Bö’÷&6VÇ2ó¦–Bö—FV×2rÀ¢tDTÄUDRö’÷&6VÇ2ó¦–Bö—FV×2ó¦—FVÕö–BrÀ¢uD4‚ö’÷&6VÇ2ó¦–B÷7FGW2rÀ¢uõ5Bö’÷&6VÇ2ó¦–B÷fW&–g’×6VÂrÀ¢uõ5Bö’÷&6VÇ2ó¦–B÷vV–v‡BrÀ¢ttUBö’÷&6VÇ2ó§&VbrÀ¢ttUBö’÷&6VÇ2ó§&VböWfVçG2rÀ¢uõ5Bö’÷&6VÇ2ö&ö÷G7G&ó¦÷&FW$–BrÀ¢uõ5Bö’÷&6VÇ2ö÷F–Ö—¦RrÀ¢uõ5Bö’÷–6·Wö6öÆÆV7Bó¦÷&FW$–BrÀ¢uõ5Bö’÷–6·W÷’Ö66‚ó¦÷&FW$–BrÀ¢ttUBö’÷–6·W÷&V6V—Bó¦÷&FW$–BrÀ¢uõ5Bö’÷–6·W÷&VvVæW&FRó¦÷&FW$–BrÀ¢ttUBö’÷–6·W÷&WfVÂÖöæ6Ró¦÷&FW$–BrÀ¢ttUBö’÷–6·W÷7FGW2ó¦÷&FW$–BrÀ¢uõ5Bö’÷–6·W÷fW&–g’ó¦÷&FW$–BrÀ¢ttUBö’÷–6·WöW†6WF–öæÂ×–6·Wó¦÷&FW$–BrÀ¢uõ5Bö’÷–6·WöW†6WF–öæÂ×–6·Wó¦÷&FW$–Bö6öÆÆV7BrÀ¢ttUBö’÷&VÆ—2rÀ¢ttUBö’÷&VÆ—2ó¦–BrÀ¢ttUBö’÷&VÆ—2÷V&Æ–2rÀ¢uõ5Bö’÷66ç2rÀ¢ttUBö’÷66ç2ó¦÷&FW%ö–BrÀ¢uõ5Bö’÷66ç2ö6öÆÆV7BrÀ¢ttUBö’÷66ç2ö‡V"÷VæF–ærrÀ¢uõ5Bö’÷66ç2ö‡V"÷&V6V—fRrÀ¢uõ5Bö’÷66ç2ö‡V"÷&V6öæ6–ÆRrÀ¢uõ5Bö’÷66ç2÷fW&–g’×"rÀ¢uõ5Bö’÷G&6¶–æró§Fö¶Vâ÷fW&–g’×–6·WrÀ¢ttUBö’÷G&ç6—BrÀ¢ttUBö’÷G&ç6—BÖF6†&ö&BrÀ¢uõ5Bö’÷G&ç6—BÖF6†&ö&Bó§&Vb÷G&ç6—BrÀ¢uõ5Bö’÷G&ç6—Bó§&Vb÷G&ç6—BrÀ¢ttUBö’÷G&ç6—F—&Rö†—7F÷'’rÀ¢ttUBö’÷G&ç6—F—&R÷&6VÇ2rÀ¢uõ5Bö’÷G&ç6—F—&R÷6†—rÀ¢ttUBö’÷G&ç6—F—&R÷7FG2rÀ¢ttUBö’÷c"÷&6VÇ2rÀ¢ttUBö’÷c"÷&6VÇ2ó§&VbrÀ¢ttUBö’÷c"÷&6VÇ2ó§&VböÆ&VÂrÀ¢ttUBö’÷c"÷&6VÇ2ó§&Vb÷F–ÖVÆ–æRrÀ¢ttUBö’÷c"÷&6VÇ2öÆW'G2rÀ¢ttUBö’÷c"÷&6VÇ2ö7&—F–6ÂrÀ¢ttUBö’÷c"÷&6VÇ2ö·—2rÀ¢ttUBö’÷c"÷&6VÇ2÷&V6öæ6–Æ–F–öârÀ¢òò&G&œ:–W2FWV—2ÆR&÷WFR×&Vv—7G'’†VF—B##bÓ’’(	B&÷WFW2,:–VÆÆW0¢òò<:&&Ì:–W2f–&÷WFW2ö‡V"æ§2WB&÷WFW2÷&6VÇ2æ§2Â¦Ö—2L:–6Æ,:–W0¢òò§W7Rv–6’à¢uõ5Bö’ö‡V"öÖ÷fRrÀ¢uõ5Bö’ö‡V"ö÷WF6öÖRrÀ¢uõ5Bö’ö‡V"÷&WfÆ–FFRrÀ¢uõ5Bö’ö‡V"÷G&ç6—F–öârÀ¢uõ5Bö’ö‡V"÷Væ—BrÀ¢ttUBö’÷&6VÇ2rÀ¢uõ5Bö’÷&6VÇ2rÀ¢ÒÀ¢–çFW&æÄ“¢°¢²fã¢wG&ç6—F–öå&6VÅ7FGW2rÂf–ÆS¢w6W'f–6W2÷&6VÂÖ÷W&F–öç2æ§2rÒÀ¢²fã¢w&V6÷&D‡V%&W&F–öå66ârÂf–ÆS¢w6W'f–6W2÷66â×w&—FR×6W'f–6Ræ§2rÒÀ¢²fã¢w&V6÷&E$6öÆÆV7F–öå66ârÂf–ÆS¢w6W'f–6W2÷66â×w&—FR×6W'f–6Ræ§2rÒÀ¢²fã¢v7&VFU&VÆ—2rÂf–ÆS¢w6W'f–6W2÷&VÆ—2Ö×WFF–öâ×6W'f–6Ræ§2rÒÀ¢²fã¢wWFFU&VÆ—2rÂf–ÆS¢w6W'f–6W2÷&VÆ—2Ö×WFF–öâ×6W'f–6Ræ§2rÒÀ¢²fã¢w6WE&VÆ—47F—fRrÂf–ÆS¢w6W'f–6W2÷&VÆ—2Ö×WFF–öâ×6W'f–6Ræ§2rÒÀ¢²fã¢vÆ—7E&VÆ—2rÂf–ÆS¢w6W'f–6W2÷&VÆ—2Ö×WFF–öâ×6W'f–6Ræ§2rÒÀ¢²fã¢vvWD÷væVE&VÆ—2rÂf–ÆS¢w6W'f–6W2÷&VÆ—2Ö×WFF–öâ×6W'f–6Ræ§2rÒÀ¢²fã¢vFWF6…W6W$g&öÕ66ç2rÂf–ÆS¢w6W'f–6W2÷66â×w&—FR×6W'f–6Ræ§2rÒÀ¢²fã¢v76–våv†öÆT÷&FW$—FVÕFõ&6VÂrÂf–ÆS¢w6W'f–6W2÷&6VÂÖ—FVÒÖ×WFF–öâ×6W'f–6Ræ§2rÒÀ¢²fã¢v76–vå&6VÄ—FVÒrÂf–ÆS¢w6W'f–6W2÷&6VÂÖ—FVÒÖ×WFF–öâ×6W'f–6Ræ§2rÒÀ¢²fã¢vFE&6VÄ—FVÒrÂf–ÆS¢w6W'f–6W2÷&6VÂÖ—FVÒÖ×WFF–öâ×6W'f–6Ræ§2rÒÀ¢²fã¢w&VÖ÷fU&6VÄ—FVÒrÂf–ÆS¢w6W'f–6W2÷&6VÂÖ—FVÒÖ×WFF–öâ×6W'f–6Ræ§2rÒÀ¢²fã¢v76–vå6–ævÆT÷&FW$—FVÕFõ&6VÂrÂf–ÆS¢w6W'f–6W2÷&6VÂÖ—FVÒÖ×WFF–öâ×6W'f–6Ræ§2rÒÀ¢²fã¢vFE&6VÄ—FVÕG&6VBrÂf–ÆS¢w6W'f–6W2÷&6VÂÖ—FVÒÖ×WFF–öâ×6W'f–6Ræ§2rÒÀ¢²fã¢w&VÖ÷fU&6VÄ—FVÕG&6VBrÂf–ÆS¢w6W'f–6W2÷&6VÂÖ—FVÒÖ×WFF–öâ×6W'f–6Ræ§2rÒÀ¢²fã¢w&V76–vå&6VÄ—FVÒrÂf–ÆS¢w6W'f–6W2÷&6VÂÖ—FVÒÖ×WFF–öâ×6W'f–6Ræ§2rÒÀ¢²fã¢vÆ—7E&6VÇ5&W&W6VçF–æt÷&FW"rÂf–ÆS¢w6W'f–6W2÷&6VÂÖ÷&FW"ÖÖVÖ&W'6†—æ§2rÒÀ¢²fã¢vÆ—7D÷&FW'5&W&W6VçFVD'•&6VÇ2rÂf–ÆS¢w6W'f–6W2÷&6VÂÖ÷&FW"ÖÖVÖ&W'6†—æ§2rÒÀ¢²fã¢v7&VFT‡V%&6VÂrÂf–ÆS¢w6W'f–6W2÷&6VÂÖ×WFF–öâ×6W'f–6Ræ§2rÒÀ¢²fã¢v7&VFTWFõ&W&VE&6VÂrÂf–ÆS¢w6W'f–6W2÷&6VÂÖ×WFF–öâ×6W'f–6Ræ§2rÒÀ¢²fã¢w6WE&6VÅvV–v‡BrÂf–ÆS¢w6W'f–6W2÷&6VÂÖ×WFF–öâ×6W'f–6Ræ§2rÒÀ¢²fã¢vVæE&6VÅ6†—ÖVçD–æfòrÂf–ÆS¢w6W'f–6W2÷&6VÂÖ×WFF–öâ×6W'f–6Ræ§2rÒÀ¢²fã¢vÖ&´7W7Fö×46ÆV&VBrÂf–ÆS¢w6W'f–6W2÷&6VÂÖ×WFF–öâ×6W'f–6Ræ§2rÒÀ¢²fã¢vÖ&´&6¶÷&FW%&VÖ–æFW%6VçBrÂf–ÆS¢w6W'f–6W2÷&6VÂÖ×WFF–öâ×6W'f–6Ræ§2rÒÀ¢²fã¢w&W6öÇfUW&6†6U6æ6†÷BrÂf–ÆS¢w6W'f–6W2ö‡V"×‡—6–6ÂÖ–FVçF—G’æ§2rÒÀ¢²fã¢w6æ6†÷EW&6†6TÆÆö6F–öârÂf–ÆS¢w6W'f–6W2ö‡V"×‡—6–6ÂÖ–FVçF—G’æ§2rÒÀ¢²fã¢v7&VFU‡—6–6ÅVæ—BrÂf–ÆS¢w6W'f–6W2ö‡V"×‡—6–6ÂÖ–FVçF—G’æ§2rÒÀ¢²fã¢w&V6V—fU7WÆ–W%6¶vRrÂf–ÆS¢w6W'f–6W2ö‡V"×‡—6–6ÂÖ–FVçF—G’æ§2rÒÀ¢²fã¢wG&ç6—F–öå‡—6–6ÅVæ—BrÂf–ÆS¢w6W'f–6W2ö‡V"×‡—6–6ÂÖ–FVçF—G’æ§2rÒÀ¢²fã¢vÖ÷fTÆÆö6F–öåVçF—G’rÂf–ÆS¢w6W'f–6W2ö‡V"×‡—6–6ÂÖ–FVçF—G’æ§2rÒÀ¢²fã¢w&V6÷&E‡—6–6ÅVæ—D÷WF6öÖRrÂf–ÆS¢w6W'f–6W2ö‡V"×‡—6–6ÂÖ–FVçF—G’æ§2rÒÀ¢ÒÀ¢6öç7VÖW3¢°¢v7W7Fö×2†Æ–VâFö7VÖVçF—&R–çFW&æF–öæÂ¢ÆR6W'f–6RF÷VæR÷7<:†FR6WVÂÆL:–6Æ&F–öâFW2G&ö—G2WBF†W2²ÆR‡V"÷&6†W7G&R6G&ç67F–öâ’rÀ¢vFö7VÖVçG2†L:—VæFæ6RFF7&÷72ÖfVGW&Rö'6W'l:–RWBv÷WfW&ì:–R"óR’rÀ¢v–æ6–FVçBÖÖævVÖVçB†–æ6–FVçBW'6—7FVæ6Rf––æ6–FVçB×w&—FR×6W'f–6R’rÀ¢v–æg&7G'V7GW&R„D"²G&ç67F–öæÂ÷WF&÷‚c²ÆW26öç7FG2‡—6—VW26öçBV&Æœ:—2f–÷WF&÷‚×&öGV6W"Fç2ÆG&ç67F–öâGRf—B’rÀ¢&'W6–æW72×'VÆW2„dbÔ3##bÓrÓ#’(	BÆV7GW&RGR,:–l:—&VçF–VÂFR,:†vÆW2Ü:—F–W"²&WWfS¢WF–Ç2÷&6VÇ2æ§2ÓâWF–Ç2÷'VÆW2æ§2²6W'f–6W2÷&6VÂÖ÷W&F–öç2æ§2ÓâWF–Ç2÷'VÆW2æ§2’"À¢v÷&FW'2†6öÖÖæFR&GF6Œ:–RR6öÆ—2²…T"ÓæRÆ—BVR÷&FW%ö–Bö÷&FW%ö—FVÕö–BöÖ&¶WEö–B÷&VÆ—5ö–BWF÷&—FF–g2WBæRÆW2,:–76–væR¦Ö—2’rÀ¢vÆö6Â×7Fö6²†ÆV7GW&R"4µRWBÖ&6Œ:’FW2ÆÆö6F–öç26öç6öÖÜ:–W2÷W"Æ,:–6WF–öâF—&V7FRR&VÆ—2Â6ç2‡V"f–7F–b’rÀ¢vWF‚rÀ¢vWF‚Ö–FVçF—G’†WF÷&—6F–öâæöÖ–æF—fRFR&WG&—BW†6WF–öææVÂ(	B6W'f–6W2÷–6·WÖWF†÷&—¦F–öâ×6W'f–6Ræ§3¦vWD7F—fTWF†÷&—¦F–öäf÷%WFFRö†47F—fTWF†÷&—¦F–öâÂ¦Ö—2FR&W\:§FRF—&V7FR7W"W6W%÷–6·WöWF†÷&—¦F–öç2ÂÆ÷BR’rÀ¢v6FÆörrÀ¢væ÷F–f–6F–öç2rÀ¢w–ÖVçG2†Ö'VRVæR6öÖÖæFR–VR(	B6W'f–6W2÷–ÖVçB×6W'f–6Ræ§2²6öæf—&ÖRVâ–VÖVçB66‚–6·WG&ç67F–öææVÂ(	B6W'f–6W2ö6öæf—&Ò×–6·WÖ66‚×–ÖVçBæ§2²órã"7–6ÆR"’rÀ¢w&VgVæG2rÀ¢wW&6†6–ær†ÆV7GW&R6WVÆRFRW&6†6Uö÷&FW'2¢…T"Ó6æ6†÷GFRÂ–FVçF—L:’B6†BW†7FRL:–¬:W'6—7L:–R²V7VæR×WFF–öâö†WW&—7F—VRf÷W&æ—76WW"’rÀ¢vÆ÷–ÇG’‡&V6Æ7VÂFRÆ–W"&W26öÆÆV7FR66‚&VÆ—2ò66â&W&F–öâ(	B6W'f–6W2öÆ÷–ÇG’×6W'f–6Ræ§2&V6Æ7VÆFTÆ÷–ÇG’ö†æFÆT÷&FW$6öæf—&ÖVBÂórã2&÷f–FW"Æ÷–ÇG’’rÀ¢vÖ&¶WB‡,:–l:—&VçF–VÂÖ&¶WBWB÷&FW'2æÖ&¶WEö–BWF÷&—FF–b²…T"ÓŒ:—&—FRÆRÖ&6Œ:’FRÆ6öÖÖæFRÂ¦Ö—2FRÖ&¶WEö–B6Æ–VçB’rÀ¢vÖ&¶WBÖFVÆVvF–öâ†6&–Æ—F–W2Ö&6Œ:’W‡Æ–6—FW2²CÆ–RvVçE÷G&ç6—F—&R:VâÖ&6Œ:’²CB&÷&æRÆW2ÆV7GW&W2‡V"Ö&¶WEö÷W&F÷""÷W&F–öç2ç&VBWBÆ7WW'f—6–öâ‡V""‡V"ç7WW'f—6R²W6W'2ç&öÆRæRFöææRV7VâG&ö—BÖ&6Œ:’’rÀ¢ÒÀ¢ÒÀ ¢FV'C¢°¢¶æ÷väv3¢°¢²v¢w&V6WF–öâ‡V"BVæRò&Vw&÷WVR¢ÆR&V7RÆ–ÖVçFRe÷W&6†6UöÆ–æU÷&öw&W72‡Æ6VÖVçG2$T4T•dR"Æ–væR’Ö—2V7Vâ7FGWBFR6öÖÖæFRâW7Bfæ6R"…T"Ó†–ÂâV7&—B¦Ö—2÷&FW'2ç7FGW2’ârÀ¢&—6³¢wVæR6öÖÖæFRVçF–W&VÖVçB&V7VRf–ò&Vw&÷WVRâfæ6R2F÷WFR6WVÆRfW'2&W&F–öâFçBVRÆR&÷&–WF—&RW&6†6–ærö÷&FW'2æRÆ—B2—5ö÷&FW%ö6ö×ÆWFR&W2&V6WF–öâ(	BG&—FW"fV2Æf÷&ÖR&Vw&÷WVR…"BóR’ârÒÀ¢²v¢væ6–Vâ6öçG&BL:–6Æ,:’%õ5Bö’÷&6VÇ2ó¦–B÷66â"‡c’¢V7VæR&÷WFRæR6W'B6R6†VÖ–ââÆR66âFR6öÆ—2W7B7<:’:ÅÂt’c"‡&÷WFW2÷&6VÂÖ’×c"÷66ç2æ§2’ÂÖöçL:–R6÷W2ö’÷c"÷&6VÇ2ó§&Vb÷66âârÀ¢&—6³¢w6’Vâ6Æ–VçBW‡FW&æR‡66ææW"‡—6—VRÂÖö&–ÆR‡V"’VÆÆRVæ6÷&RÆR6†VÖ–âcÂ–Â&\:vö—BVâCB(	B:l:—&–f–W"fçBFR6öç6–L:—&W"6Rö–çB6Æ÷2ârÒÀ¢²v¢u,8•4ôÅRƒ##bÓrÓb’(	BÆRd”Âµ$ÕôäÔUôÔ•4ÔD4…Ò7W"$tUBö’÷c"÷&6VÇ2ó§&Vb":—F—BVâ'FVf7BGR'VrFR6†F÷v–ærFö7VÖVçL:’Fç2ÆFf÷&ÒÖ÷2æfVGW&Ræ§2ârÀ¢&—6³¢vçVÂL:—6÷&Ö—2(	B:&Wl:—&–f–W"V×—&—VVÖVçBR&ö6†–â'VâGRvFRârÒÀ¢ÒÀ¢ÒÀ ¢WF†÷&—G“¢v&6¶VæBÖ6÷&R(	BÆöv—7F–72÷7<:†FRÆl:—&—L:’‡—6—VRWBÆ7W7FöG’²66âÖVæv–æRæ§2&W7FRWF÷&—L:’FRÆÖ6†–æRFR66â6öÆ—2ÆVv7’Â‡V"×‡—6–6ÂÖ–FVçF—G’æ§2÷7<:†FR…T"Ó6ç2¦Ö—2,:–76–væW"ÆW2l:—&—L:—2W&6†6–ærô÷&FW'2ôÖ&¶WBrÀ ¢–çf&–çG3¢°¢²7FFVÖVçC¢uVæR6öÖÖæFR”Õõ%Bœ:–RFöçBÆRf÷W&æ—76WW"âW7B2–FVçF–fœ:’÷RFöçBÆW2Æ–væW2B6†BæR6÷Wg&VçB2ÆVçF—L:’&W7FRf—6–&ÆRFç2ÆRF÷76–W"WBÆRF&ÆVRvÆö&Â‡V"6öÖÖR6÷W&6–ær&WV—2²ÆW2VçF—L:—2:6÷W&6W"&÷f–VææVçBFW2Æ–væW2B6†BVffV7F—fW2Â¦Ö—2GR7Fö6²æ’FR&WWfW2‡—6—VW2–çfVçL:–W2âÆ&W&—6RÖçVVÆÆR76RVæ—VVÖVçB"ÆR&÷&œ:—F—&RW&6†6–ærârÀ¢FW7C¢wFW7G2÷Væ—Bö‡V"×Vç6÷W&6VBÖ÷&FW"ÖF÷76–W"çFW7Bæ§2rÒÀ¢²7FFVÖVçC¢u&VÆ—2Æ—fR†Æ÷B2ÂÖ–w&F–öâ3cB’¢ÆR6öçFVçR,:–VÆÆVÖVçBW‡:–Fœ:’6RÆ—BW‡:–F—F–öâ(i"´ôÒÔ$õ‚(i"6öÖÖæFW2(i"'F–6ÆW2†GFVæGRÒÆ<:’Vâ´ôÒÔ$õ‚FRÅÂvW‡:–F—F–öâÂÖçVçB÷&VÆ—VBÂ&\:wRÂ&VÖ—2’²Æ,:–6WF–öâ&VÆ—2W7BGFW7L:–R"VâvVçE÷&VÆ—2'F–6ÆR"'F–6ÆR†GFW7FF–öâ–Ö×V&ÆRÂ&WWfRö&Æ–vFö—&RÂVæ—VVÖVçB6W2&÷&W2'F–6ÆW2ÂW‡:–F—F–öâRG&ç7÷'BÆö6Â’ÂVâ:–6'B÷Wg&RVâ–æ6–FVçB&VÆ•övVçBG&:v&ÆRÂWBÅÂ|:—FR&VÆ•÷&V6V—fVBL:–6÷VÆRFW2GFW7FF–öç2FRF÷W2ÆW2'F–6ÆW2GFVæGW2(	Bæ’FÖ–âæ’vVçEö‡V"æRÆ÷6VçB„¤õU$äU•õ$TÄ•ôEDU5DD”ôåõ$UT•$TB’rÀ¢FW7C¢wFW7G2ö–çFVw&F–öâ÷&VÆ’×6†—ÖVçB×&V6V—B×÷7Fw&W2çFW7Bæ§2rÒÀ¢²7FFVÖVçC¢wVæR6WVÆRl:—&—L:’‡—6—VR†Æ÷B"ÂÖ–w&F–öâ3c2’¢÷W"Vâ'F–6ÆREÂv–×÷'BÂ&6VÅö—FV×2çG•öÆÆö6FVBæRL:—76R¦Ö—26RVRÆR‡V"&\:wR‡Æ6VÖVçG2$T4T•dR’WBG•÷6¶VB6RV’W7BÆ<:’Vâ´ôÒÔ$õ‚„Ô$´UEõ$4TÂ’ÂÆ6†:ææRW‡:–Fœ:’ÃÒVÖ&ÆÌ:’ÃÒffV7L:’&W7FçB÷'L:–R"G&uö6†V6µ÷&6VÅö—FVÕ÷G’²6W2VçF—L:—26öçBL:—&—l:–W2FW2Æ6VÖVçG2‡—6—VW2‡G&–vvW"’Â¦Ö—2,:—&V×Æ–W2:ÅÂvVæ6—76VÖVçB²Vâ'F–6ÆR†÷'2–×÷'B‡7Fö6²Æö6Â’7V—BÆR6—&7V—BF—&V7B&VÆ—26ç2&WWfR‡V"rÀ¢FW7C¢wFW7G2ö–çFVw&F–öâö‡V"×‡—6–6Â×&ööb×÷7Fw&W2çFW7Bæ§2rÒÀ¢²7FFVÖVçC¢t‡V"Æ—fR,:—&RF—&V7FVÖVçBFç2VæR4ôÔ$õ‚¢Î(	–vVçB66ææRÆ4ôÔ$õ‚V—2ÆW2'F–6ÆW2ÂÆW2Æ6RFWV—2ÆW2VçF—L:—2&\:wVW2fV2&WWfR44âl:—&–fœ:–R6öçG&RÆR4µR÷R&WWfRÔåTÂW‡Æ–6—FRÂWBfW&ÖRVæR4ôÔ$õ‚æöâf–FR²ÇW6–WW'26öÖÖæFW2WBÆ–væW2WWfVçB'FvW"VæR4ôÔ$õ‚GRÜ:¦ÖRÖ&6Œ:’ÂVæRÆ–væRWWB:§G&R,:—'F–RVçG&RÇW6–WW'24ôÔ$õ‚ÂÆW2VçF—L:—2&W7FVçB&÷&ì:–W2"ÆW2Æ6VÖVçG2&\:wW2ÂWBÆR&6÷W'27FæF&BæR7,:–R2FR62F–v—FÂ†ÆW2ÆV7FWW'2†—7F÷&—VW2&W7FVçB6ö×F–&ÆW2fV2ÆW2æ6–Vç2Vç&Vv—7G&VÖVçG2’rÀ¢FW7C¢wFW7G2÷Væ—Bö‡V"Ö&rÖ&÷‚×V’Ö6öçG&7BçFW7Bæ§2rÒÀ¢²7FFVÖVçC¢u$2Ó#¢Æ6Ì;GGW&R"6öÆ—2w&÷W:—2÷R'F–VÇ2W7B&÷Wl:–RVâ÷7Fw&U5Â—6öÌ:’7W"F&ÆW2FV×÷&—&W2²F÷WFRÆ–væRVæ6÷&RGVRV×:¦6†R6öÆÆV7FVBrÀ¢FW7C¢wFW7G2öS&RÖ’öÆöv—7F–72æ÷&FW"Ö6÷fW&vR×&3"æS&RçFW7Bæ§2rÒÀ¢²7FFVÖVçC¢u$2Ó"¢V7Vâ76vRFR6öÖÖæFR:6öÆÆV7FVB6ç26÷WfW'GW&R–çL:–w&ÆRFRF÷WFW26W2Æ–væW2WBVçF—L:—2,:–VÆÆVÖVçB6öÆÆV7L:–W27W"ÆW26öÆ—27F–g2ÂÜ:¦ÖRVâ,:—6Væ6RFRÆ—g&—6öç2'F–VÆÆW2÷RFRÆ–væW2¦Ö—2ffV7L:–W2rÀ¢FW7C¢wFW7G2÷Væ—B÷66âÖ÷&FW"Ö6÷fW&vRÖwV&BçFW7Bæ§2rÒÀ¢²7FFVÖVçC¢u$2Ó2õ$2ÓC¢VæR&VÖ—6R‡—6—VRW†–vR6†VR6öÖÖæFR&W,:—6VçL:–Rœ:–RÂVâ7FWW"WF†VçF–fœ:’–FVçF–fœ:’Vâ&6RWBVâvVçB&VÆ—2GF6Œ:’:ÆFW7F–æF–öâ,:–VÆÆR²ÆR&öG’æRWWBW7W'W"7F÷%÷&öÆRrÀ¢FW7C¢wFW7G2÷Væ—B÷66âÖ6öÆÆV7F–öâÖwV&BçFW7Bæ§2rÒÀ¢$…T"Ô¢ÆR‡V"÷&væ—6RÆ–'&VÖVçB6W26öÆ—2(	BVâ6öÆ—2&W,:—6VçFRVæR6öÖÖæFR2v–Â÷'FRVæRÆ–væR†÷&FW%ö—FV×2’FR6WGFR6öÖÖæFRÂ÷R6’66öÖÖæFR÷'FWW6R‡&6VÇ2æ÷&FW%ö–B’âvV7VæRÆ–væR&GF6Œ:–R²&6VÇ2æ÷&FW%ö–BâvW7B¦Ö—2,:œ:–7&—BâF÷WB¦÷WB÷&WG&—B÷,:–ffV7FF–öâFRÆ–væR76R"&6VÂÖ—FVÒÖ×WFF–öâ×6W'f–6RÂW†–vRVâ6öÆ—2G&gB÷&W&F–öâFRÜ:¦ÖRFW7F–æF–öâÂ6öç6W'fR–FVçF—L:’ÂVçF—L:’WB6ö×FWW'2G•ò¢…Tä•TR†÷&FW%ö—FVÕö–B’–æ6†æ|:’’WBÆ—76RVæRG&6R&6VÅöWfVçG2†—FVÕö76–væVBò—FVÕ÷&VÖ÷fVBò—FVÕ÷&V76–væVEö–çÆ÷WB’Fç2ÆÜ:¦ÖRG&ç67F–öââÆ,:†vÆRFR–VÖVçB:ÂvW‡:–F—F–öâ2vÆ—VR:6†VR6öÖÖæFR&W,:—6VçL:–R²V7VæR,:†vÆRFRf7GW&F–öâæ’BvVæ6—76VÖVçBæR6†ævR"À¢vÆR…T"W7BVæR&–Ö—F—fRÆöv—7F–72¶öÖW&6RÂ¦Ö—2Æ&÷&œ:—L:’BVâÖ&¶WBÂBVæR6÷W&6R÷RBVâf÷W&æ—76WW"²7WÆ–W"ÆVrWBÖ&¶WBÆVr&W7FVçBFWW‚¦Ö&W2F—7F–æ7FW2rÀ¢w7Æ—BöÖW&vR÷&W6²6†ævVçBÆW2VçfVÆ÷W2‡—6—VW26ç2676W"Æf–Æ–F–öâ÷&FW"—FVÒ(i"W&6†6RÆ–æRõò(i"ÆÆö6F–öâ÷Væ—L:’‡V"(i"&6VÂ÷6†—ÖVçB(i"&VÆ—2rÀ¢vÆRg&WBÖ&—F–ÖRæR6RfVçF–ÆR¦Ö—2Rö–G2¢föÇVÖR6’6æ6†÷BÂ&W'F—F–öâVvÆR6öæf–FVæ6RÆ÷r6–æöârÀ¢wVâ&öGV—BFwVRg&v–ÆRæR6R&W6¶R¦Ö—2‡&W6µöW†V×B’¢Æ&÷FV7F–öâ&–ÖR7W"ÆRföÇVÖRrÀ¢vÆ†÷FòFR66VÆÆRGV&’W7BÆ&÷&æRFR&W7öç6&–Æ—FR¢fçBÒf÷W&æ—76WW"Â&W2ÒG&ç7÷'BrÀ¢vÆR7—7FVÖR&W67&—B‡&W6²öÖV7W&R÷†÷Fò’ÂÂvVçBW†V7WFRÂ¦Ö—2Â–çfW'6R…#"’rÀ¢wVæRò&Vw&÷WVR†÷&FW%ö–BåTÄÂ’æR2ÆÆ÷VRR‡V"VR"Æ–væRB6†B‡W&6†6UöÆ–æUö–B’Â&W'F–RFç2Â÷&G&RFW26öÖÖæFW2WBÆföææVRR&W7FçBGRVffV7F–bÂWBâW7B¦Ö—2&V6Wf&ÆRFçBRVÆÆRW7BVâ'&÷V–ÆÆöâ÷RæçVÆVR‡V&çF–æR’²ÂÆÆö6F–öâ†—7F÷&—VR&W7FRRæ—fVRòrÀ¢wVâ6öÆ—2æR6†ævRFR7FGWBVRf–VæR6WVVæ6RFR66âfÆ–FVRrÀ¢²7FFVÖVçC¢w6V7&WBFR&WG&—BW6vRVæ—VRÂWBVæR6WVÆRfö–RFR&VÖ—6RWWBvvæW"÷W"VæR6öÖÖæFRrÀ¢FW7C¢wFW7G2öS&RÖ’ö÷&FW'2ç–6·WÖ6öFR×g2ÖWF†÷&—¦VBÖæÖRæS&RçFW7Bæ§2rÒÀ¢vÆR&WG&—BW†6WF–öææVÂ"WF÷&—6F–öâæöÖ–æF—fRæR&WfVÆR¦Ö—2ÆRæöÒGFVæGRÅÂvvVçB&VÆ—2(	B6ö×&—6öâfWVvÆRVæ—VVÖVçBrÀ¢vÆR6ö×FWW"FRFVçFF—fW2GR&WG&—BW†6WF–öææVÂ†W†6WF–öæÅ÷–6·WöGFV×G2’W7BF—7F–æ7BFR6VÇV’GR6öFR6V7&WB‡–6·W÷6V7&WEöGFV×G2’(	BVâV6†V27W"ÅÂwVâæR&Æ÷VR¦Ö—2ÅÂvWG&RrÀ¢vÆR¦ÆöâF—7öæ–&ÆRR&VÆ—2G&ç6ÖWB:æ÷F–f–6F–öç2ÆRæöÒWBÂG&W76RV&Æ–72ì:–6W76—&W2RÆ–VâFRÆö6Æ—6F–öâÂ6ç2|:–ö6öFvR&Æ÷VçBrÀ¢²7FFVÖVçC¢t…T"Ó¢ÂÆÆö6F–öâ:–6öæöÖ—VRW7B6æ6†÷L:–RFWV—2VæRW&6†6R÷&FW"W†7FR²7WÆ–W"÷&FW"–FVçF—G’Â4µRÂ÷&FW"—FVÒÂÖ&¶WBWBFW7F–æF–öâ6öçB–Ö×V&ÆW2<;GL:’‡V"WBæR6öçB¦Ö—2FWf–ì:—2rÀ¢FW7C¢wFW7G2ö–çFVw&F–öâö‡V"×‡—6–6ÂÖ–FVçF—G’×÷7Fw&W2çFW7Bæ§2rÒÀ¢²7FFVÖVçC¢t…T"Ó¢Vâ–æ&÷VæB7WÆ–W"6¶vRWWB6öçFVæ—"ÇW6–WW'2Ö&¶WG2ÂÖ—24´TBôD•5D4„TBW†–vRW†7FVÖVçBVâÖ&¶WB,:—6öÇRFWV—2ÆW2ÆÆö6F–öç27F—fW2rÀ¢FW7C¢wFW7G2ö–çFVw&F–öâö‡V"×‡—6–6ÂÖ–FVçF—G’×÷7Fw&W2çFW7Bæ§2rÒÀ¢²7FFVÖVçC¢vÆ,:–6öæ6–Æ–F–öâ–æ&÷VæB6öæg&öçFRVæ—VVÖVçBÆRgVÆf–ÆÆÖVçBf÷W&æ—76WW"6æöæ—VRWBÆW2Æ6VÖVçG2‡—6—VW2$T4T•dRGR‡V"¢G&6¶–ærf÷W&æ—76WW"6WVÂ&W7FRTäD”ärÂVçF—L:’W†7FR6ç2æöÖÆ–R&öGV—B”ä$õTäEôÔD4„TBÂ,:–6WF–öâ'F–VÆÆR&W7FRTäD”ärÂFæF—2VR7W"×,:–6WF–öâÂV&çF–æR÷R–æ6–FVçB‡—6—VR÷WfW'B&öGV—BÔ•4ÔD4‚rÀ¢FW7C¢wFW7G2÷Væ—Bö‡V"Ö–æ&÷VæB×&V6öæ6–Æ–F–öâçFW7Bæ§2rÒÀ¢²7FFVÖVçC¢vÆ&VÖ—6R6Æ–VçB6R&÷WfR"ÆR66â6æöæ—VR6öÆÆV7FVBÆœ:’R6öÆ—2WBVæRÜ:—F†öFRWF÷&—<:–R…”4µUô4ôDRÂUD„õ$•¤TEôäÔUô”Eô4„T4²fV2WF÷&—6F–öâ¶Fö7VÖVçBÂ÷R%õDô´TâfÆ–L:’’²Vâ7FGWB&6VÂö÷&FW"6öÆÆV7FVB6ç26WGFR&WWfR&öGV—BÔ•4ÔD4‚ÂVæR6öÖÖæFR7Æ—GL:–R&W7FRTäD”ärFçBRVâÆ÷BÖçVRÂWB„äDôdeôÔD4„TBW†–vRF÷W2ÆW2&6VÇ27F–g26öÆÆV7L:—2fV2&WWfRrÀ¢FW7C¢wFW7G2÷Væ—Bö7W7FöÖW"Ö†æFöfb×&V6öæ6–Æ–F–öâçFW7Bæ§2rÒÀ¢²7FFVÖVçC¢t…T"Ó¢5Ä•BôÔU$tRõ$U4²6†ævVçBVæ—VVÖVçBÆW2Æ6VÖVçG2‡—6—VW2²V7VæR÷:—&F–öâ‡V"æR,:–76–væRÂÆÆö6F–öâ:–6öæöÖ—VRrÀ¢FW7C¢wFW7G2ö–çFVw&F–öâö‡V"×‡—6–6ÂÖ–FVçF—G’×÷7Fw&W2çFW7Bæ§2rÒÀ¢²7FFVÖVçC¢t…T"Ó¢Æ6VÖVçG2WB7W7FöG’6öç6W'fVçBÆWW"†—7Fö—&R²7W7FöG’W7BVæBÖöæÇ’WBVæRVçF—L:’6†WL:–RæRWWB2:§G&R‡—6—VVÖVçBGWÆ—\:–RÜ:¦ÖR6÷W26öæ7W'&Væ6RrÀ¢FW7C¢wFW7G2ö–çFVw&F–öâö‡V"×‡—6–6ÂÖ–FVçF—G’×÷7Fw&W2çFW7Bæ§2rÒÀ¢²7FFVÖVçC¢t…T"Ó¢Vâ6öç7FBÄõ5Bõ5DôÄTâôDU5E$õ”TBôDÔtTEõTåU4$ÄRWB6öâ:—l:–æVÖVçB÷WF&÷‚c6öçBFöÖ—VW2Fç2ÆG&ç67F–öâFRÂVÆçBWB–FV×÷FVçG2R&V¦WRrÀ¢FW7C¢wFW7G2ö–çFVw&F–öâö‡V"×‡—6–6ÂÖ–FVçF—G’×÷7Fw&W2çFW7Bæ§2rÒÀ¢²7FFVÖVçC¢wVâvVçE÷G&ç6—F—&RæRÆ—BWBæR6öæf—&ÖRÆRG&ç6—BVR7W"6öâVæ—VRÖ&6Œ:’L:–Ì:–w\:’²VæR&W76÷W&6RN(	—VâWG&RÖ&¶WB”BW7B–çf—6–&ÆRƒCB’rÀ¢FW7C¢wFW7G2÷Væ—B÷G&ç6—F—&RÖ’çFW7Bæ§2rÒÀ¢²7FFVÖVçC¢vÆW2ÆV7GW&W2‡V"N(	—VâÖ&¶WEö÷W&F÷"6öçBf–ÇG,:–W2Væ—VVÖVçB"ÆW2Ö&¶WB”G2ü;’÷W&F–öç2ç&VBW7B7F—fR²FÖ–âövVçEö‡V"&W7FVçB6VçG&W‚WBÆW2×WFF–öç2‡—6—VW2&W7FVçB†÷'2L:–Ì:–vF–öâ—2rÀ¢FW7C¢wFW7G2÷Væ—Bö‡V"çFW7Bæ§2rÒÀ¢ÒÀ§Ó°