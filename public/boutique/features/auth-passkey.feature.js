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
  status: 'staging',
  owner: 'boutique',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  canonicalFeature: 'auth-passkey',
  sliceKind: 'frontend-slice',

  service: 'Enrôlement après OTP (AUTH-3), login Passkey nominal (AUTH-4) et recovery téléphone → OTP → nouvelle Passkey (AUTH-5).',

  perimeter: {
    in: [
      'proposition post-OTP AUTH-3',
      'appel WebAuthn navigator.credentials.create',
      'login Passkey nominal AUTH-4 sans saisie de numéro',
      'appel WebAuthn navigator.credentials.get',
      'conversion JSON/WebAuthn côté navigateur',
      'appel des endpoints register/options, register/verify, login/options et login/verify AUTH-2',
    ],
    out: [
      'gestion/révocation des authentificateurs (AUTH-6)',
      'step-up (AUTH-7)',
    ],
  },

  files: {
    js: [
      '../js/b-passkey-enrollment.js',
      '../js/b-passkey-login.js',
    ],
    tests: [
      '../tests/unit/b-passkey-enrollment.test.js',
      '../tests/unit/b-passkey-login.test.js',
      '../tests/unit/b-passkey-recovery.test.js',
      '../tests/unit/b-identity-recovery.test.js',
    ],
  },

  docs: [],

  contract: {
    exposes: [],
    internalApi: [
      'setupPasskeyEnrollment / offerPasskeyEnrollment (b-passkey-enrollment.js)',
      'openPasskeyLogin (b-passkey-login.js)',
    ],
    consumes: [
      'auth — b-identity.js émet komerce:identity-authenticated et délègue le login nominal à auth-passkey',
    ],
  },

  authority: 'boutique — expérience d’enrôlement et de connexion passkey AUTH-3/AUTH-4.',

  invariants: [
    'aucune proposition d enrôlement passkey avant une authentification OTP réussie',
    'l enrôlement est volontaire et offre toujours Plus tard',
    'le login passkey est proposé avant OTP quand WebAuthn est disponible',
    'le login discoverable ne demande pas de numéro au client',
    'WhatsApp reste un fallback explicite et non le parcours nominal quand une passkey est utilisable',
    'une passkey inutilisable déclenche un état recovery explicite et exige OTP avant ré-enrôlement',
    'le recovery OTP peut reproposer une nouvelle passkey même si l offre UX normale a déjà été vue',
    'le recovery ne révoque jamais automatiquement les autres credentials',
    'aucun JWT challenge credential clé privée ou donnée biométrique n est stocké dans localStorage ou sessionStorage',
    'les challenges et paramètres RP viennent exclusivement du serveur AUTH-2',
    'navigator.credentials.create/get est vérifié côté serveur avant toute confiance',
    'une annulation WebAuthn ne crée ni ne détruit une session',
    'un navigateur sans WebAuthn conserve le parcours OTP existant',
  ],
};
