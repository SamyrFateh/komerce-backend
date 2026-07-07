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
      'customs_shipment_parcels: R',
      'customs_shipments: R',
      'invoices: R',
      'order_items: R',
      'orders: R',
      'parcel_items: R',
      'parcels: R',
      'products: R',
      'recipients: R',
      'refunds: R',
      'relais: R',
      'transaction_documents: RW',
      'users: R',
      'wallet_credit_lots: R',
      'wallet_transactions: R',
    ],
  },

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
  // ── Sécurité (constat factuel, audit 2026-07-06, §axe3) ─────────────────
  // AUCUN middleware d'authentification détecté sur les 3 routes de cette
  // feature (factures) ; aucune garde globale par défaut au niveau de
  // l'application. Priorité de vérification la plus haute des 3 features
  // signalées : ce sont des documents transactionnels (factures).
  // DÉCISION REQUISE DE L'OWNER, en urgence.
  security: {
    status: 'CONFIRMED_PROTECTED',
    authedRoutesDetected: 3,
    totalRoutes: 3,
    note: "Corrigé le 2026-07-06 (suite d'audit) : le constat initial (0/3, "
        + "détecteur texte) était un faux négatif — les 3 routes utilisent "
        + "`guard = [authenticate, requireRole([...])]` puis `...guard` en "
        + "spread, non reconnu par le premier détecteur. Reconfirmé via "
        + "scripts/gen-security-360.js : 3/3 routes classées PROTECTED, "
        + "0 flaggée.",
  },

  authority: 'backend-core — tout changement de gabarit de document doit etre valide par le proprietaire de document-service.js',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    'un document genere est immuable une fois emis — toute correction passe par une nouvelle generation versionnee',
  ],

};
