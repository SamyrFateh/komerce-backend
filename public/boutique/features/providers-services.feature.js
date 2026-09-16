/**
 * @feature       providers-services
 * @type          feature
 * @domain        providers-services
 * @status        staging
 * @owner         boutique
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      scripts/feature-registry-check.js
 */
'use strict';

module.exports = {
  name: 'providers-services',
  type: 'feature',
  domain: 'providers-services',
  status: 'staging',
  owner: 'boutique',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',
  canonicalFeature: 'providers-services',
  sliceKind: 'frontend-slice',

  service: 'Consumer Boutique du cycle Inquiry : reçoit request ou callback depuis la fiche Discovery contextualisée, ' +
    'réutilise l’identité Komerce et, pour un Service qui l’autorise, demande un handoff WhatsApp serveur après création de l’Inquiry.',

  perimeter: {
    in: [
      'consumer du signal discovery:request pour service et physical_offer',
      'intentions Inquiry publiques autorisées : request, callback',
      'handoff WhatsApp optionnel pour service uniquement ; il reste un canal de conversation, jamais une troisième intention Inquiry',
      'requestedWindow facultative pour une demande et requesterNote facultative pour préciser demande ou rappel',
      'requireIdentity() avant toute mutation Inquiry ou handoff WhatsApp',
      'adapter POST /api/providers-services/inquiries',
      'ouverture de l URL WhatsApp exclusivement depuis le handoff renvoyé par le backend après succès de l Inquiry',
      'état pending du CTA et confirmation/erreur utilisateur adaptée à l’intention ou au handoff',
    ],
    out: [
      'rendu et ordre du rail Près de vous — catalog/recommendations',
      'rendu de la fiche service — catalog',
      'contact brut call/tel provider ou WhatsApp sans Inquiry préalable',
      'lecture ou construction frontend du numéro provider — interdit ; le backend résout le canal',
      'vérité d’exposabilité et actions_enabled brutes — backend providers-services',
      'téléphone requester fourni par le client — interdit, dérivé côté serveur',
      'orders, paiement, réservation ou calendrier structuré',
    ],
  },

  files: {
    js: [
      '../js/discovery-inquiry.js',
      '../js/providers-services-api.js',
    ],
    tests: [
      '../tests/unit/discovery-inquiry.test.js',
      '../tests/unit/providers-services-api.test.js',
    ],
  },

  docs: [
    '../../docs/doctrine/DOCTRINE_DISCOVERY_LOCALE_UNIFIEE.md',
  ],

  contract: {
    exposes: [],
    internalApi: [
      'discovery-inquiry.js / setupDiscoveryInquiry / handleDiscoveryRequest',
      'providers-services-api.js / createProviderInquiry',
    ],
    consumes: [
      'catalog — signal discovery:request portant kind/ref/source/requestedWindow/requesterNote, action optionnelle callback et handoff optionnel whatsapp pour service',
      'auth-identity — requireIdentity() ; aucun flow OTP parallèle',
      'platform-ops — bus et showToast comme primitives transverses',
      'providers-services backend — POST /api/providers-services/inquiries?market=CODE ; handoff WhatsApp résolu serveur après Inquiry',
    ],
  },

  authority: 'boutique — cette slice possède uniquement l’orchestration UI de l’Inquiry et l ouverture du handoff retourné ; ' +
    'le backend providers-services reste seul owner de l’écriture, du lifecycle et de la résolution du contact provider.',

  invariants: [
    'request et callback passent par la même Inquiry canonique, avec une cible XOR qui porte toujours le propos connu',
    'whatsapp est un handoff de conversation service-only, jamais une intention Inquiry ni une order',
    'une conversation WhatsApp ne peut être ouverte qu après identité Komerce et succès de création de l Inquiry',
    'aucun téléphone provider n est lu, construit ou envoyé par le frontend ; seule l URL de handoff serveur peut être ouverte après clic explicite',
    'aucun téléphone requester n’est envoyé par le frontend',
    'une annulation d’identité ne crée aucune Inquiry et n ouvre aucun handoff',
    'le CTA est désactivé pendant le flow afin d’éviter les doubles demandes concurrentes',
    'une 404 après clic est rendue comme offre devenue indisponible, jamais comme succès',
    'une indisponibilité WhatsApp est fail-closed et ne simule jamais une conversation ouverte',
    'une Inquiry sur physical_offer n’appelle jamais orders, checkout ni handoff WhatsApp',
  ],
};
