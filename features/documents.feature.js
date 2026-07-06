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
      'tests/unit/refund-receipt.test.js',
    ],
  },

  // ── Contrat d'interface ──────────────────────────────────────────────────
  docs: [
    'docs/doctrine/DOCTRINE_DOCUMENTS_TRANSACTIONNELS_KOMERCE.md',
  ],

  contract: {
    exposes: [
      'GET /api/admin/documents',
      'GET /api/admin/documents/summary',
      'GET /api/admin/documents/:id',
      // GET /api/doc/:reference — rendu HTML imprimable, pas encore câblé
      // (routes/documents-html.js n'existe pas sur ce checkout). Volontairement
      // absent de `exposes` tant que non implémenté, pour ne pas fausser le gate.
    ],
    consumes: ['orders, customs, wallet, refunds (donnees source du document)',
      'auth',
    ],
  },

  // Fonctions internes de génération (services/documents/*.js) — pas des
  // endpoints HTTP, donc hors de `contract.exposes` (que le gate interprete
  // comme des routes câblables). Noms réels post-refacto : `issue` partout,
  // `issueForShipment` en plus pour customs-invoice.js.
  internalApi: [
    'services/documents/pickup-proof.js: issue',
    'services/documents/customs-invoice.js: issue, issueForShipment',
    'services/documents/wallet-receipt.js: issue',
    'services/documents/refund-receipt.js: issue',
  ],

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — tout changement de gabarit de document doit etre valide par le proprietaire de document-service.js',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    'un document genere est immuable une fois emis — toute correction passe par une nouvelle generation versionnee',
  ],

};
