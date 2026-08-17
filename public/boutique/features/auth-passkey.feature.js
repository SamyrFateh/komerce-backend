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

  service: 'Enrôlement volontaire d’une passkey après une authentification OTP réussie, sans modifier le parcours OTP nominal.',

  perimeter: {
    in: [
      'proposition post-OTP AUTH-3',
      'appel WebAuthn navigator.credentials.create',
      'conversion JSON/WebAuthn côté navigateur',
      'appel des endpoints register/options et register/verify AUTH-2',
    ],
    out: [
      'login passkey nominal (AUTH-4)',
      'recovery (AUTH-5)',
      'gestion/révocation des authentificateurs (AUTH-6)',
      'step-up (AUTH-7)',
    ],
  },

  files: {
    js: [
      '../js/b-passkey-enrollment.js',
    ],
    tests: [
      '../tests/unit/b-passkey-enrollment.test.js',
    ],
  },

  docs: [],

  contract: {
    exposes: [],
    internalApi: [
      'setupPasskeyEnrollment / offerPasskeyEnrollment (b-passkey-enrollment.js)',
    ],
    consumes: [
      'auth — b-identity.js émet komerce:identity-authenticated après vérification OTP',
    ],
  },

  authority: 'boutique — expérience d’enrôlement passkey AUTH-3 uniquement.',

  invariants: [
    'aucune proposition passkey avant une authentification OTP réussie',
    'l enrôlement est volontaire et offre toujours Plus tard',
    'aucun JWT challenge credential clé privée ou donnée biométrique n est stocké dans localStorage ou sessionStorage',
    'le challenge et les paramètres RP viennent exclusivement de POST /api/auth/passkey/register/options',
    'navigator.credentials.create est appelé avec les options serveur et la réponse est vérifiée par POST /api/auth/passkey/register/verify',
    'une annulation WebAuthn ne casse jamais la session OTP déjà obtenue',
    'un navigateur sans WebAuthn conserve exactement le parcours OTP existant',
  ],
};
