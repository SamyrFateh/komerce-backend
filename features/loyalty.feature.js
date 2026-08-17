/**
 * @feature       loyalty
 * @type          feature
 * @domain        loyalty
 * @status        production
 * @owner         backend-core
 * @since         2025-10
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 */
'use strict';

module.exports = {

  // ── Identite ─────────────────────────────────────────────────────────────
  name:     'loyalty',
  type:     'feature',   // feature | transversal
  domain:   'loyalty',
  status:   'production',   // draft | staging | production | deprecated
  owner:    'backend-core',
  since:    '2025-10',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  // ── Service rendu ────────────────────────────────────────────────────────
  service: 'Calculer et maintenir le statut de fidelite d\'un client (palier + compteur gros panier) et ses recompenses.',

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'calcul et recalcul du palier de fidelite (recalculate_loyalty(), fonction DB appelee par routes/loyalty.js)',
      'compteur et notification de gros panier (big_basket_count / big_basket_last_notified_count)',
      'creation des recompenses "pending" (loyalty_rewards) au declenchement du seuil gros panier',
      'synthese de fidelite exposee (v_loyalty_summary) et grille des paliers (loyalty_tiers)',
    ],
    out: [
      'solde et mouvements wallet (feature wallet, scindee de wallet-loyalty au Lot O1)',
      'paiement carte/PayPal (feature payments)',
      'remboursement (feature refunds)',
      'traitement admin des recompenses en attente (routes/admin-loyalty.js — actuellement @domain dashboard, ' +
        'ecrit loyalty_rewards.status ; voir ONTOLOGY_GAP, non deplace dans ce lot)',
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  files: {
    services: [
      'services/loyalty-service.js',
    ],
    routes: [
      'routes/loyalty.js',
    ],
    migrations: [],
    tests: [
      'tests/unit/loyalty-notification.test.js',
      'tests/unit/loyalty-route.test.js',
      'tests/unit/loyalty-service.test.js',
    ],
  },

  docs: [],

  // ── Tables DB (vérifiées par grep .query() réel + schema_railway.sql, ────
  // Lot O1.2 2026-07-12) :
  // - users : loyalty-service.js écrit big_basket_count et
  //   big_basket_last_notified_count (colonnes propres, distinctes de
  //   loyalty_tier_id) ; routes/loyalty.js écrit loyalty_tier_id,
  //   orders_count et loyalty_since — mais indirectement, via l'appel SQL
  //   `SELECT recalculate_loyalty($1)` qui exécute la fonction DB du même
  //   nom (schema_railway.sql, ~L484). Le vrai UPDATE users vit dans cette
  //   fonction DB, pas dans le code applicatif — documenté ici pour ne pas
  //   perdre la trace de l'écriture réelle.
  // - loyalty_tier_id est aussi LU par routes/auth.js (JOIN loyalty_tiers) :
  //   lecture cross-feature normale (auth expose le palier au client), pas
  //   une ownership auth de la donnée.
  // - loyalty_rewards : loyalty-service.js insère (status='pending') et lit
  //   (verification du pending pour un user) → RW ici. routes/admin-loyalty.js
  //   (hors ownership loyalty, voir ONTOLOGY_GAP) écrit aussi le statut de
  //   cette même table — multi-writer réel entre deux owners actuels.
  db: {
    tables: [
      'finance_config: R',
      'loyalty_rewards: RW',    // insert + lecture pending (loyalty-service.js) ; voir ONTOLOGY_GAP pour l'écriture admin-loyalty.js
      'loyalty_tiers: RW',      // lecture grille (routes/loyalty.js) + écriture admin (PUT /tiers/:id)
      'orders: R',
      'users: RW',              // W : big_basket_count, big_basket_last_notified_count (direct) + loyalty_tier_id, orders_count, loyalty_since (via fonction DB recalculate_loyalty)
      'v_loyalty_summary: R',
    ],
  },

  security: {
    status: 'CONFIRMED_MIXED',
    authedRoutesDetected: 6,
    totalRoutes: 7,
    note: "6/7 routes protégées. 1 route publique par design : GET /api/loyalty/tiers (grille des paliers de fidélité, information publique vitrine).",
  },
  contract: {
    exposes: [
      'GET /api/loyalty/tiers',
      'GET /api/loyalty/me',
      'GET /api/loyalty/users',
      'GET /api/loyalty/stats',
      'PUT /api/loyalty/tiers/:id',
      'POST /api/loyalty/recalculate/:user_id',
      'POST /api/loyalty/recalculate-all',
    ],
    consumes: [
      'infrastructure (dépendance technique transversale observée : DB, logger, helpers ou bootstrap possédés par infrastructure)',
      "auth (FF-C1 2026-07-29 — garde de route et contexte d’identité ; preuve: routes/loyalty.js -> middleware/auth.js)",

      "notifications (FF-C1 2026-07-29 — émission de message ; preuve: services/loyalty-service.js -> services/notification-service.js)",

      'auth-identity (identification du client)',
      'wallet (aucune écriture — v_loyalty_summary et le calcul de palier ne lisent pas les tables wallet)',
    ],
  },

  // ── Dette assumée / documentée ────────────────────────────────────────────
  debt: {
    knownGaps: [
      { gap: 'ancien contrat wallet-loyalty déclarait "GET /api/loyalty/:userId" (ressource dans le ' +
             'chemin) : aucune route ne sert ce style — le détail se lit via GET /api/loyalty/me ' +
             '(session) ou GET /api/loyalty/users (admin, liste).',
        risk: 'si un consommateur externe construisait encore /api/loyalty/<id>, il reçoit un 404 — ' +
              'confirmé sans dépendance connue.',
      },
      { gap: 'l\'écriture réelle de users.loyalty_tier_id / users.orders_count / users.loyalty_since ' +
             'se fait dans la fonction PL/pgSQL recalculate_loyalty(), pas dans le code applicatif ' +
             'loyalty-service.js. La feature ne "possède" donc pas directement cette écriture au sens ' +
             'code, seulement au sens déclenchement (routes/loyalty.js est le seul appelant).',
        risk: 'aucun changement de comportement — documenté pour éviter qu\'un futur audit cherche ce ' +
              'code côté JS et conclue à tort à une table non écrite.',
      },
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — tout changement de calcul de palier ou de recompense doit etre valide par le proprietaire de loyalty-service.js',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    'ne pas changer les calculs de fidelite (Lot O1 — ontology refactor, pas product refactor)',
    'le recalcul de palier est idempotent : rejouable sans dupliquer une recompense deja accordee',
  ],

  // ── Classification (manifest créé au Lot O1) ────────────────────────────
  classification: {
    kind:     'business-feature',
    decision: 'feature-autonome',
    signals: {
      ownsTables:          true,
      ownsLifecycle:       true,  // palier + statut de récompense (pending/granted/skipped)
      activeService:       true,  // "calculer" est un verbe actif, pas une projection
      multiConsumer:       true,  // consommé par routes/admin-finance-config.js, routes/cash.js, routes/orders/create.js, routes/pickup-secret.js, routes/shared-cart.js, services/payment-cash-confirm.js, services/payment-stripe.js
      ownsMigrations:      false, // tables historiques, pas de migration dédiée trouvée dans migrations/
      externalSideEffect:  'none',
      surface:             'api+boutique',
    },
    rationale: [
      'possède ses propres tables (loyalty_rewards, loyalty_tiers) et un statut de récompense propre (pending/granted/skipped)',
      'scindé de wallet-loyalty (Lot O1, 2026-07-12) : ne partage ni tables (hors users, colonnes disjointes du wallet) ni cycle de vie avec le solde client',
    ],
  },

};
