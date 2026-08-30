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
  name:     'providers-services',
  nature:   'feature',
  type:     'feature',
  domain:   'providers-services',
  status:   'staging',
  owner:    'backend-core',

  classification: {
    axis: 'business',
    kind: 'business-feature',
    rationale: [
      'Autorité de mutation exclusive sur providers, services, physical_offers et inquiries. ' +
      'Le cycle demande -> réponse reste distinct du catalogue, des commandes Komerce, du ' +
      'paiement et de la liste partagée.',
      'Frontière métier autonome d’exposition et de demande : un service ou une offre physique ' +
      'n’est exposable que sous l’autorité d’un provider actif ; une inquiry reste sent -> ' +
      'answered -> accepted|declined, jamais une réservation ni une commande orders.',
    ],
  },

  since:    '2026-08',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  service: 'Porter l’identité d’un provider tiers, ses services et offres physiques, leur ' +
    'exposabilité, puis le cycle de demande explicite d’un client Komerce. La V2 native ' +
    'Boutique active uniquement l’Inquiry authentifiée ; aucun paiement, settlement, ' +
    'calendrier structuré ou order Komerce n’est créé par Commander/Demander.',

  perimeter: {
    in: [
      'table providers (identité, contact, market, statut pending|active|suspended)',
      'table services (prestation d’un provider, exposition DISABLED par défaut)',
      'table physical_offers (produit physique réellement proposé par un provider — ex. samboussas — table sœur de services)',
      'table inquiries (cycle sent -> answered -> accepted|declined ; exactement une cible service_id XOR physical_offer_id)',
      'isServiceExposable() / isPhysicalOfferExposable() — provider actif + objet actif + exposition ENABLED + marché correspondant',
      'POST /api/providers-services/inquiries — mutation client authentifiée, téléphone dérivé de la session canonique serveur',
      'consumer Boutique Commander/Demander — identité Komerce puis création de l’Inquiry propriétaire',
      'seed Discovery staging Anjouan — dataset déterministe et idempotent, strictement opt-in et impossible en production',
    ],
    out: [
      'authentification provider (pas de users / user_role pour le provider)',
      'scheduler / créneaux structurés : requested_window/proposed_window restent du texte libre',
      'paiement, commission, settlement, provider wallet',
      'orders Komerce : Commander une physical_offer crée une Inquiry, jamais une ligne orders',
      'market_offer / multi-offres / ranking',
      'god-table Listing/Offer unifiée',
      'prescription artisan et shared-cart',
      'composition, ranking et ordre éditorial du rail Près de vous — owner recommendations',
      'surface produit/catalogue et navigation — owner catalog',
    ],
  },

  files: {
    services: [
      'services/providers-service.js',
    ],
    routes: [
      'routes/providers-services.js',
    ],
    boutique: [
      'js/discovery-inquiry.js',
      'js/providers-services-api.js',
    ],
    scripts: [
      'scripts/seed-discovery-staging.js',
    ],
    tests: [
      'tests/unit/providers-service.test.js',
      'tests/unit/providers-services-routes.test.js',
      'tests/unit/seed-discovery-staging.test.js',
    ],
  },

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
    status: 'CONFIRMED_MIXED',
    authedRoutesDetected: 1,
    totalRoutes: 3,
    note: 'GET /services/:id et GET /physical-offers/:id restent publics et minimaux. ' +
      'POST /inquiries est protégé par authenticateOrCreateGuest et le csrfOriginGuard global. ' +
      'Le requester_phone est exclusivement dérivé de req.user.phone ; un téléphone fourni ' +
      'dans le body n’est jamais consommé ni reflété dans la réponse. Le seed Discovery est ' +
      'un tooling staging, sans route HTTP, et exige KOMERCE_ENV=staging + opt-in explicite.',
  },

  contract: {
    exposes: [
      'GET /api/providers-services/services/:id?market=CODE — lecture publique minimale d’un service exposable',
      'GET /api/providers-services/physical-offers/:id?market=CODE — lecture publique minimale d’une offre physique exposable',
      'POST /api/providers-services/inquiries?market=CODE — identité Komerce obligatoire ; service_id XOR physical_offer_id ; revalidation exposabilité avant insertion',
    ],
    consumes: [
      'auth — authenticateOrCreateGuest et session canonique côté serveur',
      'auth-identity — requireIdentity() côté Boutique avant mutation',
      'platform-ops — bus et showToast comme primitives UI transverses',
      'market — référentiel markets, résolution code -> id côté serveur',
      'infrastructure — dépendance technique db.js et résolution KOMERCE_ENV',
    ],
  },

  authority: 'backend-core — providers-services possède le cycle demande/confirmation, ' +
    'l’écriture inquiries et ses données de démonstration staging ; catalog/recommendations ' +
    'ne font que produire la découverte et l’intention UI.',

  invariants: [
    { statement: 'un service ne peut être créé que pour un provider déjà actif',
      test: 'tests/unit/providers-service.test.js' },
    { statement: 'service et physical_offer ne sont exposables que si objet actif, exposition ENABLED, provider actif et market_id correspondant',
      test: 'tests/unit/providers-service.test.js' },
    { statement: 'une inquiry porte sur exactement une cible — service_id XOR physical_offer_id, jamais les deux ni aucune',
      test: 'tests/unit/providers-service.test.js' },
    { statement: 'une inquiry n’engage aucune ressource avant la décision finale et ne devient jamais une réservation',
      test: 'tests/unit/providers-service.test.js' },
    { statement: 'le cycle inquiry est strictement linéaire : sent -> answered -> accepted|declined',
      test: 'tests/unit/providers-service.test.js' },
    { statement: 'les GET ne renvoient jamais provider_id, téléphone ou raison interne de non-exposabilité',
      test: 'tests/unit/providers-services-routes.test.js' },
    { statement: 'market est toujours un code résolu côté serveur avant les checks d’exposabilité, jamais un market_id autorisant fourni par le client',
      test: 'tests/unit/providers-services-routes.test.js' },
    { statement: 'POST /inquiries dérive requester_phone de la session authentifiée ; le body client ne peut jamais usurper ce téléphone et la réponse ne le reflète pas',
      test: 'tests/unit/providers-services-routes.test.js' },
    { statement: 'POST /inquiries revalide l’exposabilité de la cible dans le marché courant juste avant createInquiry()',
      test: 'tests/unit/providers-services-routes.test.js' },
    { statement: 'Commander une physical_offer reste une Inquiry providers-services et ne crée jamais une order Komerce',
      test: 'public/boutique/tests/unit/discovery-inquiry.test.js' },
    { statement: 'le seed Discovery ne peut écrire qu’en staging avec opt-in explicite et conserve des UUID/candidats déterministes',
      test: 'tests/unit/seed-discovery-staging.test.js' },
  ],

  // 2026-08-28 — création shadow providers/services/inquiries.
  // 2026-08-28 — ajout physical_offers comme table sœur de services.
  // 2026-08-28 — exposabilité rendue market-scoped et routes GET montées avec résolution code -> UUID.
  // 2026-08-30 — V2 native Boutique : activation du parcours Commander/Demander.
  // 2026-08-31 — dataset Discovery staging Anjouan : 5 providers, 4 physical_offers, 6 services.
  // L’intention Discovery reste émise par catalog ; le consumer providers-services
  // exige l’identité Komerce, POSTe une Inquiry authentifiée et confirme l’envoi.
};
