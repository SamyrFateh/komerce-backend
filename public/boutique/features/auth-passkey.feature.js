/**
 * @feature       auth-passkey
 * @type          feature
 * @domain        auth-passkey
 * @status        staging
 * @owner         boutique
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      scripts/feature-registry-check.js
 */
'use strict';

module.exports = {
  name: 'auth-passkey',
  type: 'feature',
  domain: 'auth-passkey',
  status: 'production',
  owner: 'boutique',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  canonicalFeature: 'auth-passkey',
  sliceKind: 'frontend-slice',

  service: 'Enrôlement (AUTH-3), login nominal (AUTH-4) seulement quand la disponibilité locale est connue, recovery OTP (AUTH-5), gestion/révocation des passkeys dans Mon Komerce (AUTH-6) et step-up Passkey des mutations sensibles (AUTH-7).',

  perimeter: {
    in: [
      'proposition post-OTP AUTH-3',
      'appel WebAuthn navigator.credentials.create',
      'login Passkey nominal AUTH-4 sans saisie de numéro lorsque ce navigateur a déjà prouvé une passkey Komerce',
      'appel WebAuthn navigator.credentials.get',
      'conversion JSON/WebAuthn côté navigateur',
      'appel des endpoints register/options, register/verify, login/options et login/verify AUTH-2',
    ],
    out: [
      'génération et vérification serveur des challenges/credentials WebAuthn — feature backend auth-passkey',
      'autorité OTP/WhatsApp et création de session — feature auth/auth-identity',
      'persistance et révocation d authentificateurs — autorité backend, jamais le navigateur',
    ],
  },

  files: {
    js: [
      '../js/b-passkey-enrollment.js',
      '../js/b-passkey-login.js',
      '../js/b-passkey-security.js',
      '../js/b-passkey-step-up.js',
    ],
    tests: [
      '../tests/unit/b-passkey-enrollment.test.js',
      '../tests/unit/b-passkey-login.test.js',
      '../tests/unit/b-passkey-recovery.test.js',
      '../tests/unit/b-identity-recovery.test.js',
      '../tests/unit/b-passkey-security.test.js',
      '../tests/unit/b-passkey-step-up.test.js',
    ],
  },

  docs: [],

  contract: {
    exposes: [],
    internalApi: [
      'setupPasskeyEnrollment / offerPasskeyEnrollment (b-passkey-enrollment.js)',
      'openPasskeyLogin / shouldOfferPasskeyLogin (b-passkey-login.js)',
      'loadPasskeySecurity (b-passkey-security.js)',
      'performPasskeyStepUp / withStepUpRetry (b-passkey-step-up.js)',
    ],
    consumes: [
      'auth — b-identity.js émet komerce:identity-authenticated et délègue le login nominal à auth-passkey',
    ],
  },

  authority: 'boutique — expérience d’enrôlement et de connexion passkey AUTH-3/AUTH-4.',

  invariants: [
    'aucune proposition d enrôlement passkey avant une authentification OTP réussie',
    'l enrôlement est volontaire et offre toujours Plus tard',
    'la seule présence de WebAuthn sur un navigateur ne suffit jamais à afficher un choix Passkey',
    'le login passkey est proposé avant OTP uniquement si WebAuthn est disponible et si ce navigateur possède un indice local issu d un enrôlement ou login Passkey réellement réussi',
    'l indice local de disponibilité Passkey est uniquement un signal UX non secret : il ne prouve jamais une identité et ne contourne aucune vérification serveur',
    'un refus 401 de la credential par le serveur invalide l indice local afin de ne plus reproposer un chemin devenu inutilisable',
    'le login discoverable ne demande pas de numéro au client',
    'WhatsApp reste un fallback explicite et non le parcours nominal quand une passkey est utilisable',
    'une passkey inutilisable déclenche un état recovery explicite et exige OTP avant ré-enrôlement',
    'le recovery OTP peut reproposer une nouvelle passkey même si l offre UX normale a déjà été vue',
    'le recovery ne révoque jamais automatiquement les autres credentials',
    'Mon Komerce affiche uniquement des métadonnées sûres de passkeys et exige confirmation avant révocation',
    'la révocation UI utilise uniquement l identifiant de gestion opaque fourni par le serveur',
    'un 428 step_up_required déclenche au plus un challenge Passkey puis un seul retry',
    'sans Passkey disponible le client exige une reconnexion WhatsApp fraîche au lieu de contourner le step-up',
    'aucun JWT challenge credential clé privée ou donnée biométrique n est stocké dans localStorage ou sessionStorage',
    'les challenges et paramètres RP viennent exclusivement du serveur AUTH-2',
    'navigator.credentials.create/get est vérifié côté serveur avant toute confiance',
    'une annulation WebAuthn ne crée ni ne détruit une session',
    'un navigateur sans WebAuthn conserve le parcours OTP existant',
  ],
};
