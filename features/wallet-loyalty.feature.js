/**
 * @feature       wallet-loyalty
 * @type          feature
 * @domain        wallet
 * @status        production
 * @owner         backend-core
 * @since         2025-10
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 */
'use strict';

module.exports = {

  // ── Identite ─────────────────────────────────────────────────────────────
  name:     'wallet-loyalty',
  type:     'feature',   // feature | transversal
  domain:   'wallet',
  status:   'production',   // draft | staging | production | deprecated
  owner:    'backend-core',
  since:    '2025-10',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  // ── Service rendu ────────────────────────────────────────────────────────
  service: 'Tenir le solde wallet d\'un client et son programme de fidelite, avec application exactement une fois.',

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'solde wallet et historique de credit/debit',
      'programme de fidelite et ses recompenses',
      'store credits',
    ],
    out: [
      'paiement carte/PayPal (feature payments)',
      'remboursement initiateur (feature refunds, qui credite le wallet)',
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  files: {
    services: [
      'services/wallet-service.js',
      'services/loyalty-service.js',
      'utils/store-credits.js',
    ],
    routes: [
      'routes/wallet.js',
      'routes/loyalty.js',
    ],
    migrations: [
      'migrations/066_wallet_consumptions_append_only.sql',
      'migrations/068_wallets_check_balance.sql',
    ],
    boutique: [
      'js/b-wallet.js',
      'css/wallet.css',
    ],
    tests: [
      'tests/unit/wallet-service.test.js',
      // Rapatriés depuis features/wallet.feature.js (doublon supprimé,
      // audit 2026-07-06 §2c) — services/routes étaient déjà ici, seuls ces
      // tests et migrations traînaient encore dans l'ancien manifeste.
      'tests/unit/loyalty-notification.test.js',
      'tests/unit/loyalty-route.test.js',
      'tests/unit/loyalty-service.test.js',
      'tests/unit/store-credits.test.js',
      'tests/unit/wallet-route.test.js',
    ],
  },

  // ── Dépôts ───────────────────────────────────────────────────────────────
  repos: {
    backend: 'services/ + routes/ ci-dessus',
    boutique: 'js/b-wallet.js + css/wallet.css — dépôt "bout", voir docs/BOUTIQUE_OWNERSHIP_LIVE.md pour le détail DOM/CSS',
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
      'finance_config: R',
      'loyalty_rewards: RW',
      'loyalty_tiers: RW',
      'orders: RW',
      'users: RW',
      'wallet_consumptions: RW',
      'wallet_credit_lots: RW',
      'wallet_transactions: RW',
      'wallets: RW',
    ],
  },

  contract: {
    exposes: [
      'GET /api/wallet',
      'GET /api/wallet/transactions',
      'POST /api/wallet/apply',
      'POST /api/wallet/remove',
      'GET /api/wallet/admin',
      'GET /api/wallet/admin/:userId',
      'POST /api/wallet/admin/credit',
      'POST /api/wallet/admin/order-credit/:orderId',
      'POST /api/wallet/admin/reverse-lot',
      'GET /api/loyalty/tiers',
      'GET /api/loyalty/me',
      'GET /api/loyalty/users',
      'GET /api/loyalty/stats',
      'PUT /api/loyalty/tiers/:id',
      'POST /api/loyalty/recalculate/:user_id',
      'POST /api/loyalty/recalculate-all',
    ],
    consumes: [
      'auth-identity (identification du client)',
    ],
  },

  // ── Dette assumée / documentée ────────────────────────────────────────────
  // (audit 2026-07-06, §2b — vérifié empiriquement contre routes/wallet.js et
  // routes/loyalty.js)
  debt: {
    knownGaps: [
      { gap: 'ancien contrat déclaré "GET /api/wallet/:userId", "POST /api/wallet/:userId/credit", ' +
             '"GET /api/loyalty/:userId" (ressource dans le chemin) : aucune route ne sert ' +
             'ce style. Le solde self-service se lit par session (GET /api/wallet, pas de ' +
             ':userId), et le crédit admin est un sous-espace /admin/... avec :userId ou ' +
             ':orderId selon l\'action, jamais un simple crédit générique par utilisateur.',
        risk: 'si un consommateur externe (dashboard legacy, script) construisait encore ' +
              'des URLs /api/wallet/<id> ou /api/wallet/<id>/credit, il reçoit un 404 — ' +
              'confirmé sans dépendance connue au moment de cette correction, à revalider ' +
              'si un incident apparaît.',
      },
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — tout changement de calcul de solde doit etre valide par le proprietaire de wallet-service.js',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    'application wallet une seule fois par evenement source',
    'solde jamais negatif sans flag explicite admin',
  ],

};
