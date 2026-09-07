/**
 * @feature       market-autonomy
 * @type          feature
 * @domain        market-autonomy
 * @status        staging
 * @owner         backend-core
 * @since         2026-09
 * @doctrine      docs/doctrine/DOCTRINE_AUTONOMIE_RESPONSABLE_PAYS.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 */
'use strict';

module.exports = {
  name: 'market-autonomy',
  nature: 'feature',
  type: 'feature',
  domain: 'market-autonomy',
  status: 'staging',
  owner: 'backend-core',
  since: '2026-09',
  doctrine: 'docs/doctrine/DOCTRINE_AUTONOMIE_RESPONSABLE_PAYS.md',

  classification: {
    axis: 'business',
    kind: 'business-feature',
    rationale: [
      'Porte les décisions commerciales locales déléguées au responsable pays sans étendre silencieusement le référentiel Market.',
      'Sépare la décision locale du prix catalogue global et de l’autorité économique d’activation.',
    ],
  },

  service: 'Permettre à un responsable pays explicitement scopé manager de décider et auditer ' +
    'un prix commercial dans la devise de son marché, sans modifier products.price_kmf ni rendre ' +
    'ce brouillon consommable par le parcours acheteur avant passage des gates économiques.',

  perimeter: {
    in: [
      'décision de prix commercial locale par market_id + product_id',
      'devise résolue exclusivement depuis le marché serveur',
      'audit append-only SET/RESET de la décision locale',
      'projection manager/viewer de la capacité réellement disponible',
      'surface Canonical de test de l’autonomie pays',
      'état DRAFT_PENDING_GATE distinct de tout prix acheteur actif',
    ],
    out: [
      'mutation de products.price_kmf global',
      'activation catalogue/panier/commande avant branchement du gate de couverture marché',
      'validation humaine centrale de la stratégie commerciale pays',
      'création/activation d’un marché',
      'settlement et mouvements financiers',
      'rôles terrain implicites',
    ],
  },

  files: {
    services: [
      'services/market-commercial-price-service.js',
    ],
    migrations: [
      'migrations/168_market_commercial_price_drafts.sql',
    ],
    dash: [
      'dashboards/canonical/market-autonomy.html',
      'dashboards/canonical/js/market-autonomy.js',
    ],
    tests: [
      'tests/unit/market-commercial-price-service.test.js',
    ],
  },

  db: {
    tables: [
      'markets: R',
      'products: R',
      'product_market_price_drafts: RW!',
      'product_market_price_draft_events: W!',
    ],
  },

  security: {
    status: 'CONFIRMED_PROTECTED',
    authedRoutesDetected: 0,
    totalRoutes: 0,
    note: 'La feature ne possède pas un routeur autonome : ses actions sont composées dans Pricing Canonical, ' +
      'après résolution market scope serveur. Les mutations de prix local exigent market_operator + scope manager.',
  },

  contract: {
    exposes: [
      'GET /api/admin/workspaces/pricing/market/:marketCode/commercial-prices — lecture scopée',
      'POST /api/admin/workspaces/pricing/market/:marketCode/products/:productRef/local-price — manager pays uniquement',
      'POST /api/admin/workspaces/pricing/market/:marketCode/products/:productRef/local-price/reset — manager pays uniquement',
    ],
    consumes: [
      'market — référentiel markets et scope serveur operator_market_scopes',
      'economic-engine — Pricing Canonical comme composition root et futur gate d’activation',
      'catalog — products en lecture ; le prix global reste inchangé',
      'infrastructure — db.js pour transaction et audit',
    ],
  },

  authority: 'backend-core — la stratégie locale appartient au manager du marché ; le moteur économique ' +
    'gouverne l’activation, et le central conserve uniquement les règles communes et le hors-périmètre.',

  invariants: [
    { statement: 'une décision locale ne modifie jamais products.price_kmf', test: 'tests/unit/market-commercial-price-service.test.js' },
    { statement: 'la devise faisant foi vient du marché résolu côté serveur', test: 'tests/unit/market-commercial-price-service.test.js' },
    { statement: 'un brouillon local reste buyer_effective=false tant que le gate d’activation n’est pas branché', test: 'tests/unit/market-commercial-price-service.test.js' },
    { statement: 'SET et RESET sont auditables et scoped par market_id + product_id', test: 'tests/unit/market-commercial-price-service.test.js' },
    { statement: 'seul un market_operator manager peut persister une stratégie de prix locale', test: 'tests/unit/market-commercial-price-service.test.js' },
  ],
};
