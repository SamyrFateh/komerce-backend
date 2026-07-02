/**
 * @feature       documents
 * @type          feature
 * @domain        documents
 * @status        production
 * @owner         backend-core
 * @since         2025-10
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 */
'use strict';

module.exports = {

  // ── Identite ─────────────────────────────────────────────────────────────
  name:     'documents',
  type:     'feature',   // feature | transversal
  domain:   'documents',
  status:   'production',   // draft | staging | production | deprecated
  owner:    'backend-core',
  since:    '2025-10',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  // ── Service rendu ────────────────────────────────────────────────────────
  service: 'Generer un document officiel (preuve de retrait, facture douane, reçu wallet, reçu remboursement) a partir d\'un evenement metier confirme.',

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'generation PDF/HTML de preuve de retrait, facture douane, reçu wallet, reçu remboursement',
    ],
    out: [
      'decision qu\'un document doit etre genere (reste a la feature source : orders, customs, wallet, refunds)',
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  files: {
    services: [
      'services/documents/pickup-proof.js',
      'services/documents/document-service.js',
      'services/documents/refund-receipt.js',
      'services/documents/customs-invoice.js',
      'services/documents/wallet-receipt.js',
    ],
    routes: [
      'routes/admin/documents.js',
    ],
    migrations: [
      'migrations/014_transaction_documents.sql',
      'migrations/023_invoices.sql',
      'migrations/074_invoice_public_token.sql',
      'migrations/083_transaction_documents.sql',
      'migrations/086_invoice_public_token.sql',
    ],
    utils: [
      'utils/documents/refund-receipt-html.js',
      'utils/documents/wallet-receipt-html.js',
      'utils/documents/pickup-proof-html.js',
      'utils/documents/customs-invoice-html.js',
      'utils/documents/logo-base64.js',
    ],
      tests: [
      'tests/unit/customs-invoice-html.test.js',
      'tests/unit/customs-invoice.test.js',
      'tests/unit/document-service.test.js',
      'tests/unit/documents.test.js',
      'tests/unit/logo-base64.test.js',
      'tests/unit/pickup-proof-html.test.js',
      'tests/unit/pickup-proof.test.js',
      'tests/unit/wallet-receipt-html.test.js',
      'tests/unit/wallet-receipt.test.js',
      'tests/unit/invoice-service.test.js',
    ],
  },

  // ── Contrat d'interface ──────────────────────────────────────────────────
  docs: [],

  contract: {
    exposes: [
      'fonctions internes generatePickupProof / generateCustomsInvoice / generateWalletReceipt / generateRefundReceipt',
      'GET /api/admin/documents (liste + filtres)',
      'GET /api/admin/documents/summary (diagnostic état émission)',
      'GET /api/admin/documents/:id (détail)',
      'GET /api/doc/:reference (rendu HTML imprimable — à câbler via routes/documents-html.js)',
    ],
    consumes: ['orders, customs, wallet, refunds (donnees source du document)',
      'auth',
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — tout changement de gabarit de document doit etre valide par le proprietaire de document-service.js',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    'un document genere est immuable une fois emis — toute correction passe par une nouvelle generation versionnee',
  ],

};
