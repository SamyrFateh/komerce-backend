/**
 * @komerce-arch
 * @role          supplier-connectivity-feature-manifest
 * @domain        supplier-connectivity
 * @layer         manifest
 * @criticality   high
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 *
 * @feature       supplier-connectivity
 * @type          feature
 * @status        staging
 * @owner         backend-core
 * @since         2026-09
 */
'use strict';

module.exports = {
  name:     'supplier-connectivity',
  type:     'feature',
  domain:   'supplier-connectivity',
  status:   'staging',
  owner:    'backend-core',
  since:    '2026-09',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  classification: {
    axis:     'support',
    kind:     'integration-adapter',
    decision: 'adapter-externe',
    signals: {
      ownsTables:          false,
      ownsLifecycle:       false,
      activeService:       true,
      multiConsumer:       true,
      ownsMigrations:      false,
      externalSideEffect:  'none',
      surface:             'internal-contract',
    },
    rationale: [
      'l identité provider, la Supplier Order Identity et le contrat de résolution d adapter constituent une autorité unique consommable par Sourcing, Catalogue et Purchasing',
      'la feature est un gateway d autorité, jamais une étape linéaire du pipeline ni le propriétaire du cycle de vie des Purchase Orders',
      'aucune table supplier_providers n est inventée : l autorité reste code tant qu un besoin de métadonnées persistées n est pas prouvé',
      'les adapters concrets et leurs side effects restent dans leur feature métier consommatrice afin d éviter un god-adapter et des dépendances cycliques',
    ],
  },

  service: 'Permettre à Komerce d accueillir un fournisseur par une autorité unique d identité provider, une Supplier Order Identity opaque et une résolution d adapter fail-closed, sans déplacer les décisions métier des features consommatrices.',

  perimeter: {
    in: [
      'autorité canonique des providers supportés et séparation stricte provider identity / execution mode',
      'Supplier Order Identity canonique {provider, version, payload opaque}',
      'contrat générique de validation des adapters fulfillment et reconciliation, provider-scopé et fail-closed',
      'déclaration en code des seules exigences de preflight et de reconciliation déjà prouvées',
    ],
    out: [
      'cycle de vie, persistence, readiness, exécution, confirmation et réception des Purchase Orders — feature purchasing',
      'connecteurs d import catalogue et normalisation produit fournisseur — feature catalog',
      'qualification et résolution des observations multi-source — feature sourcing',
      'mécanisme de discovery d une référence externe — adapter-owned et provider-specific',
      'adapters concrets et appels provider mutatifs — propriété de la feature métier consommatrice',
      'credentials, secrets, rotation de tokens et connexion provider',
    ],
  },

  docs: [
    'docs/doctrine/DOCTRINE_SUPPLIER_ORDER_IDENTITY.md',
    'docs/doctrine/DOCTRINE_PROCUREMENT_FULFILLMENT.md',
    'docs/gaps/GAP_SUPPLIER_CONNECTIVITY_ALIGNMENT.md',
  ],

  files: {
    services: [
      'services/suppliers/provider-authority.js',
      'services/suppliers/supplier-order-identity.js',
      'services/suppliers/supplier-fulfillment-adapter-contract.js',
    ],
    tests: [
      'tests/unit/provider-authority.test.js',
      'tests/unit/supplier-order-identity.test.js',
      'tests/unit/supplier-fulfillment-adapter-contract.test.js',
    ],
  },

  db: { tables: [] },

  security: {
    status: 'CONFIRMED_INTERNAL',
    totalRoutes: 0,
    authedRoutesDetected: 0,
    note: 'Aucune route HTTP, table, credential ou secret possédé ; les side effects restent derrière les adapters des features métier consommatrices.',
  },

  contract: {
    exposes: [],
    internalApi: [
      { fn: 'isSupportedProvider', file: 'services/suppliers/provider-authority.js' },
      { fn: 'normalizeProviderCode', file: 'services/suppliers/provider-authority.js' },
      { fn: 'remotePreflightRequirement', file: 'services/suppliers/provider-authority.js' },
      { fn: 'reconciliationRequirement', file: 'services/suppliers/provider-authority.js' },
      { fn: 'normalizeIdentity', file: 'services/suppliers/supplier-order-identity.js' },
      { fn: 'identitiesMatch', file: 'services/suppliers/supplier-order-identity.js' },
      { fn: 'resolveSupplierUnit', file: 'services/suppliers/supplier-order-identity.js' },
      { fn: 'validateAdapter', file: 'services/suppliers/supplier-fulfillment-adapter-contract.js' },
      { fn: 'validateExecutionAdapter', file: 'services/suppliers/supplier-fulfillment-adapter-contract.js' },
      { fn: 'validateReconciliationAdapter', file: 'services/suppliers/supplier-fulfillment-adapter-contract.js' },
    ],
    consumes: [
      'external-provider-contracts (méthode transverse de qualification et de preuve P0→P4 avant déclaration d une capability provider)',
    ],
  },

  authority: 'backend-core — cette feature est la seule autorité de l identité provider supportée, de la Supplier Order Identity opaque et du contrat générique de résolution d adapter ; les features consommatrices restent seules propriétaires de leurs décisions et side effects métier.',

  debt: {
    knownGaps: [
      { gap: 'Le déplacement structurel de environment hors du payload SOI reste différé jusqu au provider #2 ou à la première PO Production.',
        risk: 'faible à court terme : la frontière de confirmation impose déjà la comparaison fail-closed de l environnement attendu et observé.' },
      { gap: 'Sourcing et Catalogue consomment le contrat SOI mais leur dispatch connecteur ne consomme pas encore provider-authority comme autorité d activation.',
        risk: 'aucun fall-through Purchasing ; l alignement sera forcé par un second provider réel plutôt que par une abstraction anticipée.' },
      { gap: 'La taxonomie de capabilities reste limitée aux exigences réellement prouvées ; aucune capability invoice, tracking ou cancellation n est déclarée par anticipation.',
        risk: 'choix fail-closed intentionnel, à étendre uniquement avec une preuve provider.' },
    ],
  },

  invariants: [
    { statement: 'un provider inconnu ou un adapter absent/incompatible bloque ; il n existe aucun fall-through silencieux',
      test: 'tests/unit/supplier-fulfillment-adapter-contract.test.js' },
    { statement: 'provider identity et execution mode sont deux dimensions distinctes ; manual et automatic ne sont jamais des providers',
      test: 'tests/unit/provider-authority.test.js' },
    { statement: 'seules les exigences provider prouvées sont déclarées ; une valeur inconnue reste UNKNOWN et ne devient jamais NOT_REQUIRED par défaut',
      test: 'tests/unit/provider-authority.test.js' },
    { statement: 'la Supplier Order Identity conserve un payload opaque et se résout sans heuristique ; une identité absente ou ambiguë bloque',
      test: 'tests/unit/supplier-order-identity.test.js' },
    { statement: 'une comparaison de Supplier Order Identity est structurelle et indépendante de l ordre des clés du payload',
      test: 'tests/unit/supplier-order-identity.test.js' },
    'Purchasing, Sourcing et Catalogue ne doivent jamais brancher leur cœur sur un nom de provider ni parser le payload SOI pour inventer une décision générique',
    'aucune table supplier_providers ni capability non prouvée ne peut être ajoutée au seul motif d accueillir un futur provider hypothétique',
  ],
};
