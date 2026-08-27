/**
 * @feature       refunds
 * @type          feature
 * @domain        refunds
 * @status        production
 * @owner         backend-core
 * @since         2025-11
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 */
'use strict';

module.exports = {

  // ── Identite ─────────────────────────────────────────────────────────────
  name:     'refunds',
  type:     'feature',   // feature | transversal
  domain:   'refunds',
  status:   'production',   // draft | staging | production | deprecated
  owner:    'backend-core',
  since:    '2025-11',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  classification: {
    "axis": "business",
    "kind": "business-transversal",
    "decision": "feature-transverse",
    "signals": {
      "ownsTables": true,
      "ownsLifecycle": true,
      "activeService": true,
      "multiConsumer": true,
      "ownsMigrations": false,
      "externalSideEffect": "refund",
      "surface": "service"
    },
    "rationale": [
      "orchestre transversalement le remboursement entre paiement, wallet et documents tout en conservant la trace refunds du flux compensatoire",
      "ne constitue pas un domaine métier isolé : il coordonne les frontières propriétaires des features sources et garantit l idempotence par événement"
    ]
  },

  // ── Service rendu ────────────────────────────────────────────────────────
  service: 'Rembourser un client (wallet, cash, panier partage) de facon tracable et sans double remboursement.',

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'service de remboursement transverse et son orchestration',
    ],
    out: [
      'credit wallet lui-meme (feature wallet, consommee ici)',
      'reçu de remboursement document (feature documents, consommee ici)',
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  files: {
    utils: [
      'utils/refunds.js',
    ],
    services: [
      'services/refund-service.js',
    ],
    routes: [],
    tests: [
      // E2E fonctionnel Feature First — refunds est PROPRIETAIRE du scenario ;
      // orders, payments, wallet, catalog et logistics sont traversees.
      'tests/e2e-api/refunds.no-double-application.e2e.test.js',
      'tests/unit/refund-service.test.js',
      'tests/unit/refunds-util.test.js',
      'tests/unit/refund-receipt-html.test.js',
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
      'orders: R',
      'refunds: RW',
      'wallets: R',
    ],
  },

  security: {
    status: 'CONFIRMED_PROTECTED',
    authedRoutesDetected: 0,
    totalRoutes: 0,
    note: "Feature sans routes HTTP directes. Le remboursement est déclenché exclusivement via services internes (refund-service.js) appelés par d'autres features protégées (orders, payments). Aucune surface d'attaque externe.",
  },
  contract: {
    exposes: [],
    // Migré depuis exposes (audit 2026-07-06, lot UNPARSEABLE) : pas de route
    // HTTP propre — remboursement déclenché exclusivement par appel de
    // fonction interne depuis les features consommatrices (orders, shared-cart).
    internalApi: [
      'processRefund(orderOrCartId, reason)',
    ],
    consumes: [
      'infrastructure (dépendance technique transversale observée : DB, logger, helpers ou bootstrap possédés par infrastructure)',
      'orders (commande source)',
      'shared-cart (panier source)',
      'wallet (credit)',
      'documents (reçu)',
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — tout changement de logique de remboursement doit etre valide par le proprietaire de refund-service.js',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    'un remboursement n\'est jamais applique deux fois pour le meme evenement source',
    "tout refund externe ou crédit compensatoire est idempotent par événement source ; un rejeu ne déclenche jamais un second remboursement",
  ],

};
