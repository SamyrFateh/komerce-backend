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
      'Sépare la décision humaine locale, l’autorisation économique et le cutover acheteur LOCAL_ACTIVE.',
    ],
  },

  service: 'Permettre à un responsable pays explicitement scopé manager de décider un prix local, ' +
    'd’en voir l’impact économique, puis de l’activer sans approbation centrale lorsque les gates ' +
    'autorisent la position ; LOCAL_ACTIVE devient alors la seule vérité locale consommable par le buyer path.',

  perimeter: {
    in: [
      'décision de prix commercial locale par market_id + product_id',
      'devise résolue exclusivement depuis le marché serveur',
      'audit append-only SET/RESET/AUTHORIZE/ACTIVATE de la décision locale',
      'preview économique CDR + couverture marché avant activation',
      'transition DRAFT_PENDING_GATE -> LOCAL_AUTHORIZED_PENDING_CUTOVER -> LOCAL_ACTIVE',
      'projection du prix LOCAL_ACTIVE vers le KMF canonique sans modifier products.price_kmf',
      'consommation LOCAL_ACTIVE par catalogue, liste partagée et checkout via boundary propriétaire',
      'refus fail-closed si une granularité SKU/variante explicite entrerait en conflit',
      'projection manager/viewer de la capacité réellement disponible',
      'surface Canonical de test de l’autonomie pays',
      'surface équipe pays intégrée : lecture, invitation, délégation et révocation de capabilities',
      'parcours explicite d’acceptation d’invitation avec retour vers le Market ID résolu côté serveur',
    ],
    out: [
      'mutation de products.price_kmf global',
      'validation humaine centrale de la stratégie commerciale pays',
      'création/activation d’un marché',
      'settlement et mouvements financiers',
      'rôles terrain implicites',
      'prix local par SKU — tant que cette granularité n’est pas modélisée explicitement',
    ],
  },

  files: {
    services: [
      'services/market-commercial-price-service.js',
      'services/market-local-price-resolution-service.js',
      'services/market-local-price-activation-service.js',
      'services/market-local-price-state-transition.js',
    ],
    migrations: [
      'migrations/170_market_commercial_price_drafts.sql',
    ],
    dash: [
      'dashboards/canonical/market-autonomy.html',
      'dashboards/canonical/js/market-autonomy.js',
      'dashboards/canonical/css/market-team.css',
      'dashboards/canonical/js/market-team.js',
      'dashboards/canonical/team-invite.html',
      'dashboards/canonical/js/team-invite.js',
    ],
    tests: [
      'tests/unit/market-commercial-price-service.test.js',
      'tests/unit/market-local-price-resolution-service.test.js',
      'tests/unit/market-local-price-activation-service.test.js',
      'tests/unit/market-delegation-team-ui.test.js',
      'tests/unit/canonical-admin-app.test.js',
    ],
  },

  db: {
    tables: [
      'currency_parities: R',
      'markets: R',
      'products: R',
      'product_skus: R',
      'product_variants: R',
      'product_market_price_drafts: RW!',
      'product_market_price_draft_events: W!',
    ],
  },

  security: {
    status: 'CONFIRMED_PROTECTED',
    authedRoutesDetected: 0,
    totalRoutes: 0,
    note: 'La feature compose ses actions dans Pricing Canonical après résolution market scope serveur. ' +
      'Preview est lisible dans le scope ; décision, reset et activation exigent market_operator + scope manager. ' +
      'La surface équipe consomme uniquement les routes market-delegation protégées et ne traite jamais un market_id navigateur comme autorité.',
  },

  contract: {
    exposes: [
      'GET /api/admin/workspaces/pricing/market/:marketCode/commercial-prices — lecture scopée',
      'GET /api/admin/workspaces/pricing/market/:marketCode/products/:productRef/local-price/activation-preview — preview économique scopée',
      'POST /api/admin/workspaces/pricing/market/:marketCode/products/:productRef/local-price — manager pays uniquement',
      'POST /api/admin/workspaces/pricing/market/:marketCode/products/:productRef/local-price/activate — manager pays uniquement',
      'POST /api/admin/workspaces/pricing/market/:marketCode/products/:productRef/local-price/reset — manager pays uniquement',
    ],
    consumes: [
      'market — référentiel markets, currency_parities et scope serveur operator_market_scopes',
      'economic-engine — CDR, politique marché et gate de couverture',
      'catalog — products/SKU en lecture ; le prix global reste inchangé',
      'infrastructure — db.js pour transaction et audit',
      'market-delegation — memberships, capabilities team.* et acceptation d’invitation ; l’UI n’invente aucune autorité',
      'auth-identity — création optionnelle d’un compte client depuis le lien d’invitation avant acceptation explicite',
    ],
  },

  authority: 'backend-core — la stratégie locale appartient au manager du marché ; le moteur économique ' +
    'peut refuser une activation destructive ou sous-couverte non autorisée, mais aucun admin central ' +
    'ne valide le choix commercial pays.',

  invariants: [
    { statement: 'une décision locale ne modifie jamais products.price_kmf', test: 'tests/unit/market-commercial-price-service.test.js' },
    { statement: 'la devise faisant foi vient du marché résolu côté serveur', test: 'tests/unit/market-local-price-resolution-service.test.js' },
    { statement: 'seul LOCAL_ACTIVE est buyer_effective et peut remplacer le prix global', test: 'tests/unit/market-local-price-resolution-service.test.js' },
    { statement: 'un prix destructif ne peut jamais être activé', test: 'tests/unit/market-local-price-activation-service.test.js' },
    { statement: 'un prix sous CDR exige ALLOW_NEW_UNDER_CDR_POSITION', test: 'tests/unit/market-local-price-activation-service.test.js' },
    { statement: 'un prix pays produit n’écrase jamais silencieusement un prix SKU/variante explicite', test: 'tests/unit/market-local-price-resolution-service.test.js' },
    { statement: 'SET RESET AUTHORIZE ACTIVATE sont auditables et scoped par market_id + product_id', test: 'tests/unit/market-commercial-price-service.test.js' },
    { statement: 'seul un market_operator manager peut persister ou activer une stratégie de prix locale', test: 'tests/unit/market-commercial-price-service.test.js' },
    { statement: 'une identité au rôle global non-admin ne peut entrer dans le portail comme market_operator qu’après projection serveur explicite', test: 'tests/unit/canonical-admin-app.test.js' },
    { statement: 'le lien d’invitation conserve next pendant le login, l’acceptation est explicite, puis le token est retiré et le marché vient du contexte serveur', test: 'tests/unit/market-delegation-team-ui.test.js' },
  ],
};
