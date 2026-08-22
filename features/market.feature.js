/**
 * @feature       market
 * @type          feature
 * @domain        market
 * @status        draft
 * @owner         backend-core
 * @since         2026-08
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 */
'use strict';

module.exports = {

  // ── Identite ─────────────────────────────────────────────────────────────
  name:     'market',
  type:     'feature',   // feature | transversal
  domain:   'market',
  status:   'draft',   // draft | staging | production | deprecated
  owner:    'backend-core',
  since:    '2026-08',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  // ── Service rendu ────────────────────────────────────────────────────────
  service: 'Porter le référentiel des marchés ouverts (pays, devise) et ' +
    'l\'historique d\'accès des opérateurs à un marché — jamais le settlement ' +
    'ni l\'attribution économique, qui restent une primitive séparée et différée.',

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'référentiel markets (code pays, devise, minor_unit) — M0',
      'historique d\'accès operator_market_scopes (grain user, jamais settlement) — M1',
      'scoping market_id sur relais et orders (snapshot résolu du relais) — M1b/M1c',
      'requireMarketScope autorisation (serveur, enferme l\'opérateur, jamais le client) — M2',
      'garde Joi forbidMarketId + gate scripts/check-no-market-id-mutation.js — M2',
    ],
    out: [
      'MarketContext navigation acheteur — déjà livré côté boutique ' +
        '(public/boutique/js/market-context.js, chantier hero H2/H3), ' +
        'contextuel et commutable, jamais lu par requireMarketScope',
      'branchement de requireMarketScope sur une route concrète — aucune route ' +
        'admin scopée par marché n\'existe encore dans ce dépôt ; le middleware ' +
        'est livré et testé, pas encore consommé',
      'settlement et attribution économique par opérateur (entité différée, hors périmètre)',
      'corridor framework (relation traversant les scopes, pas un axe d\'ownership, hors périmètre)',
      'wallet multi-market (hors périmètre)',
      'product_market_offer (déclencheur = 1er marchand local, pas divergence de prix, hors périmètre)',
      'formatage devise affiché (feature economic-engine / boundary devise M5, qui consomme minor_unit)',
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  files: {
    migrations: [
      'migrations/135_markets_foundation.sql',
      'migrations/136_operator_market_scopes.sql',
      'migrations/137_relais_market_id.sql',
      'migrations/138_orders_market_id.sql',
    ],
    services: [
      'middleware/require-market-scope.js',
    ],
    tests: [
      'tests/unit/require-market-scope.test.js',
      'tests/integration/market-scope-isolation.test.js',
    ],
  },

  // ── Securite ─────────────────────────────────────────────────────────────
  // M0 et M1 sont des lots purs DB : aucune route, aucun middleware. Le
  // champ est posé à son état réel (zéro surface) plutôt qu'omis, pour que
  // le prochain lot applicatif (M2, requireMarketScope) ait une base à
  // mettre à jour au lieu d'ajouter le champ après coup.
  security: {
    status: 'CONFIRMED_PROTECTED',
    authedRoutesDetected: 0,
    totalRoutes: 0,
    note: 'M0/M1 ne câblent aucune route. M2 livre requireMarketScope ' +
      '(middleware/require-market-scope.js), résolu côté serveur depuis ' +
      'operator_market_scopes, jamais depuis un market_id fourni par le ' +
      'client — testé (12 tests unitaires mockés + 10 tests d\'intégration ' +
      'contre un vrai Postgres), mais 0 route ne le consomme encore : ' +
      'aucune route admin scopée par marché n\'existe dans ce dépôt à ce ' +
      'jour. Le champ reste à 0/0 tant qu\'aucune route ne branche le ' +
      'middleware — brancher sans route réelle serait une fausse déclaration.',
  },

  // ── Contrat ──────────────────────────────────────────────────────────────
  contract: {
    exposes: [], // aucune route encore câblée — requireMarketScope est livré (M2) mais non consommé
    consumes: [
      'infrastructure (db.js — pool de connexion Postgres, seule dépendance ' +
        'de middleware/require-market-scope.js)',
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — doctrine gelée dans KOMERCE_MARKET_LAYER_FREEZE.md ' +
    '(2026-08-19, READY TO FREEZE). Toute extension du périmètre (settlement, ' +
    'corridor framework, entité opérateur) exige un nouveau freeze, pas une ' +
    'extension silencieuse de ce manifeste.',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    'markets est un référentiel pur — aucune colonne ni logique d\'autorisation n\'y est ajoutée',
    'ouvrir un marché est un INSERT dans une migration, jamais un ALTER TABLE',
    'operator_market_scopes (M1) = historique d\'accès grain user, jamais source du settlement (grain organisation, différé)',
    'révocation d\'un scope = UPDATE revoked_at, jamais DELETE — l\'historique d\'accès n\'est pas reconstructible sinon',
    'MarketContext (parcours acheteur) est un contexte client commutable, jamais une autorisation',
    'requireMarketScope (M2) est résolu serveur depuis operator_market_scopes, jamais depuis un market_id fourni par le client',
    'relais.market_id (M1b) est NOT NULL — un relais est un lieu physique, il ne peut pas exister sans marché',
    'orders.market_id (M1c) est un SNAPSHOT résolu du relais au moment de la commande, jamais une FK vivante re-synchronisée',
    'orders.relais_id est NOT NULL dans le schéma (vérifié par exécution réelle, pas supposé) — aucune commande sans relais n\'est possible, le backfill orders.market_id est donc total par construction',
    'toute migration de market qui touche une table possédée par une autre feature (ex: relais, logistics ; orders) ajoute une colonne ou un index, jamais une règle métier de cette autre feature',
    'forbidMarketId (validators/index.js) échoue fort (400, message explicite) plutôt que de compter sur stripUnknown pour retirer market_id silencieusement d\'un payload client',
    'scripts/check-no-market-id-mutation.js est un gate, pas une convention documentée : un market_id mutable non gardé dans validators/*.js fait échouer la CI',
  ],

};
