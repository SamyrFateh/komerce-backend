/**
 * @feature       market
 * @type          feature
 * @domain        market
 * @status        production
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
  status:   'production',   // draft | staging | production | deprecated
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
      'consommation runtime de requireMarketScope par les surfaces admin canoniques scopées par marché (Dashboard, Order 360, Client, Pricing, Opérations, Finance et Expéditions/Douane)',
      'garde Joi forbidMarketId + gate scripts/check-no-market-id-mutation.js — M2',
      'boundary devise utils/currency.js (formatage minor_unit-aware, lookup markets avec cache 5 min) — M5',
      'parités fixes currency_parities, projection via EUR reference (jamais un axe direct entre devises Zone franc) — P1',
      'adapter client fmt/fmtPrice (public/boutique/js/b-utils.js), consomme currency_parities via ' +
        '/api/public/config, projette vers le marché courant (market-context.js, override ?market= inclus) — P2',
      'snapshot display_total_amount/display_currency (orders, services/order-display-snapshot.js) — ' +
        'troisième vérité, distincte de total_kmf/total_eur (Payment Boundary, finance_config, jamais touchée) ' +
        'et de currency_parities seule — P3, freeze 22-08-2026',
      'ouverture Mayotte (YT, EUR, minor_unit=2) — M10, premier marché après le seed KM',
    ],
    out: [
      'MarketContext navigation acheteur — déjà livré côté boutique ' +
        '(public/boutique/js/market-context.js, chantier hero H2/H3), ' +
        'contextuel et commutable, jamais lu par requireMarketScope',
      'migration des 94 colonnes *_kmf existantes vers utils/currency.js — M5 livre ' +
        'l\'outil de formatage, ne touche à aucune colonne ni aucun appelant existant ; ' +
        'renommer une colonne de montant en prod est un chantier séparé, à fort risque',
      'conversion d\'affichage KMF\u2192EUR diaspora (public/boutique/js/b-utils.js#fmt(), ' +
        'taux de change détecté par fuseau horaire) — mécanisme distinct, non remplacé ' +
        'par la boundary devise (qui porte la devise RÉELLE d\'un marché, pas une conversion). ' +
        'b-utils.js devient un ADAPTER de cette boundary en P2, jamais l\'inverse',
      'P4/P5 — documents contractuels lisant le snapshot P3, dashboards agrégation cross-market ' +
        'en EUR reference — non faits, dépendent de P3/P2 respectivement',
      'devises de sourcing flottantes (USD/AED/CNY) — concern séparé par construction ' +
        '(freeze invariant 4/5), currency_parities ne les contient jamais',
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
      'migrations/139_market_open_mayotte.sql',
      'migrations/140_market_open_cameroon.sql',
      'migrations/141_market_open_congo.sql',
      'migrations/142_currency_parities.sql',
      'migrations/143_orders_display_snapshot.sql',
    ],
    services: [
      'middleware/require-market-scope.js',
      'services/market-scope-admin-service.js',
      'utils/currency.js',
    ],
    tests: [
      'tests/unit/require-market-scope.test.js',
      'tests/unit/market-scope-admin-service.test.js',
      'tests/integration/market-scope-isolation.test.js',
      'tests/unit/currency.test.js',
      'tests/integration/currency-boundary.test.js',
      'tests/unit/currency-boundary-p1.test.js',
      'tests/integration/currency-parities-boundary.test.js',
      'tests/integration/market-open-mayotte.test.js',
      'tests/integration/market-open-cameroon.test.js',
      'tests/integration/market-open-congo.test.js',
    ],
  },

  // ── Tables DB — autorité lifecycle Market ───────────────────────────────
  // Les écritures de référentiel sont portées par les migrations de cette feature ;
  // les services runtime sont en lecture. Le marqueur ! rend l'owner de lifecycle
  // déjà affirmé par perimeter/classification observable par O5.
  db: {
    tables: [
      'markets: RW!',
      'operator_market_scopes: RW!',
      'currency_parities: RW!',
    ],
  },

  // ── Securite ─────────────────────────────────────────────────────────────
  // La feature Market ne possède pas de route HTTP dédiée : ses compteurs de
  // routes restent donc à 0/0. En revanche, sa boundary d'autorisation M2 est
  // désormais réellement consommée par les routes de leurs features métiers.
  security: {
    status: 'CONFIRMED_PROTECTED',
    authedRoutesDetected: 0,
    totalRoutes: 0,
    note: 'La feature Market n\'expose aucune route HTTP propre (0/0), mais ' +
      'requireMarketScope est actif en production comme boundary transverse : ' +
      'les surfaces admin canoniques résolvent leurs marchés autorisés côté ' +
      'serveur depuis operator_market_scopes, jamais depuis un market_id fourni ' +
      'par le client. Les consommateurs incluent Dashboard market, Order 360, ' +
      'Client, Pricing, Opérations, Finance et Expéditions/Douane.',
  },

  // ── Contrat ──────────────────────────────────────────────────────────────
  contract: {
    exposes: [], // aucune route Market propre ; boundary consommée par composition directe
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
    'utils/currency.js#getMarketCurrency throw si le marché n\'existe pas — jamais de devise par défaut silencieuse',
    'utils/currency.js#formatAmount suppose un montant déjà dans l\'unité affichée (12500, pas 1250000 sous-unité) — cohérent avec les colonnes *_kmf existantes, jamais une convention cents inventée sans besoin réel',
    'M10 (ouverture Mayotte) est un INSERT seul — vérifié réellement : 0 fichier de M1/M1b/M1c/M2/M5 modifié pour ouvrir ce marché, cf. tests/integration/market-open-mayotte.test.js',
    'reference_currency = EUR (canonique de la Currency Boundary), structurellement distinct de economic_engine_base_currency = KMF (economic-engine, inchangé) — ne jamais confondre les deux (freeze P1, 22-08-2026)',
    'invariant 9 : aucune paire directe entre deux devises Zone franc (KMF\u2194XAF) n\'est jamais stockée ni calculée comme telle — toute conversion se dérive de deux parités vers EUR au moment du calcul, cf. currency_parities et projectAmount()',
    'currency_parities est la SEULE source de parités — aucune parité ne peut être maintenue manuellement dans un second artefact applicatif (server.js et b-utils.js consomment via adapter, ne portent jamais leur propre valeur)',
    'la Currency Boundary possède la règle monétaire ; utils/currency.js (serveur) et b-utils.js (client, P2) en sont les adapters, jamais des propriétaires concurrents de la règle',
    'aucune devise de sourcing flottante (USD/AED/CNY) dans currency_parities — absence par construction, pas par oubli (freeze invariants 4/5)',
    'P2 : b-utils.js#fmt(amount, "KMF") ne force plus un affichage KMF littéral depuis le 22-08-2026 — "KMF" est devenu l\'alias "projette vers le marché courant" (résolu via market-context.js, override ?market= inclus). Toute AUTRE devise explicite (ex. "EUR") garde le comportement littéral historique, forcé, ignore le marché. Les 33 appels existants de fmt(x, "KMF") n\'ont pas été modifiés — ils héritent du nouveau comportement automatiquement. Quiconque lit un de ces appels doit savoir que "KMF" ne veut plus dire "force KMF"',
    'P2 : fmt()/fmtPrice() restent SYNCHRONES (33 appelants dans des boucles de rendu) — la projection consomme un snapshot déjà chargé (fetch unique au chargement du module, jamais un round-trip par appel). Avant résolution du fetch (fenêtre courte, ou en cas d\'échec réseau), repli sur l\'affichage KMF brut — jamais un montant faux ni une exception',
    'P3 : orders.total_kmf/total_eur (Payment Boundary, finance_config) sont STRICTEMENT INCHANGÉS — Stripe, PayPal et cash_relais lisent exclusivement ces deux colonnes, jamais display_total_amount/display_currency. Les deux boundaries coexistent, jamais mélangées',
    'P3 : display_market_code (client, requête POST /api/orders) est un indice de CONTEXTE, jamais un montant, jamais une autorisation — le serveur calcule lui-même display_total_amount via projectAmount() (services/order-display-snapshot.js). Un code invalide ou absent ne bloque jamais la commande',
    'P3 : ne jamais supposer silencieusement que orders.market_id (celui du relais choisi) est le marché de navigation du client — display_market_code fait TOUJOURS foi s\'il est valide ; relais.market_id n\'est qu\'un repli si aucun code n\'a été fourni ou qu\'il est invalide. Preuve en base : tests/integration/order-display-snapshot.test.js démontre une ligne où market_id (KM) \u2260 display_currency (XAF)',
    'P3 : display_parity_snapshot (JSONB) est une métadonnée d\'audit — la parité utilisée pour le calcul, jamais une source de vérité alternative. display_total_amount seul fait foi',
    'P3 : aucun recalcul ultérieur du display snapshot — figé à la création, comme total_kmf/total_eur. Pour les commandes antérieures à la migration 143, les 3 colonnes restent NULL — aucun backfill fabriqué (invariant 7 du freeze)',
    'P3 : resolveDisplaySnapshot() (services/order-display-snapshot.js) ne throw jamais — un échec de résolution retourne un snapshot vide, ne bloque jamais la création d\'une commande. C\'est une donnée d\'audit/confirmation, pas une donnée de paiement',
    'P4 : correctif Payment Boundary trouvé pendant la cartographie P3 — services/invoice-service.js affichait "KMF" codé en dur sur toutes les factures, même en paiement EUR (Stripe/PayPal). Corrigé selon payment_mode, sans toucher currency_parities ni display_total_amount — ce n\'est pas un chantier Currency Boundary, fichiers déclarés dans documents.feature.js (migrations/144_invoices_total_eur.sql), pas ici',
  ],

  // ── Classification ────────────────────────────────────────────────────────
  classification: {
    axis:     'business',
    kind:     'business-feature',
    decision: 'feature-autonome',
    signals: {
      ownsTables:          true,
      ownsLifecycle:       true,
      activeService:       true,
      multiConsumer:       true,
      ownsMigrations:      true,
      externalSideEffect:  'none',
      surface:             'service+db',
    },
    rationale: [
      'possède le référentiel des marchés (markets), l\'historique d\'accès (operator_market_scopes) et les parités monétaires fixes (currency_parities), avec ses propres migrations (135 à 143) et invariants',
      'expose une boundary devise (utils/currency.js) consommée par plusieurs features (orders pour le snapshot display P3, boutique pour l\'affichage P2) sans posséder leurs cycles de vie propres',
      'ne possède aucune route HTTP — surface exclusivement service/DB, consommée par composition directe (require), jamais un appel réseau',
    ],
  },

};