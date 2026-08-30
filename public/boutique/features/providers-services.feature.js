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

  service: 'Consumer Boutique du cycle Inquiry : reçoit l’intention Commander/Demander, ' +
    'réutilise l’identité Komerce et appelle exclusivement la mutation providers-services.',

  perimeter: {
    in: [
      'consumer du signal discovery:request pour service et physical_offer',
      'requireIdentity() avant toute mutation Inquiry',
      'adapter POST /api/providers-services/inquiries',
      'état pending du CTA et confirmation/erreur utilisateur',
    ],
    out: [
      'rendu et ordre du rail Près de vous — catalog/recommendations',
      'vérité d’exposabilité — backend providers-services',
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
      'catalog — signal discovery:request portant uniquement kind/ref et le bouton source UI',
      'auth-identity — requireIdentity() ; aucun flow OTP parallèle',
      'platform-ops — bus et showToast comme primitives transverses',
      'providers-services backend — POST /api/providers-services/inquiries?market=CODE',
    ],
  },

  authority: 'boutique — cette slice possède uniquement l’orchestration UI de l’Inquiry ; ' +
    'le backend providers-services reste seul owner de l’écriture et du lifecycle.',

  invariants: [
    'Commander et Demander passent par la même Inquiry canonique, avec une cible XOR',
    'aucun téléphone requester n’est envoyé par le frontend',
    'une annulation d’identité ne crée aucune Inquiry',
    'le CTA est désactivé pendant le flow afin d’éviter les doubles demandes concurrentes',
    'une 404 après clic est rendue comme offre devenue indisponible, jamais comme succès',
    'Commander une physical_offer n’appelle jamais orders ni checkout',
  ],
};
