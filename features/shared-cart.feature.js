/**
 * @feature       shared-cart
 * @domain        panier-partage
 * @status        production
 * @owner         backend-core
 * @since         2026-03
 * @doctrine      docs/doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 */
'use strict';

module.exports = {

  // ── Identité ─────────────────────────────────────────────────────────────
  name:     'shared-cart',
  type:     'feature',   // feature | transversal
  domain:   'panier-partage',
  status:   'production',   // draft | staging | production | deprecated
  owner:    'backend-core',
  since:    '2026-03',
  doctrine: 'docs/doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md',

  // ── Service rendu ──────────────────────────────────────────────────────────
  service: 'Permettre à plusieurs participants de composer et financer un panier ' +
           'commun, de la création à la commande finale.',

  // ── Périmètre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'création, contribution, clôture, annulation du panier partagé',
      'estimation et garde financière du panier (financial guard)',
      'transitions d\'état v4/v4.1 et réparation des réservations stock collectives',
    ],
    out: [
      'paiement carte/PayPal lui-même (feature payments)',
      'création de la commande finale (feature orders, consommée en sortie)',
      'crédit wallet (feature wallet-loyalty, consommée en sortie)',
    ],
  },

  // ── Autorité ─────────────────────────────────────────────────────────────
  authority: 'backend-core — tout changement de machine d\'état v4/v4.1 doit être ' +
             'validé par le propriétaire de shared-cart-engine.js',

  // ── Périmètre fichiers ────────────────────────────────────────────────────
  files: {
    services: [
      'services/shared-cart-engine.js',
      'services/shared-cart-financial-guard.js',
      'services/shared-cart-queries.js',
      'services/shared-cart-items-service.js',
      'services/shared-cart-cash-service.js',
      'services/shared-cart-commitment-service.js',
      'services/shared-cart-estimation-service.js',
      'services/shared-cart-refund-queue.js',
      'services/shared-cart-v4-settlement.js',
      'services/shared-cart-v41-transitions.js',
      'services/cancel-shared-cart-with-refunds.js',
    ],
    routes: [
      'routes/shared-cart.js',
      'routes/shared-cart-cash.js',
      'routes/shared-cart-from-order.js',
      'routes/shared-cart-refund-admin.js',
    ],
    migrations: [
      'migrations/044_shared_cart.sql',
      'migrations/059_group_order.sql',
      'migrations/071b_shared_cart_commitments.sql',
      'migrations/073_shared_cart_cash_contributions.sql',
      'migrations/073a_shared_cart_cash_contributions.sql',
      'migrations/073b_shared_cart_cash_contributions.sql',
      'migrations/080_v41_shared_cart_state_machine.sql',
      'migrations/085_shared_cart_cash_contributions.sql',
    ],
    tests: [
      'tests/unit/shared-cart-v4.test.js',
      'tests/unit/shared-cart-v41-transitions.test.js',
      'tests/unit/shared-cart-lifecycle.test.js',
      'tests/unit/shared-cart-financial-guard.test.js',
      'tests/unit/shared-cart-queries.test.js',
      'tests/unit/shared-cart-refund-queue.test.js',
      'tests/unit/cancel-shared-cart-with-refunds.test.js',
      'tests/unit/shared-cart-edit-mode.test.js',
      'tests/unit/shared-cart-lot9-business.test.js',
      'tests/unit/shared-cart-v4-2-creation.test.js',
      'tests/unit/shared-cart-v41-reconciliation.test.js',
    ],
    boutique: [
      'js/b-group-cart-flow.js',
      'js/b-share-cart.js',
      'js/b-group-view.js',
      'js/b-group-banner.js',
      'js/b-friendly-group-redirect.js',
      'js/b-share-phone-guard.js',
      'css/group-cart-flow.css',
      'css/share-cart.css',
      'css/hero-cart-proxy.css',
      'css/shared-followup.css',
    ],
  },

  // ── Dépôts ───────────────────────────────────────────────────────────────
  // Cette feature est répartie sur 2 dépôts distincts (pas un monorepo) :
  repos: {
    backend: 'services/ + routes/ ci-dessus',
    boutique: 'js/ + css/ ci-dessus — dépôt "bout", gouverné en détail par ' +
              'docs/BOUTIQUE_COMPONENT_OWNERSHIP.md et docs/BOUTIQUE_OWNERSHIP_LIVE.md ' +
              '(auto-généré par scripts/gen-ownership.js du dépôt bout — source de vérité ' +
              'pour le détail CSS/DOM, ne pas dupliquer ici)',
  },

  // ── Contrat d'interface ───────────────────────────────────────────────────
  contract: {
    exposes: [
      'POST   /api/shared-carts',
      'GET    /api/shared-carts/:id',
      'POST   /api/shared-carts/:id/contribute',
      'POST   /api/shared-carts/:id/close',
      'POST   /api/shared-carts/:id/cancel',
      'GET    /api/shared-carts/:id/estimation',
      'POST   /api/shared-carts/cash/:id/contribute',
      'POST   /api/shared-carts/refund-admin/:id',
    ],
    consumes: [
      'orders',        // domaine propriétaire : order-status-machine
      'wallet',        // domaine propriétaire : wallet-service
      'products',      // lecture seule
      'notifications', // émission uniquement
    ],
  },

  // ── Invariants propres ────────────────────────────────────────────────────
  // Complémentaires aux invariants globaux de ZONE_IMPACT.md (I-01..I-10).
  invariants: [
    'snapshot figé après 1ère contribution payée',
    'idempotence webhook Stripe sur shared_cart_contributions',
    'fenêtre paiement 48h — aucune extension sans machine de statut',
    'annulation restores wallet si contribution confirmée',
    'lien partagé ouvre une boutique — jamais un guichet (Boutique First)',
    'participant consulte en lecture seule — règle sa part seulement si panier payable',
  ],

};
