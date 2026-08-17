/**
 * @feature       platform-ops
 * @type          transversal
 * @domain        operations
 * @status        production
 * @owner         backend-core
 * @since         2025-08
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 */
'use strict';

module.exports = {

  // ── Identite ─────────────────────────────────────────────────────────────
  name:     'platform-ops',
  type:     'transversal',   // feature | transversal
  domain:   'operations',
  status:   'production',   // draft | staging | production | deprecated
  owner:    'backend-core',
  since:    '2025-08',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  // ── Service rendu ────────────────────────────────────────────────────────
  service: 'Exposer la sante applicative, la configuration et les modules actifs — infrastructure d\'exploitation, pas de service metier.',

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'health check, configuration exposee, liste de modules actifs, API d\'operations interne',
    ],
    out: [
      'toute logique metier — platform-ops n\'a pas de regle metier propre',
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  files: {
    compositionRoots: [
      'public/boutique/js/main.js',
      'public/boutique/js/boutique.js',
      'public/boutique/js/b-nav.js',
    ],
    services: [
      'services/monitoring.js',
      'services/simulator/cleanup.js',
      'services/simulator/engine.js',
      'services/simulator/journal.js',
      'services/simulator/scenarios.js',
      'services/simulator/state-advancer.js',],
    routes: [
      'routes/modules.js',
      'routes/health.js',
      'routes/ops-api.js',
      'routes/config.js',
    
      'routes/simulator.js',],
    boutique: [
      // Backfill gouvernance globale : socle technique Boutique (bus, state, api-client,
      // utils, scroll, entrée page). Headers @komerce-arch domain=boutique,
      // layer=state|api-client|ui-infrastructure|util — transverse à toutes les
      // features Boutique, ne porte aucune règle métier propre (cf. perimeter.out).
      'js/komerce-api.js',
      'js/b-store.js',
      'js/b-bus.js',
      'js/b-utils.js',
      'js/b-scroll-owner.js',
      'index.html',
    ],
      tests: [
      'tests/integration/api.test.js',
      'tests/integration/isweep-invariants.test.js',
      'tests/integration/isweep-services.test.js',
      'tests/integration/isweep-transactional-flows.test.js',
      'tests/integration/relais-idor-probe.test.js',
      'tests/integration/security-grid.test.js',
      'tests/unit/relais-idor-probe.test.js',
      'tests/unit/validators.test.js',
      // Rapatriés depuis features/operations.feature.js (doublon supprimé,
      // audit 2026-07-06 §2c) — services/routes étaient déjà ici, seuls ces
      // tests traînaient encore dans l'ancien manifeste.
      'tests/unit/config-route.test.js',
      'tests/unit/health.test.js',
      'tests/unit/journal.test.js',
      'tests/unit/modules.test.js',
      'tests/unit/monitoring.test.js',
      'tests/unit/simulator-cleanup.test.js',
      'tests/unit/ops-api.test.js',
      'tests/unit/scenarios.test.js',
      'tests/unit/simulator-engine.test.js',
      'tests/unit/simulator-platform-ops.test.js',
      'tests/unit/simulator-route.test.js',
      'tests/unit/state-advancer.test.js',
    ],
  },

  // ── Contrat d'interface ──────────────────────────────────────────────────
  docs: [],

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
      'fabrics: RW',
      'garment_models: RW',
      // incidents: R uniquement — table possédée par incident-management (Lot O2).
      // routes/ops-api.js continue d'y écrire directement en legacy (voir
      // debt.knownGaps) ; documenté ici en lecture, pas en propriété d'écriture.
      'incidents: R',
      'invoices: R',
      'notification_log: W',
      'order_items: R',
      'orders: RW',
      'parcel_items: RW',
      'parcels: RW',
      'products: R',
      'relais: R',
      'scan_events: R',
      'scans: RW',
      'store_credits: W',
      'users: R',
    ],
  },

  security: {
    status: 'CONFIRMED_MIXED',
    authedRoutesDetected: 25,
    totalRoutes: 33,
    note: "25/33 routes protégées. 8 routes publiques par design : GET /health, /health/ready, /health/version (sondes infra) ; GET /api/modules, /modules/:type, /modules/fabrics, /modules/models et POST /api/modules/price (configurateur de modules public, consommé par la boutique).",
  },
  contract: {
    exposes: [
      'GET /health',
      'GET /api/modules',
      // Rapatriées depuis le route-registry (audit 2026-07-06 §3) — routes
      // réelles câblées via bootstrap/api-routes.js, jamais déclarées jusqu'ici.
      'POST /api/admin/simulator/cleanup',
      'GET /api/admin/simulator/journal',
      'POST /api/admin/simulator/start',
      'GET /api/admin/simulator/status',
      'POST /api/admin/simulator/stop',
      'GET /api/modules/:type',
      'GET /api/modules/fabrics',
      'POST /api/modules/fabrics',
      'GET /api/modules/models',
      'POST /api/modules/models',
      'POST /api/modules/price',
      'POST /api/simulator/cleanup',
      'GET /api/simulator/journal',
      'POST /api/simulator/start',
      'GET /api/simulator/status',
      'POST /api/simulator/stop',
      'GET /api/v2/alerts',
      'POST /api/v2/alerts/:id/acknowledge',
      'GET /api/v2/global',
      'GET /api/v2/incidents',
      'GET /api/v2/invoices',
      'GET /api/v2/parcels/:id/orders',
      'GET /api/v2/parcels/:id/scans',
      'GET /api/v2/parcels/:ref/detail',
      'GET /api/v2/reconciliation',
      'GET /api/v2/reconciliation/summary',
      'GET /api/v2/scan-events',
      'GET /health/detailed',
      'GET /health/metrics',
      'GET /health/ready',
      'GET /health/version',
    ],
    consumes: [
      'purchasing (client API transversal appelle le référentiel fournisseurs /api/purchasing/suppliers)',
      'catalog (shell/client API transversal monte et appelle les surfaces catalogue sans en posséder l’état)',
      'auth-identity (client API transversal et shell identité consomment les endpoints auth)',
      'infrastructure (dépendance technique transversale observée : DB, logger, helpers ou bootstrap possédés par infrastructure)',
      "business-rules (FF-C1 2026-07-29 — lecture du référentiel de règles métier ; preuve: routes/config.js -> utils/rules.js)",

      "auth (FF-C1 2026-07-29 — garde de route et contexte d’identité ; preuve: routes/modules.js -> middleware/auth.js ; routes/health.js -> middleware/auth.js ; routes/ops-api.js -> middleware/auth.js ; +2)",

      'economic-engine (calcul de prix ponctuel pour modules sur-mesure — services/pricing-engine.js recommend, O7.1 OWNERSHIP_CONFIRMED_BOUNDARY_REQUIRED, boundary formalisee O7.3)',
      'logistics (simulateur declenche une transition colis via transitionParcelStatus — services/parcel-operations.js, O7.1 OWNERSHIP_CONFIRMED_BOUNDARY_REQUIRED, boundary formalisee O7.3)',
      'orders (simulateur declenche une transition commande via transitionOrderStatus — services/order-status-machine.js, O7.1 OWNERSHIP_CONFIRMED_BOUNDARY_REQUIRED, boundary formalisee O7.3)',
    ],
  },

  // ── Dette assumée / documentée ────────────────────────────────────────────
  // (audit 2026-07-06 §2c — vérifié empiriquement contre bootstrap/api-routes.js)
  debt: {
    knownGaps: [
      { gap: 'ancien contrat déclaré "GET /api/config" : routes/config.js existe bel et ' +
             'bien et expose 5 endpoints réels (GET/PUT /api/config/rules, ' +
             '/api/config/rules/:key, /api/config/rules/:key/reset, ' +
             '/api/config/rules/:key/history) — mais ce fichier n\'est require() ni monté ' +
             'nulle part dans bootstrap/api-routes.js ni server.js. Ce n\'est pas un contrat ' +
             'désynchronisé d\'un chemin : c\'est du code mort jamais câblé.',
        risk: 'moyen — 5 endpoints de gestion de règles métier (config runtime) sont ' +
              'invisibles et inaccessibles en admin. Décision produit à trancher : câbler ' +
              'routes/config.js sous un préfixe (ex. app.use(\'/api/config\', require(\'./routes/config\'))) ' +
              'si le besoin existe encore, ou supprimer le fichier si obsolète. Ne pas ' +
              'rajouter "GET /api/config" à exposes tant que ce choix n\'est pas fait — ' +
              'ce serait re-déclarer une route qui ne répond toujours pas.',
      },
      { gap: 'RÉSOLU (2026-07-06) — routes/ops-api.js déclarait GET /parcels et GET /parcels/:id ' +
             '(lignes 604 et 457), montées sous /api/v2 (bootstrap/api-routes.js:141). Elles ' +
             'étaient shadowed par routes/parcel-api-v2/read.js (GET / et GET /:ref, feature ' +
             'logistics), montées sous /api/v2/parcels AVANT ops-api (bootstrap/api-routes.js:137) ' +
             '— code mort, jamais atteint. Les deux handlers ont été supprimés de ops-api.js ' +
             '(remplacés par une note de gouvernance renvoyant ici et vers logistics.feature.js). ' +
             'Les tests unitaires qui les exerçaient en isolation ont été retirés avec eux ' +
             '(tests/unit/ops-api.test.js).',
        risk: 'nul désormais — un seul contrat vivant reste sous /api/v2/parcels(/:ref), possédé ' +
              'par logistics. Les FAIL DUPLICATE_ROUTE_OWNER et PARAM_NAME_MISMATCH liés ' +
              'devraient disparaître au prochain run du gate ; à vérifier empiriquement.',
      },
      { gap: 'SPLIT (2026-07-12, Lot O2) — services/incident-service.js et la table incidents ' +
             'ont été scindés vers features/incident-management.feature.js (voir §A4 de ' +
             'BUSINESS_FEATURE_ONTOLOGY_O2 : table propriétaire riche, lifecycle engageant, ' +
             '4 consommateurs symétriques — Signal 4 transversal). routes/ops-api.js reste dans ' +
             'platform-ops et continue d\'écrire directement dans incidents par SQL inline ' +
             '(1 mutation sur ~15 endpoints, @db-write-via:legacy) au lieu de passer par ' +
             'incident-service.js — dette de câblage documentée dans incident-management.feature.js, ' +
             'refacto runtime explicitement refusé pour ce lot.',
        risk: 'faible — la lecture est documentée ici (incidents: R), l\'écriture legacy est ' +
              'assumée et trackée côté incident-management.feature.js.',
      },
      { gap: 'CONSERVÉ (2026-07-12, Lot O2) — modules / fabrics / garment_models. Le service ' +
             'réel doit être rechallengé contre catalog / product configuration. platform-ops ' +
             'les possède actuellement en runtime et en DB (routes/modules.js, CRUD actif), ' +
             "mais cette frontière n'est pas considérée définitivement validée. Aucun split, " +
             'retag de routes/modules.js, déplacement de table ou nouvelle feature décidé ce lot ' +
             '— la classification a seulement été corrigée pour cesser de présenter platform-ops ' +
             'comme une infrastructure pure sans tables ni service actif.',
        risk: 'moyen — frontière produit non tranchée entre platform-ops et catalog ; pas de risque technique immédiat.',
      },
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — infrastructure partagee, changement valide par l\'equipe plateforme',

  // ── Invariants propres ───────────────────────────────────────────────────
  // Corrigé au Lot O2 (2026-07-12) — l'ancien invariant "aucune écriture métier
  // ne passe par platform-ops" était mensonger vis-à-vis de la table incidents
  // (écritures métier avec impact client et résolutions engageantes) — voir SPLIT
  // incident-management.
  invariants: [
    "les surfaces de santé et monitoring n'écrivent aucune donnée métier",
    'le simulator écrit dans les tables d\'autres features par design de simulation',
    'les modules (fabrics, garment_models) sont les seules tables possédées par platform-ops',
  ],

  // ── Classification ────────────────────────────────────────────────────────
  classification: {
    kind:     'technical-transversal',
    decision: 'transversal-technique',
    signals: {
      ownsTables:          true,  // fabrics, garment_models — CRUD actif via routes/modules.js, cf. db.tables et invariants
      ownsLifecycle:       false, // fabrics/garment_models sont des tables de configuration, pas un lifecycle métier engageant
      activeService:       true,  // le module fabrics/garment_models (routes/modules.js) rend un service actif (configurateur), distinct de health/monitoring qui reste passif
      multiConsumer:       false, // platform-ops ne consomme pas d'autres features — c'est l'inverse
      ownsMigrations:      false, // aucune migration métier dédiée
      externalSideEffect:  'none',
      surface:             'api',
    },
    rationale: [
      "surfaces health/monitoring : observation technique passive, aucune écriture métier — l'invariant «aucune écriture métier» reste vrai pour ce sous-périmètre",
      "simulator : mutation des domaines tiers par design de simulation, mais aucune autorité métier propre sur leurs lifecycles",
      "modules (fabrics, garment_models) : CRUD actif via routes/modules.js, tables actuellement possédées par platform-ops en runtime et en DB — frontière métier encore non résolue vis-à-vis de catalog (cf. debt.knownGaps)",
      "platform-ops n'est donc pas une infrastructure pure au sens strict : elle combine de l'observation passive (health/monitoring) et un CRUD métier actif non encore rattaché (modules)",
      'consommé transversalement par l\'outillage CI, monitoring, et toutes les features',
    ],
  },

};
