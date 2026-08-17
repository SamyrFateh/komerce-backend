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

  // ── Identite ─────────────────────────────────────────────────────────────
  name:     'logistics',
  type:     'feature',   // feature | transversal
  domain:   'logistics',
  status:   'production',   // draft | staging | production | deprecated
  owner:    'backend-core',
  since:    '2025-08',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  // ── Service rendu ────────────────────────────────────────────────────────
  service: 'Faire transiter un colis du scan initial au retrait final, avec tracking client et transporteur.',

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'scan et operations colis',
      'creation automatique de colis',
      'secrets de retrait',
      'tracking client et transitaire',
      'relais et transporteurs',
      // ── 2026-07 : densite de valeur + qualite hub Dubai ──
      'consignes hub prescrites au scan : repack, mesure volume, photo de scelle (bornes de responsabilite)',
      'saisie volumes produits (POST /hub/volume) et photos de scelle (POST /hub/photo)',
    ],
    out: [
      'cout du transport (feature economic-engine)',
      'declaration douaniere (feature customs)',
      'preuve de retrait document (feature documents, consommee ici)',
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  files: {
    middleware: [
      'middleware/upload-hub.js',
    ],
    migrations: [
      'migrations/095_value_density_foundation.sql',
      'migrations/096_quality_foundation.sql',
      // Lot 5 : migrations/121_exceptional_pickup_authorization.sql ajoute
      // exceptional_pickup_attempts/blocked_until + pickup_collected_via sur
      // orders (logistics) MAIS crée aussi user_pickup_authorizations,
      // propriété d'auth-identity — fichier possédé par une seule feature
      // (doctrine multipropriété), déclaré dans features/auth-identity.feature.js.
    ],
    docs: [
      'docs/doctrine/DOCTRINE_DENSITE_VALEUR.md',
      'docs/doctrine/DOCTRINE_NON_CONFORMITE.md',
      'docs/doctrine/DOCTRINE_TRANSPORT_RAILS.md',
      'docs/ops/NOTE_OPS_CALIBRATION_DENSITE_V5.md',
    ],
    utils: [
      'utils/parcelSync.js',
    
      'utils/parcels.js',
      'utils/pickup-receipt-html.js',],
    services: [
      'services/parcel-operations.js',
      'services/parcel-item-mutation-service.js',
      'services/parcel-mutation-service.js',
      'services/parcel-security.js',
      'services/scan-operations.js',
      'services/scan-write-service.js',
      'services/scan-engine.js',
      'services/auto-parcel.js',
      'services/pickup-secret-service.js',
      'services/parcel-auto-create-service.js',
      'services/parcel-guards.js',
      'services/parcelOptimizationService.js',
      'services/parcel-service.js',
    
      'services/hub-operations.js',
      'services/routing.js',
      'services/transport-rails.js',],
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
      'routes/hub.js',],
    boutique: [
      'js/b-tracking.js',
    ],
      dash: [
      // dashboards/admin views — Lot 4
      'dashboards/admin/js/views/HubRelaisView.js',
      'dashboards/admin/js/views/OrdersLogisticsView.js',
    ],
    tests: [
      'tests/integration/test-harness/seed-helpers.js',
      'tests/unit/auto-distribute-api.test.js',
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
      'tests/unit/pickup-receipt-html.test.js',
      'tests/unit/pickup-secret.test.js',
      'tests/unit/pickup-secret-service.test.js',
      'tests/unit/scan-operations.test.js',
      'tests/unit/scan-write-service.test.js',
      'tests/unit/scan-engine.test.js',
      'tests/unit/parcel-operations.test.js',
      'tests/unit/parcel-item-mutation-service.test.js',
      'tests/unit/parcel-mutation-service.test.js',
      'tests/unit/parcel-guards.test.js',
      'tests/unit/parcel-auto-create-service.test.js',
      'tests/unit/hub-operations.test.js',
      'tests/unit/parcels-route.test.js',
      'tests/unit/parcel-api-v2-read.test.js',
      'tests/unit/relais.test.js',
      'tests/unit/routing.test.js',
      'tests/unit/transport-rails.test.js',
      'tests/unit/scans.test.js',
      'tests/unit/tracking.test.js',
      'tests/unit/transit-dashboard.test.js',
      'tests/unit/transitaire-api.test.js',
    ],

},

  // ── Dépôts ───────────────────────────────────────────────────────────────
  repos: {
    backend: 'services/ + routes/ ci-dessus',
    boutique: 'js/b-tracking.js — dépôt "bout", voir docs/BOUTIQUE_OWNERSHIP_LIVE.md pour le détail DOM/CSS',
  },

  // ── Contrat d'interface ──────────────────────────────────────────────────
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
      'business_rules: R',
      'carriers: RW',
      'incidents: RW',
      'invoices: R',
      'order_items: R',  // W-via:order-item-availability-service (orders owner boundary)
      // order_status_history retiré (Sprint A, 2026-07-07) : les 4 anciennes
      // écritures directes (markAvailability, partialShip, updateParcelStatus,
      // cancelBackorder) délèguent maintenant à
      // order-status-machine.appendOrderHistoryNote(). Logistics ne lit
      // jamais cette table — pas de déclaration R/W requise (cf. convention
      // W-via ci-dessous, qui ne s'applique qu'aux tables aussi lues).
      'orders: RW',
      'parcel_events: RW',
      'parcel_items: RW!',  // OWNER (campagne WRITER-NOT-OWNER, 2026-08)
      'parcels: RW!',  // OWNER (campagne WRITER-NOT-OWNER, 2026-08)
      'pickup_print_tokens: RW!',  // OWNER (campagne WRITER-NOT-OWNER, 2026-08)
      'pickup_reveal_codes: RW!',  // OWNER (campagne WRITER-NOT-OWNER, 2026-08)
      'pickup_verify_attempts: RW',
      'product_suppliers: R',
      'product_variants: R',          // W-via:order-status-machine (service orders)
      'products: R',          // W-via:product-admin-service (adjustStock — parcel-operations.js)
      'purchase_orders: R',
      'recipients: R',
      'relais: RW!',  // OWNER (campagne WRITER-NOT-OWNER, 2026-08)

      'scan_events: RW!',  // OWNER (campagne WRITER-NOT-OWNER, 2026-08)
      'scans: RW!',  // OWNER (campagne WRITER-NOT-OWNER, 2026-08)
      'shipments: RW',
      // sourcing_candidate_events, sourcing_candidates, supplier_catalog_imports :
      // retirées d'ici (Lot O1.3, 2026-07-12) — n'étaient lues/écrites que par
      // routes/sourcing-scanner.js, extrait vers features/sourcing.feature.js.
      'users: R',
    ],
  },

  security: {
    status: 'CONFIRMED_MIXED',
    authedRoutesDetected: 74,
    totalRoutes: 79,
    note: "74/79 routes protégées. 5 routes publiques par design : GET /api/relais, /relais/public, /relais/:id (annuaire public des points relais) ; GET /api/tracking/:token et POST /api/tracking/:token/verify-pickup (capability token documenté — pas d'accès aux données client sans token valide).",
  },
  contract: {
    exposes: [
      'GET/POST /api/parcels',
      'POST /api/v2/parcels/:ref/scan',
      'GET /api/tracking/:token',
      // Les 11 routes /api/admin/sourcing/* (audit 2026-07-06 §3) ont quitté ce
      // contrat — extraites vers features/sourcing.feature.js (Lot O1.3, 2026-07-12).
      'GET /api/carriers',
      'POST /api/carriers',
      'DELETE /api/carriers/:id',
      'PATCH /api/carriers/:id',
      'PATCH /api/carriers/customs/:parcel_id',
      'GET /api/client/tracking',
      'GET /api/hub/auto-distribute',
      'POST /api/hub/auto-distribute',
      'POST /api/hub/auto-distribute/cleanup',
      'POST /api/hub/batch-scan',
      'POST /api/hub/pack',
      'GET /api/hub/pending',
      'POST /api/hub/photo',
      'POST /api/hub/scan',
      'POST /api/hub/seal',
      'GET /api/hub/search',
      'GET /api/hub/stats/week',
      'GET /api/hub/today',
      'POST /api/hub/volume',
      'GET /api/logistics/labels/:shipment_id',
      'GET /api/logistics/manifest/:shipment_id',
      'GET /api/logistics/shipments',
      'POST /api/logistics/shipments',
      'PATCH /api/logistics/shipments/:id',
      'POST /api/parcels/:id/items',
      'DELETE /api/parcels/:id/items/:item_id',
      'PATCH /api/parcels/:id/status',
      'POST /api/parcels/:id/verify-seal',
      'POST /api/parcels/:id/weight',
      'GET /api/parcels/:ref',
      'GET /api/parcels/:ref/events',
      'POST /api/parcels/bootstrap/:orderId',
      'POST /api/parcels/optimize',
      'POST /api/pickup/collect/:orderId',
      'POST /api/pickup/pay-cash/:orderId',
      'GET /api/pickup/receipt/:orderId',
      'POST /api/pickup/regenerate/:orderId',
      'GET /api/pickup/reveal-once/:orderId',
      'GET /api/pickup/status/:orderId',
      'POST /api/pickup/verify/:orderId',
      // Lot 5 — retrait exceptionnel par autorisation nominative (substitution)
      'GET /api/pickup/exceptional-pickup/:orderId',
      'POST /api/pickup/exceptional-pickup/:orderId/collect',
      'GET /api/relais',
      'GET /api/relais/:id',
      'GET /api/relais/public',
      'POST /api/scans',
      'GET /api/scans/:order_id',
      'POST /api/scans/collect',
      'GET /api/scans/hub/pending',
      'POST /api/scans/hub/receive',
      'POST /api/scans/verify-qr',
      'POST /api/tracking/:token/verify-pickup',
      'GET /api/transit',
      'GET /api/transit-dashboard',
      'POST /api/transit-dashboard/:ref/transit',
      'POST /api/transit/:ref/transit',
      'GET /api/transitaire/history',
      'GET /api/transitaire/parcels',
      'POST /api/transitaire/ship',
      'GET /api/transitaire/stats',
      'GET /api/v2/parcels',
      'GET /api/v2/parcels/:ref',
      'GET /api/v2/parcels/:ref/label',
      'GET /api/v2/parcels/:ref/timeline',
      'GET /api/v2/parcels/alerts',
      'GET /api/v2/parcels/critical',
      'GET /api/v2/parcels/kpis',
      'GET /api/v2/parcels/reconciliation',
    ],
    // O7.3 (provider logistics) : formalise transitionParcelStatus() comme
    // capacité exposée cross-feature. Ownership confirmé O7.1 (WRITER !=
    // LIFECYCLE OWNER — logistics reste seul lifecycle owner du colis, le
    // simulateur ne fait que déclencher via cette fonction, jamais
    // d'écriture directe). skipValidation reste un paramètre explicite de
    // l'appelant, pas un contournement caché. Voir docs/O7_3_BOUNDARY_ANALYSIS.md.
    internalApi: [
      { fn: 'transitionParcelStatus', file: 'services/parcel-operations.js' },
      { fn: 'recordHubPreparationScan', file: 'services/scan-write-service.js' },
      { fn: 'recordQrCollectionScan', file: 'services/scan-write-service.js' },
      { fn: 'detachUserFromScans', file: 'services/scan-write-service.js' },
      { fn: 'assignWholeOrderItemToParcel', file: 'services/parcel-item-mutation-service.js' },
      { fn: 'assignParcelItem', file: 'services/parcel-item-mutation-service.js' },
      { fn: 'addParcelItem', file: 'services/parcel-item-mutation-service.js' },
      { fn: 'removeParcelItem', file: 'services/parcel-item-mutation-service.js' },
      { fn: 'assignSingleOrderItemToParcel', file: 'services/parcel-item-mutation-service.js' },
      { fn: 'createHubParcel', file: 'services/parcel-mutation-service.js' },
      { fn: 'createAutoPreparedParcel', file: 'services/parcel-mutation-service.js' },
      { fn: 'setParcelWeight', file: 'services/parcel-mutation-service.js' },
      { fn: 'appendParcelShipmentInfo', file: 'services/parcel-mutation-service.js' },
      { fn: 'markCustomsCleared', file: 'services/parcel-mutation-service.js' },
      { fn: 'markBackorderReminderSent', file: 'services/parcel-mutation-service.js' },
    ],
    consumes: [
      'infrastructure (dépendance technique transversale observée : DB, logger, helpers ou bootstrap possédés par infrastructure)',
      "business-rules (FF-C1 2026-07-29 — lecture du référentiel de règles métier ; preuve: utils/parcels.js -> utils/rules.js ; services/parcel-operations.js -> utils/rules.js)",
'orders (commande rattachee au colis)',
      'customs (statut declaration)',
      'auth',
      'auth-identity (autorisation nominative de retrait exceptionnel — services/pickup-authorization-service.js:getActiveAuthorizationForUpdate/hasActiveAuthorization, jamais de requête directe sur user_pickup_authorizations, Lot 5)',
      'catalog',
      'economic-engine',
      'notifications',
      'payments (marque une commande payee — services/payment-service.js ; confirme un paiement cash pickup transactionnel — services/confirm-pickup-cash-payment.js ; O7.2 Cycle B)',
      'refunds',
      'wallet',
      'purchasing (declenche verification/reapprovisionnement apres collecte cash relais — services/purchasing-trigger-service.js, O7.2 Cycle C)',
      'loyalty (recalcul de palier apres collecte cash relais / scan preparation — services/loyalty-service.js recalculateLoyalty/handleOrderConfirmed, O7.3 provider loyalty)',
    ],
  },

  // ── Dette assumée / documentée ────────────────────────────────────────────
  // (audit 2026-07-06 §2d — vérifié empiriquement contre le route-registry)
  debt: {
    knownGaps: [
      { gap: 'ancien contrat déclaré "POST /api/parcels/:id/scan" (v1) : aucune route ne ' +
             'sert ce chemin. Le scan de colis est passé à l\'API v2 ' +
             '(routes/parcel-api-v2/scans.js), montée sous /api/v2/parcels/:ref/scan.',
        risk: 'si un client externe (scanner physique, app mobile hub) appelle encore le ' +
              'chemin v1, il reçoit un 404 — à vérifier avant de considérer ce point clos.' },
      { gap: 'RÉSOLU (2026-07-06) — le FAIL [PARAM_NAME_MISMATCH] sur "GET /api/v2/parcels/:ref" ' +
             'était un artefact du bug de shadowing documenté dans platform-ops.feature.js ' +
             '(routes/ops-api.js déclarait GET /api/v2/parcels/:id, code mort, jamais atteint, ' +
             'mais structurellement comparé par le checker au vrai GET /:ref). Les handlers ' +
             'morts ont été supprimés de ops-api.js — le contrat :ref (celui réellement servi ' +
             'par routes/parcel-api-v2/read.js) n\'a plus de faux jumeau à comparer.',
        risk: 'nul désormais — à revérifier empiriquement au prochain run du gate.' },
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — tout changement de la machine de scan doit etre valide par le proprietaire de scan-engine.js',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    'le fret maritime ne se ventile jamais au poids : volume si snapshot, repartition egale confidence low sinon',
    'un produit tague fragile ne se repacke jamais (repack_exempt) : la protection prime sur le volume',
    'la photo de scelle Dubai est la borne 1 de responsabilite : avant = fournisseur, apres = transport',
    'le systeme prescrit (repack/measure/photo), l agent execute, jamais l inverse (R2)',
    'un colis ne change de statut que via une sequence de scan validee',
    'secret de retrait a usage unique',
    'le retrait exceptionnel par autorisation nominative ne revele jamais le nom attendu a l\'agent relais — comparaison aveugle uniquement',
    'le compteur de tentatives du retrait exceptionnel (exceptional_pickup_attempts) est distinct de celui du code secret (pickup_secret_attempts) — un echec sur l\'un ne bloque jamais l\'autre',
  ],

};
