/**
 * @feature       notifications-client
 * @type          feature
 * @domain        boutique
 * @status        production
 * @owner         boutique
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      scripts/feature-registry-check.js
 */
'use strict';

module.exports = {
  name: 'notifications-client',
  type: 'feature',
  domain: 'boutique',
  status: 'production',
  owner: 'boutique',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',
  canonicalFeature: 'notifications',
  sliceKind: 'frontend-slice',
  service: 'Afficher une information client essentielle dans un bandeau acquittable et orienter vers la commande concernée.',
  perimeter: {
    in: [
      'lecture silencieuse du flux authentifié',
      'bandeau compact, action Commandes et acquittement explicite',
      'trois jalons commande : préparation, expédition et disponibilité au relais',
      'mise en évidence d une commande disponible au relais',
      'projection prioritaire d un événement exceptionnel actionnable',
    ],
    out: [
      'fil de tous les événements métier',
      'déclenchement OTP',
      'push navigateur, WhatsApp, SMS ou email',
    ],
  },
  files: {
    boutique: ['../js/b-notifications.js'],
    css: ['../css/notifications.css'],
    tests: ['../tests/unit/b-notifications.test.js'],
  },
  docs: ['../../../docs/doctrine/DOCTRINE_NOTIFICATIONS_CLIENT_KOMERCE.md'],
  contract: {
    exposes: [],
    internalApi: ['b-notifications.js / setupClientNotifications / refreshClientNotifications'],
    consumes: [
      'notifications — flux ouvert et acquittement propriétaire',
      'orders-client — navigation vers la commande et statut disponible',
      'platform-ops — bus et client API',
      'auth-identity — session existante uniquement',
    ],
  },
  authority: 'boutique — ce slice possède uniquement la projection du message, jamais l événement métier source.',
  invariants: [
    'une absence de session masque le bandeau sans ouvrir l OTP',
    'une seule notification prioritaire est visible à la fois',
    'acquitter le message ne modifie jamais la commande',
    'la commande disponible reste mise en évidence jusqu au retrait',
    'le mouvement respecte prefers-reduced-motion',
  ],
};
