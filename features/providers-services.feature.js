/**
 * @feature       providers-services
 * @type          feature
 * @domain        providers-services
 * @status        staging
 * @owner         backend-core
 * @since         2026-08
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 */
'use strict';

module.exports = {

  // ── Identite ─────────────────────────────────────────────────────────────
  name:     'providers-services',
  nature:   'feature',   // feature | capability | governance-unit
  type:     'feature',
  domain:   'providers-services',
  status:   'staging',   // draft | staging | production | deprecated
  owner:    'backend-core',

  classification: {
    axis:     'business',   // business | support
    kind:     'business-feature',
    rationale: [
      'Autorité de mutation exclusive sur providers, services, inquiries — ' +
      'le second principal payable identifié par ARBITRAGE_RECHALLENGE_SONNET.md. ' +
      'Cycle de vie propre (demande -> confirmation, hors calendrier structuré), ' +
      'distinct de catalog (products, canonical Komerce) et de shared-cart ' +
      '(aucun couplage — la prescription artisan V0/V1 reste hors périmètre ' +
      'de ce lot, voir RECHALLENGE_DISCOVERY_LOCALE_COMPLET).',
      'Frontière métier autonome d’exposition et de demande : un service ou une offre ' +
      'physique n’est exposable que sous l’autorité d’un provider actif, et une inquiry ' +
      'reste un cycle sent -> answered -> accepted|declined — jamais une réservation, ' +
      'un paiement ou un calendrier. Ces invariants sont testés dans providers-service.test.js.',
    ],
  },

  since:    '2026-08',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  // ── Service rendu ────────────────────────────────────────────────────────
  service: 'Porter l\'identité d\'un provider tiers, ses propositions de ' +
    'service, et le cycle demande -> confirmation avec un client. Shadow ' +
    'uniquement (Vague 1, IMPACT_FEATURE_FIRST_DISCOVERY_LOCALE.md) : ' +
    'aucune exposition frontend, aucun paiement, aucune commission, aucun ' +
    'calendrier structuré tant que l\'exposition n\'est pas explicitement activée.',

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'table providers (identité, contact, market, statut pending|active|suspended)',
      'table services (prestation d\'un provider, exposition DISABLED par défaut)',
      'table physical_offers (produit physique réellement proposé par un ' +
        'provider — ex. samboussas — table SŒUR de services, jamais la même ' +
        'table, même patron d\'exposition — Vague 2 D1)',
      'table inquiries (cycle sent -> answered -> accepted|declined, jamais ' +
        'une réservation ; porte sur EXACTEMENT une cible, service_id XOR ' +
        'physical_offer_id, contrainte DB inquiries_exactly_one_target — ' +
        'jamais offer_type/offer_id, association polymorphe rejetée)',
      'isServiceExposable() / isPhysicalOfferExposable() — le statut ' +
        'provider gouverne toujours l\'exposition, quelle que soit la cible',
    ],
    out: [
      'authentification provider (pas de users / user_role — identité par ' +
        'téléphone, contact réel hors app à ce stade)',
      'scheduler / créneaux structurés (requested_window/proposed_window sont ' +
        'du texte libre, jamais un slot — RECHALLENGE_MODELE_MINIMAL §5/§7)',
      'paiement, commission, settlement, provider wallet (le vrai chantier — ' +
        'ARBITRAGE_RECHALLENGE_SONNET.md : le jour où de l\'argent doit sortir ' +
        'vers quelqu\'un qui n\'est pas Komerce)',
      'market_offer / multi-offres / ranking (aucune deuxième origine ' +
        'commerciale à ce stade)',
      'god-table Listing/Offer unifiée (physical_offers reste une table ' +
        'distincte de services, jamais un champ discriminant kind — ' +
        'RECHALLENGE_DOCTRINE_DISCOVERY_LOCALE_V2.md §D)',
      'prescription artisan V0/V1/V2, shared-cart (hors périmètre de ce lot)',
      'toute exposition Boutique/Discovery (Vague 2, lots D3+)',
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  files: {
    services: [
      'services/providers-service.js',
    ],
    routes: [
      'routes/providers-services.js',
    ],
    tests: [
      'tests/unit/providers-service.test.js',
      'tests/unit/providers-services-routes.test.js',
    ],
  },

  // ── Tables DB ────────────────────────────────────────────────────────────
  db: {
    tables: [
      'providers: RW',
      'services: RW',
      'physical_offers: RW',
      'inquiries: RW',
      'markets: R',
    ],
  },

  security: {
    status: 'CONFIRMED_PUBLIC_BY_DESIGN',
    authedRoutesDetected: 0,
    totalRoutes: 2,
    note: 'Vague 2 D6 : routes/providers-services.js désormais montée ' +
      'dans bootstrap/api-routes.js. GET /services/:id et GET /physical-' +
      'offers/:id classées PUBLIC et volontairement sans garde — même ' +
      'précédent que recommendations (GET /api/boutique/suggestions, ' +
      'features/recommendations.feature.js). Champs publics minimaux ' +
      'uniquement (id/title/description/zone/market_id) — JAMAIS le ' +
      'téléphone provider, jamais provider_id : le contact réel se fait ' +
      'via une Inquiry (écriture), pas par lecture directe ici. Objet non ' +
      'exposable -> 404, jamais le pourquoi (statut, exposure, marché).',
  },

  contract: {
    exposes: [
      'GET /api/providers-services/services/:id?market=CODE (KM|YT|CM|CG) — jamais ' +
        'monté dans bootstrap/api-routes.js à ce stade (Vague 2 D4, shadow). market ' +
        'est un CODE, jamais un UUID — résolu serveur avant tout usage, corrigé en D6.',
      'GET /api/providers-services/physical-offers/:id?market=CODE — idem',
    ],
    consumes: [
      'market (référentiel markets — lecture seule + résolution code -> id, Vague 2 D6)',
      'infrastructure (dépendance technique transversale : db.js)',
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — tout changement du cycle demande/confirmation ' +
    'doit être validé par le propriétaire de providers-service.js',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    { statement: 'un service ne peut être créé que pour un provider déjà actif',
      test: 'tests/unit/providers-service.test.js' },
    { statement: 'un service n\'est exposable que si lui-même actif, exposition ' +
      'activée, provider actif, ET market_id correspond exactement au marché ' +
      'demandé (Vague 2 D3) — le statut provider prime toujours, mais aucune ' +
      'exposabilité n\'est vraie hors du marché de l\'objet, jamais une ' +
      'confiance aveugle en l\'appelant',
      test: 'tests/unit/providers-service.test.js' },
    { statement: 'une offre physique (physical_offers) suit exactement les mêmes ' +
      'garanties qu\'un service, market_id inclus (Vague 2 D3) : créée seulement ' +
      'pour un provider actif, exposable seulement si elle-même active, ' +
      'exposition activée, provider actif, ET marché correspondant',
      test: 'tests/unit/providers-service.test.js' },
    { statement: 'une inquiry porte sur EXACTEMENT une cible — service_id XOR ' +
      'physical_offer_id, jamais les deux, jamais aucune (contrainte DB ' +
      'inquiries_exactly_one_target, doublée en validation applicative)',
      test: 'tests/unit/providers-service.test.js' },
    { statement: 'une inquiry ne représente jamais une ressource engagée avant ' +
      'la décision finale (accepted|declined) — jamais un objet réservation',
      test: 'tests/unit/providers-service.test.js' },
    { statement: 'le cycle inquiry est strictement linéaire : sent -> answered ' +
      '-> accepted|declined, jamais de saut d\'état',
      test: 'tests/unit/providers-service.test.js' },
    { statement: 'GET /services/:id et GET /physical-offers/:id ne renvoient ' +
      'jamais le téléphone ni provider_id, et ne renvoient jamais le pourquoi ' +
      'd\'une non-exposabilité (404 pur, jamais un détail de statut/marché)',
      test: 'tests/unit/providers-services-routes.test.js' },
    { statement: 'les deux routes ne font jamais confiance à un market_id brut ' +
      'fourni par le client — market est un CODE (KM|YT|CM|CG), résolu et validé ' +
      'serveur (resolveMarketId, markets.is_active=true) avant tout appel à ' +
      'isServiceExposable/isPhysicalOfferExposable',
      test: 'tests/unit/providers-services-routes.test.js' },
  ],

  // ── Historique ───────────────────────────────────────────────────────────
  // 2026-08-28 — création (PR B, Vague 1 Shadow). Second nouveau domaine
  // après local-stock (PR A) — voir IMPACT_FEATURE_FIRST_DISCOVERY_LOCALE.md
  // §Providers-services pour l'arbitrage complet.
  // 2026-08-28 — Vague 2 D1 : ajout physical_offers (table sœur de services)
  // et adaptation de inquiries (double FK nullable + CHECK exactement-une-
  // non-nulle) — voir RECHALLENGE_DOCTRINE_DISCOVERY_LOCALE_V2.md §D pour
  // l'arbitrage owner (4 signaux sur 5 de FEATURE_DOCTRINE.md pointent vers
  // un rattachement à cette feature, pas une nouvelle feature).
  // 2026-08-28 — Vague 2 D3 : isServiceExposable/isPhysicalOfferExposable
  // exigent et vérifient désormais market_id — asymétrie trouvée avec
  // isStockExposable (local-stock, déjà market-scopé par construction) en
  // revoyant le critère "market correct" de D3. Signature cassante mais
  // sûre : aucun consommateur hors tests avant ce lot (confirmé par
  // shadow-domains-boundary.test.js). Vérifié réellement contre Postgres :
  // un samboussas actif+exposé dans un marché n'est jamais exposable
  // depuis un autre marché.
  // 2026-08-28 — Vague 2 D4 : routes/providers-services.js (GET /services/:id,
  // GET /physical-offers/:id), read-only, jamais montée dans bootstrap/
  // api-routes.js. Champs publics minimaux, jamais téléphone/provider_id.
  // 2026-08-28 — Vague 2 D6 : bug réel corrigé — les deux routes faisaient
  // confiance à un market_id brut du client. window.KomerceMarket
  // (public/boutique/js/market-context.js) porte un CODE de navigation
  // (freeze §3 : "NON autorisant"), jamais un UUID — resolveMarketId()
  // traduit désormais ce code en UUID réel côté serveur. Voir
  // features/local-stock.feature.js pour la trouvaille complète.

};
