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
    tests: [
      'tests/unit/providers-service.test.js',
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
    status: 'NO_ROUTE_YET',
    note: 'Shadow — aucune route HTTP exposée dans cette PR. Le service est ' +
      'appelé directement (scripts/tests). Une route sera un lot séparé, ' +
      'avec sa propre revue d\'autorisation.',
  },

  contract: {
    exposes: [
      // Aucune route HTTP dans cette PR — appel direct du service.
    ],
    consumes: [
      'market (référentiel markets — lecture seule)',
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
      'activée, ET son provider actif — le statut provider prime toujours',
      test: 'tests/unit/providers-service.test.js' },
    { statement: 'une offre physique (physical_offers) suit exactement les mêmes ' +
      'garanties qu\'un service : créée seulement pour un provider actif, ' +
      'exposable seulement si elle-même active, exposition activée, ET son ' +
      'provider actif',
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

};
