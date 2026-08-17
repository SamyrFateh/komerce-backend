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

  classification: {
    axis:     'business',
    kind:     'business-transversal',
    decision: 'feature-transverse',
    signals: {
      ownsTables:          true,  // invoices, transaction_documents
      ownsLifecycle:       true,  // pending -> available | error, immutabilité après émission
      activeService:       true,
      multiConsumer:       true,  // orders, payments, refunds, wallet, account
      ownsMigrations:      true,
      externalSideEffect:  'file-generation',
      surface:             'api+service',
    },
    rationale: [
      'possède la vérité documentaire et son cycle de vie, jamais les événements métier sources',
      'sert plusieurs features sans se rattacher exclusivement à orders, refunds ou wallet',
      'génère des PDF privés et contrôle leur accès authentifié',
    ],
  },

  // ── Service rendu ────────────────────────────────────────────────────────
  service: 'Generer et conserver un PDF officiel privé (facture, remboursement, wallet, retrait, douane) après événement confirmé ; exposer au client authentifié uniquement ses factures et remboursements essentiels.',

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'generation PDF privée de facture, preuve de retrait, facture douane, reçu wallet et reçu remboursement',
      'liste et téléchargement client authentifiés des factures et remboursements dans Mon Komerce et la commande concernée',
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
      'services/documents/pdf-renderer.js',
      'services/invoice-service.js',
    ],
    routes: [
      'routes/admin/documents.js',
      'routes/documents.js',
      'routes/invoices.js',
    ],
    migrations: [
      'migrations/014_transaction_documents.sql',
      'migrations/023_invoices.sql',
      'migrations/074_invoice_public_token.sql',
      'migrations/083_transaction_documents.sql',
      'migrations/086_invoice_public_token.sql',
      'migrations/131_private_client_documents.sql',
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
      'tests/unit/invoice-service.test.js',
      'tests/unit/invoices-route.test.js',
      'tests/unit/documents-route.test.js',
      'tests/unit/pdf-renderer.test.js',
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
      'invoices: RW',
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
      'wallet_transactions: R',
      'wallets: R',
    ],
  },

  contract: {
    exposes: [
      'GET /api/admin/documents',
      'GET /api/admin/documents/summary',
      'GET /api/admin/documents/:id',
      'GET /api/auth/me/documents',
      'GET /api/auth/me/documents/:id/download',
      'GET /api/invoices',
      'GET /api/invoices/:orderId',
      'GET /api/invoices/:orderId/json',
      'GET /api/invoices/:orderId/download',
      // GET /api/doc/:reference — rendu HTML imprimable, pas encore câblé
      // (routes/documents-html.js n'existe pas sur ce checkout). Volontairement
      // absent de `exposes` tant que non implémenté, pour ne pas fausser le gate.
    ],
    consumes: [
      'auth (gardes authenticate/requireAdmin sur les routes documents et factures)',
      'infrastructure (dépendance technique transversale observée : DB, logger, helpers ou bootstrap possédés par infrastructure)',
      'orders',
      'customs',
      'wallet',
      'refunds',
      'auth-identity',
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
    'services/invoice-service.js: getOrCreateInvoice, issueInvoice, ensurePdf',
  ],

  // ── Autorite ─────────────────────────────────────────────────────────────
  // ── Sécurité ─────────────────────────────────────────────────────────────
  // Les surfaces admin, facture historique et Mon Komerce sont toutes
  // authentifiées. Les téléchargements client filtrent en plus le propriétaire
  // et répondent 404 pour un document absent comme pour un document étranger.
  security: {
    status: 'CONFIRMED_PROTECTED',
    authedRoutesDetected: 9,
    totalRoutes: 9,
    note: '3 routes admin, 4 routes facture historiques et 2 routes Mon Komerce sont protégées ; aucune route publique de document ne subsiste.',
  },

  authority: 'backend-core — tout changement de gabarit de document doit etre valide par le proprietaire de document-service.js',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    'un document genere est immuable une fois emis — toute correction passe par une nouvelle generation versionnee',
    'aucun document ni lien documentaire n\'est envoyé par WhatsApp',
    'tout téléchargement client exige une session et filtre par owner_user_id',
    'la projection client ne liste que les factures et reçus de remboursement ; les autres documents restent internes ou administratifs',
    'une URL de téléchargement client n\'est exposée que lorsque le PDF existe et est disponible',
    'le PDF disponible possède une empreinte SHA-256 et ne peut pas être remplacé',
    'le PDF de facture est dérivé du HTML canonique qui embarque le vrai logo Komerce et porte une template_version dédiée',
  ],

};
