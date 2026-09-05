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
    'leur nom public minimal, leurs médias publics optionnels et le cycle contextualisé de demande/rappel. ' +
    'La cible service_id XOR physical_offer_id porte toujours le propos connu ; le client choisit request ou callback. ' +
    'Aucun paiement, settlement, calendrier structuré, contact provider direct ou order Komerce n’est créé par cette interaction.',

  perimeter: {
    in: [
      'table providers (identité et contact privé, market, statut pending|active|suspended)',
      'table services (prestation d’un provider, exposition DISABLED par défaut, image_ref public optionnel)',
      'table physical_offers (produit physique tiers, image_ref public optionnel)',
      'actions_enabled historiques sur service/physical_offer, projetées publiquement vers request et/ou callback',
      'projection publique provider_name pour humaniser une fiche exposable sans exposer provider_id ni contact privé',
      'table inquiries (cycle sent -> answered -> accepted|declined ; exactement une cible service_id XOR physical_offer_id)',
      'intent request|callback et requester_note facultative : la note enrichit la cible sans jamais remplacer le propos connu',
      'isServiceExposable() / isPhysicalOfferExposable() — provider actif + objet actif + exposition ENABLED + marché correspondant',
      'POST /api/providers-services/inquiries — mutation client authentifiée, téléphone demandeur dérivé de la session canonique serveur',
      'consumer Boutique des actions request/callback — identité Komerce puis création de l’Inquiry propriétaire',
      'seed Discovery staging Anjouan — dataset déterministe, idempotent, strictement opt-in et impossible en production',
      'seed modal V2 staging — cas sérieux pièce auto, plomberie, électricité, ciment et réception',
    ],
    out: [
      'authentification provider (pas de users / user_role pour le provider)',
      'profil public provider riche, bio, téléphone, adresse exacte, métriques sociales ou comparaison de providers',
      'exposition de providers.phone, public_phone ou public_whatsapp dans le détail client',
      'appel direct tel: ou WhatsApp provider depuis la fiche Discovery',
      'scheduler / créneaux structurés : requested_window/proposed_window restent du texte libre',
      'paiement, commission, settlement, provider wallet',
      'orders Komerce : request/callback créent une Inquiry, jamais une ligne orders',
      'action order sur providers-services tant qu’aucun contrat orders explicite n’existe ; un Product Komerce continue d’utiliser le parcours product',
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
      'services/providers-inquiry-service.js',
      'services/providers-interaction-policy.js',
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
      'scripts/seed-discovery-modal-v2-staging.js',
    ],
    migrations: [
      'migrations/157_providers_services_media.sql',
      'migrations/160_providers_services_interaction_actions.sql',
      'migrations/161_providers_services_inquiry_context.sql',
    ],
    tests: [
      'tests/unit/providers-service.test.js',
      'tests/unit/providers-inquiry-service.test.js',
      'tests/unit/providers-services-routes.test.js',
      'tests/unit/providers-interaction-policy.test.js',
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
    note: 'GET /services/:id et GET /physical-offers/:id restent publics et minimaux : provider_name, image_ref et actions request/callback. ' +
      'Aucune coordonnée provider n’est projetée. POST /inquiries est protégé par authenticateOrCreateGuest et le csrfOriginGuard global. ' +
      'Le requester_phone est exclusivement dérivé de req.user.phone. La cible canonique porte toujours le sujet de la demande ou du rappel.',
  },

  contract: {
    exposes: [
      'GET /api/providers-services/services/:id?market=CODE — lecture publique minimale + provider_name + image_ref + actions request/callback',
      'GET /api/providers-services/physical-offers/:id?market=CODE — lecture publique minimale + provider_name + image_ref + actions request/callback',
      'POST /api/providers-services/inquiries?market=CODE — identité Komerce obligatoire ; service_id XOR physical_offer_id ; intent request|callback ; requester_note facultative',
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

  authority: 'backend-core — providers-services possède le cycle demande/confirmation, la projection request/callback, ' +
    'le nom public minimal du provider, les médias source service/physical_offer, le contexte Inquiry et ses données de démonstration staging ; ' +
    'recommendations ne fait que projeter ces lectures.',

  invariants: [
    { statement: 'un service ne peut être créé que pour un provider déjà actif',
      test: 'tests/unit/providers-service.test.js' },
    { statement: 'service et physical_offer ne sont exposables que si objet actif, exposition ENABLED, provider actif et market_id correspondant',
      test: 'tests/unit/providers-service.test.js' },
    { statement: 'une inquiry porte sur exactement une cible — service_id XOR physical_offer_id — qui constitue le propos connu de toute demande ou rappel',
      test: 'tests/unit/providers-services-routes.test.js' },
    { statement: 'la projection publique ne contient que request et/ou callback ; call/whatsapp historiques convergent vers callback et aucun contact provider n’est exposé',
      test: 'tests/unit/providers-interaction-policy.test.js' },
    { statement: 'market est toujours résolu côté serveur avant les checks d’exposabilité',
      test: 'tests/unit/providers-services-routes.test.js' },
    { statement: 'POST /inquiries dérive requester_phone de la session authentifiée et accepte seulement intent request|callback',
      test: 'tests/unit/providers-services-routes.test.js' },
    { statement: 'request/callback sur une physical_offer restent des Inquiry providers-services et ne créent jamais une order Komerce',
      test: 'public/boutique/tests/unit/discovery-inquiry.test.js' },
    { statement: 'le seed Discovery ne peut écrire qu’en staging avec opt-in explicite et les exemples modal V2 restent attachés aux UUID déterministes existants',
      test: 'tests/unit/seed-discovery-staging.test.js' },
  ],

  // 2026-08-28 — création shadow providers/services/inquiries + physical_offers.
  // 2026-08-30 — V2 native Boutique : parcours Commander/Demander.
  // 2026-08-31 — dataset Discovery staging Anjouan + image_ref source-owned.
  // 2026-09-02 — provider_name public minimal dans le détail.
  // 2026-09-03 — convergence modale : demander ou être rappelé, sujet toujours connu par la cible Inquiry.
};
