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

  // ── Service rendu ────────────────────────────────────────────────────────
  service: 'Rembourser un client (wallet, cash, panier partage) de facon tracable et sans double remboursement.',

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'service de remboursement transverse et son orchestration',
    ],
    out: [
      'credit wallet lui-meme (feature wallet-loyalty, consommee ici)',
      'reçu de remboursement document (feature documents, consommee ici)',
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  files: {
    services: [
      'services/refund-service.js',
    ],
    routes: [],
  },

  // ── Contrat d'interface ──────────────────────────────────────────────────
  contract: {
    exposes: [
      'fonction interne processRefund(orderOrCartId, reason)',
    ],
    consumes: [
      'orders (commande source)',
      'shared-cart (panier source)',
      'wallet-loyalty (credit)',
      'documents (reçu)',
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — tout changement de logique de remboursement doit etre valide par le proprietaire de refund-service.js',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    'un remboursement n\'est jamais applique deux fois pour le meme evenement source',
  ],

};
