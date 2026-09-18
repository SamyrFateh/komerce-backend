/**
 * @komerce-arch
 * @role          external-provider-contracts-feature-manifest
 * @domain        external-provider-contracts
 * @layer         manifest
 * @criticality   high
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 *
 * @feature       external-provider-contracts
 * @type          transversal
 * @status        staging
 * @owner         backend-core
 * @since         2026-09
 */
'use strict';

module.exports = {
  name:     'external-provider-contracts',
  type:     'transversal',
  domain:   'external-provider-contracts',
  status:   'staging',
  owner:    'backend-core',
  since:    '2026-09',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  classification: {
    axis:     'support',
    kind:     'technical-transversal',
    decision: 'transversal-technique',
    signals: {
      ownsTables:          false,
      ownsLifecycle:       false,
      activeService:       true,
      multiConsumer:       true,
      ownsMigrations:      false,
      externalSideEffect:  'none',
      surface:             'contract+proof',
    },
    rationale: [
      'le contrat EXPECTS/REQUIRES/SENDS/RECEIVES/CONFIRMS/EXPOSES et les étapes P0..P4 sont déjà implémentés par un moteur générique utilisé au-delà de la sémantique Purchasing',
      'la même autorité de preuve doit être consommée par plusieurs domaines (supplier, payment, messaging, logistics, identity, media, AI) sans déplacer leurs adapters ni leurs décisions métier hors de leurs features propriétaires',
      'aucune table, migration ou side effect provider n est possédé ici : la feature qualifie ce qui peut être cru, elle n exécute pas l opération métier externe',
    ],
  },

  service: 'Qualifier, prouver et publier ce que Komerce peut réellement croire d un système externe avant qu une feature métier ne s appuie sur son contrat.',

  perimeter: {
    in: [
      'contrat de conversation externe EXPECTS / REQUIRES / SENDS / RECEIVES / CONFIRMS / EXPOSES',
      'états de faits KNOWN / DERIVED / UNKNOWN',
      'preuves provider P0 Business readiness → P1 Raw API → P2 Adapter → P3 Pipeline → P4 Golden E2E',
      'règle fail-closed commune : une preuve absente, inconnue ou ambiguë ne devient jamais implicitement PASS',
      'inventaire et fiches de qualification des frontières API externes de Komerce',
    ],
    out: [
      'les adapters et clients provider spécifiques, qui restent dans la feature métier consommatrice (payments, notifications, catalog/purchasing, etc.)',
      'les credentials/secrets et leur cycle de rotation, qui restent dans l ownership technique ou métier approprié',
      'la décision métier consommant le fait externe : payer, commander, notifier, enrichir ou livrer reste propriété de sa feature',
      'les appels provider mutatifs eux-mêmes : cette feature prouve le contrat mais ne centralise pas les side effects externes',
    ],
  },

  docs: [
    'docs/doctrine/DOCTRINE_EXTERNAL_PROVIDER_CONTRACT_PROOFS.md',
    'docs/external-providers/EXTERNAL_PROVIDER_ANALYSIS_TEMPLATE.md',
    'docs/external-providers/EXTERNAL_PROVIDER_INVENTORY.md',
    'docs/chantier/EXTERNAL_PROVIDER_CONTRACTS_L0.md',
  ],

  files: {
    scripts: [
      'scripts/provider-contract-proof.js',
      'scripts/external-provider-boundary-scan.js',
      'scripts/stripe-provider-contract-proof.js',
      'scripts/ebay-sandbox-browse-proof.js',
    ],
    config: [
      'governance/external-provider-registry.json',
    ],
    tests: [
      'tests/unit/provider-contract-proof.test.js',
      'tests/unit/external-provider-boundary-scan.test.js',
      'tests/unit/stripe-provider-contract-proof.test.js',
      'tests/unit/ebay-sandbox-browse-proof.test.js',
    ],
  },

  db: {
    tables: [],
  },

  security: {
    status: 'CONFIRMED_INTERNAL',
    totalRoutes: 0,
    authedRoutesDetected: 0,
    note: 'Aucune route HTTP ni credential provider possédé. Le moteur ne persiste ni secret, ni payload personnel, ni preuve brute non bornée.',
  },

  contract: {
    exposes: [],
    internalApi: [
      { fn: 'buildConversation', file: 'scripts/provider-contract-proof.js' },
      { fn: 'buildProof', file: 'scripts/provider-contract-proof.js' },
      { fn: 'assertConversation', file: 'scripts/provider-contract-proof.js' },
      { fn: 'assertThrough', file: 'scripts/provider-contract-proof.js' },
      { fn: 'summary', file: 'scripts/provider-contract-proof.js' },
      { fn: 'scanRepository', file: 'scripts/external-provider-boundary-scan.js' },
      { fn: 'runStripeReadOnlyProof', file: 'scripts/stripe-provider-contract-proof.js' },
      { fn: 'runEbayBrowseReadOnlyProof', file: 'scripts/ebay-sandbox-browse-proof.js' },
    ],
    consumes: [
      'infrastructure — runtime Node et primitives techniques uniquement ; aucune vérité métier externe n est déléguée à infrastructure',
    ],
  },

  authority: 'backend-core — le vocabulaire KNOWN/DERIVED/UNKNOWN, le contrat de conversation, les étapes P0..P4 et les règles communes de preuve externe ne peuvent diverger par provider ou par feature consommatrice.',

  invariants: [
    'réalité avant abstraction : un contrat provider réel est lu avant de figer sa représentation canonique',
    'UNKNOWN ne devient jamais PASS, false ou capability supportée par défaut',
    'une requête externe acceptée ne vaut pas confirmation métier lorsqu un read-back ou une preuve provider est nécessaire',
    'une preuve Sandbox/staging ne satisfait jamais implicitement un contrat Production',
    'une correspondance externe ambiguë bloque : Komerce ne devine jamais une référence ou un état provider',
    'un Golden E2E prouve la composition de contrats élémentaires déjà qualifiés ; il ne sert jamais à découvrir P0/P1 à l aveugle',
    'les adapters provider et les side effects restent possédés par leurs features métier ; external-provider-contracts ne devient jamais un god-adapter',
  ],
};
