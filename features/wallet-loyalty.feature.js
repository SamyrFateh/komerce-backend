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
    boutique: [
      'js/b-wallet.js',
      'css/wallet.css',
    ],
  },

  // ── Dépôts ───────────────────────────────────────────────────────────────
  repos: {
    backend: 'services/ + routes/ ci-dessus',
    boutique: 'js/b-wallet.js + css/wallet.css — dépôt "bout", voir docs/BOUTIQUE_OWNERSHIP_LIVE.md pour le détail DOM/CSS',
  },

  // ── Contrat d'interface ──────────────────────────────────────────────────
  contract: {
    exposes: [
      'GET /api/wallet/:userId',
      'POST /api/wallet/:userId/credit',
      'GET /api/loyalty/:userId',
    ],
    consumes: [
      'auth-identity (identification du client)',
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
