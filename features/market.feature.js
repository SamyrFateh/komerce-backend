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
      'MarketContext navigation (contextuel, client, commutable, jamais autorisant) — M2',
      'requireMarketScope autorisation (serveur, enferme l\'opérateur, jamais le client) — M2',
    ],
    out: [
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
    note: 'M0/M1 ne câblent aucune route ni middleware — deux tables de ' +
      'référentiel et d\'historique d\'accès, zéro surface applicative. ' +
      'L\'autorisation arrive en M2 avec requireMarketScope, résolu côté ' +
      'serveur depuis operator_market_scopes, jamais depuis un market_id ' +
      'fourni par le client.',
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
  ],

};
