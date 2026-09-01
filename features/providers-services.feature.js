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
      'Le cycle demande -> réponse reste distinct du catalogue, des commandes Komerce, du paiement et de la liste partagée.',
      'Frontière métier autonome d’exposition et de demande : un service ou une offre physique n’est exposable ' +
      'que sous l’autorité d’un provider actif ; une inquiry reste sent -> answered -> accepted|declined.',
    ],
  },

  since:    '2026-08',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  service: 'Porter l’identité d’un provider tiers, ses services et offres physiques, leur exposabilité, ' +
    'leur nom public minimal, leurs médias publics optionnels et le cycle de demande explicite d’un client Komerce. ' +
    'Aucun paiement, settlement, calendrier structuré ou order Komerce n’est créé par Commander/Demander.',

  perimeter: {
    in: [
      'table providers (identité, contact, market, statut pending|active|suspended)',
      'table services (prestation d’un provider, exposition DISABLED par défaut, image_ref public optionnel)',
      'table physical_offers (produit physique tiers, image_ref public optionnel)',
      'projection publique provider_name pour humaniser une fiche exposable sans exposer provider_id ni téléphone',
      'table inquiries (cycle sent -> answered -> accepted|declined ; exactement une cible service_id XOR physical_offer_id)',
      'isServiceExposable() / isPhysicalOfferExposable() — provider actif + objet actif + exposition ENABLED + marché correspondant',
      'POST /api/providers-services/inquiries — mutation client authentifiée, téléphone dérivé de la session canonique serveur',
      'consumer Boutique Commander/Demander — identité Komerce puis création de l’Inquiry propriétaire',
      'seed Discovery staging Anjouan — dataset déterministe, idempotent, strictement opt-in et impossible en production',
    ],
    out: [
      'authentification provider (pas de users / user_role pour le provider)',
      'profil public provider riche, bio, téléphone, adresse exacte, métriques sociales ou comparaison de providers',
      'scheduler / créneaux structurés : requested_window/proposed_window restent du texte libre',
      'paiement, commission, settlement, provider wallet',
      'orders Komerce : Commander une physical_offer crée une Inquiry, jamais une ligne orders',
      'market_offer / multi-offres / ranking',
      'god-table Listing/Offer unifiée',
      'prescription artisan et shared-cart',
      'composition, ranking et ordre éditorial du rail Près de vous — owner recommendations',
      'surface produit/catalogue et navigation — owner catalog',
      'hébergement/stockage binaire des médias — image_ref reste une référence, pas un media service',
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
    migrations: [
      'migrations/157_providers_services_media.sql',
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
    note: 'GET /services/:id et GET /physical-offers/:id restent publics et minimaux : provider_name et image_ref ' +
      'peuvent être exposés, jamais provider_id ni téléphone. POST /inquiries est protégé par authenticateOrCreateGuest ' +
      'et le csrfOriginGuard global. Le requester_phone est exclusivement dérivé de req.user.phone. ' +
      'Le seed Discovery exige KOMERCE_ENV=staging + opt-in explicite.',
  },

  contract: {
    exposes: [
      'GET /api/providers-services/services/:id?market=CODE — lecture publique minimale + provider_name + image_ref optionnel',
      'GET /api/providers-services/physical-offers/:id?market=CODE — lecture publique minimale + provider_name + image_ref optionnel',
      'POST /api/providers-services/inquiries?market=CODE — identité Komerce obligatoire ; service_id XOR physical_offer_id',
    ],
    consumes: [
      'auth — authenticateOrCreateGuest et session canonique côté serveur',
      'auth-identity — requireIdentity() côté Boutique avant mutation',
      'platform-ops — bus et showToast comme primitives UI transverses',
      'market — référentiel markets, résolution code -> id côté serveur',
      'local-stock — déclaration et exposition du stock local Product Komerce du seed Discovery staging via les primitives owner',
      'infrastructure — dépendance technique db.js et résolution KOMERCE_ENV',
    ],
  },

  authority: 'backend-core — providers-services possède le cycle demande/confirmation, le nom public minimal du provider, ' +
    'les médias source service/physical_offer et ses données de démonstration staging ; recommendations ne fait que projeter ces lectures.',

  invariants: [
    { statement: 'un service ne peut être créé que pour un provider déjà actif',
      test: 'tests/unit/providers-service.test.js' },
    { statement: 'service et physical_offer ne sont exposables que si objet actif, exposition ENABLED, provider actif et market_id correspondant',
      test: 'tests/unit/providers-service.test.js' },
    { statement: 'une inquiry porte sur exactement une cible — service_id XOR physical_offer_id',
      test: 'tests/unit/providers-service.test.js' },
    { statement: 'les GET peuvent exposer provider_name et image_ref mais ne renvoient jamais provider_id ou téléphone',
      test: 'tests/unit/providers-services-routes.test.js' },
    { statement: 'market est toujours résolu côté serveur avant les checks d’exposabilité',
      test: 'tests/unit/providers-services-routes.test.js' },
    { statement: 'POST /inquiries dérive requester_phone de la session authentifiée',
      test: 'tests/unit/providers-services-routes.test.js' },
    { statement: 'Commander une physical_offer reste une Inquiry providers-services et ne crée jamais une order Komerce',
      test: 'public/boutique/tests/unit/discovery-inquiry.test.js' },
    { statement: 'le seed Discovery ne peut écrire qu’en staging avec opt-in explicite, conserve UUID/candidats déterministes et écrit image_ref',
      test: 'tests/unit/seed-discovery-staging.test.js' },
  ],

  // 2026-08-28 — création shadow providers/services/inquiries + physical_offers.
  // 2026-08-30 — V2 native Boutique : parcours Commander/Demander.
  // 2026-08-31 — dataset Discovery staging Anjouan + image_ref source-owned.
  // 2026-09-02 — U2 : provider_name public minimal dans le détail, aucune donnée de contact exposée.
};
