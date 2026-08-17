/**
 * @feature       recommendations
 * @type          feature
 * @domain        recommendations
 * @status        staging
 * @owner         backend-core
 * @since         2026-02
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 */
'use strict';

module.exports = {

  // ── Identite ─────────────────────────────────────────────────────────────
  name:     'recommendations',
  type:     'feature',   // feature | transversal
  domain:   'recommendations',
  status:   'staging',   // draft | staging | production | deprecated
  owner:    'backend-core',
  since:    '2026-02',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  // ── Service rendu ────────────────────────────────────────────────────────
  service: 'Classer et suggerer des produits boutique selon un moteur de ranking dedie.',

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'moteur de classement boutique',
      'endpoint de suggestions',
    ],
    out: [
      'donnees produit source (feature catalog)',
      'prix affiche (feature economic-engine)',
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  files: {
    services: [
      'services/boutique-ranking-engine.js',
    ],
    routes: [
      'routes/boutique-suggestions.js',
    ],
    tests: [
      'tests/unit/boutique-ranking-engine.test.js',
      'tests/unit/boutique-suggestions.test.js',
    ],
  },
  // ── decision-signals (Lot O1, 2026-07-12) ───────────────────────────────
  // services/radar-queries.js, services/signal-service.js, routes/signals.js
  // et leurs tests ont quitté ce manifest : ils ne rendent pas le service de
  // classement boutique (recommendations), mais un mécanisme de détection de
  // signaux opérationnels cross-feature, gouverné désormais comme piloting
  // capability — voir capabilities/decision-signals.capability.js et
  // docs/doctrine/PILOTING_CAPABILITY_DOCTRINE.md.

  // ── Contrat d'interface ──────────────────────────────────────────────────
  docs: [
    'docs/doctrine/BOUTIQUE_PERSONNALISATION_NAVIGATION.md',
  ],

  // ── Tables DB (inféré, audit 2026-07-06, §axe2) ─────────────────────────
  // Généré par parsing réel des appels .query() (pas un grep de mots) :
  // R = lu par cette feature, W = écrit par cette feature, RW = les deux.
  // Une table listée ici pour PLUSIEURS features est une vraie propriété
  // partagée détectée dans le code, pas un artefact de méthode — à
  // documenter explicitement si volontaire, ou à re-scoper sinon.
  // Champ auto-généré : à corriger à la main si une requête dynamique
  // (nom de table construit par variable) a échappé au scan.
  // db.tables réduit au périmètre réel du moteur de ranking (Lot O1,
  // 2026-07-12) : cash_collections, cash_deposits, finance_config,
  // incidents, signals, users, wallets appartenaient au périmètre
  // decision-signals (radar-queries.js / signal-service.js), pas au
  // ranking boutique — voir capabilities/decision-signals.capability.js.
  db: {
    tables: [
      'order_items: R',
      'orders: R',
      'parcels: R',
      'products: R',
    ],
  },

  contract: {
    exposes: [
      'GET /api/boutique/suggestions',
    ],
    consumes: ['catalog (lecture produit)',
      'platform-ops (monitoring/exploitation transverse observé dans le code)',
      'infrastructure (dépendance technique transversale observée : DB, logger, helpers ou bootstrap possédés par infrastructure)',
      'auth',
      'logistics',
      'orders (frontière frontend orders-client/cart-public-api.js consommée par b-modal-suggestions.js ; aucune importation directe des internes panier)',
    ],
  },

  // ── decision-signals (piloting capability, Lot O1) ──────────────────────
  // Les routes /api/admin/signals/* (GET/DELETE/POST acknowledge/resolve/
  // snooze/generate/stats) ont quitté ce contrat : elles sont exposées par
  // routes/signals.js, désormais dans le périmètre de la capability
  // decision-signals, pas dans le contrat public de recommendations.
  // Voir capabilities/decision-signals.capability.js.

  // ── Autorite ─────────────────────────────────────────────────────────────
  // ── Sécurité (constat factuel, audit 2026-07-06 §axe3 ; corrigé Lot O1
  //    2026-07-12 après extraction de decision-signals — les 7 routes
  //    admin protégées de routes/signals.js quittent ce périmètre, voir
  //    capabilities/decision-signals.capability.js) ────────────────────────
  security: {
    status: 'CONFIRMED_PUBLIC_BY_DESIGN',
    authedRoutesDetected: 0,
    totalRoutes: 1,
    note: "Seule route restante après extraction de decision-signals : "
        + "GET /api/boutique/suggestions, classée PUBLIC et volontairement "
        + "sans garde — ranking produit pour visiteurs anonymes non "
        + "connectés (routes/boutique-suggestions.js). La sécurité des "
        + "routes /api/admin/signals/* (7/8 protégées) est désormais suivie "
        + "dans capabilities/decision-signals.capability.js.",
  },

  authority: 'backend-core — tout changement de formule de classement doit etre valide par le proprietaire de boutique-ranking-engine.js',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    'le ranking ne modifie jamais les donnees produit, lecture seule sur catalog',
  ],

  // ── Classification (ajoutée Lot O1, manifest modifié dans cette PR) ─────
  classification: {
    kind:     'business-feature',
    decision: 'feature-autonome',
    signals: {
      ownsTables:          false, // pas de table propre — pur calcul sur données catalog/orders en lecture
      ownsLifecycle:       false,
      activeService:       true,  // calcule un classement à la demande
      multiConsumer:       false,
      ownsMigrations:      false,
      externalSideEffect:  'none',
      surface:             'api',
    },
    rationale: [
      'service actif identifiable (classer/suggérer), pas une projection d\'une autre feature',
      'moteur de ranking dédié (boutique-ranking-engine.js) avec sa propre formule, invariant lecture-seule sur catalog',
      'perimetre resserre au Lot O1 : le sous-ensemble decision-signals (radar/signals) en a ete extrait car il ne partage ni service ni cycle de vie avec le ranking',
    ],
  },

};
