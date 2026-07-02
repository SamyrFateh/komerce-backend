/**
 * @feature       auth
 * @type          feature
 * @domain        auth
 * @status        production
 * @owner         boutique
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      scripts/feature-registry-check.js
 *
 * Manifeste niveau 0 (gouvernance fichiers) pour le domaine frontend
 * "auth". Genere pour rattacher les modules JS existants (deja annotes
 * @domain auth dans leur header) a un manifest reel, afin que
 * scripts/feature-registry-check.js cesse de les compter en orphelins.
 */
'use strict';

module.exports = {

  name:     'auth',
  type:     'feature',
  domain:   'auth',
  status:   'production',
  owner:    'boutique',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  service: "Authentification et identite utilisateur cote boutique (login telephone, gestion identite).",

  perimeter: {
    in:  ['fichiers js/* annotes @domain auth'],
    out: ['logique backend equivalente (repo komerce-backend, feature auth-identity)'],
  },

  files: {
    js: [
      '../js/b-identity.js',
      '../js/b-phone.js',
    ],
  },

  docs: [],

  contract: {
    exposes: [
      'identity / requireIdentity / getCurrentIdentity / restoreIdentity / bindChangeIdentity (b-identity.js)',
      'phone (b-phone.js)',
    ],
    consumes: [
      'boutique — b-identity.js importe b-store.js, b-utils.js, b-cart-core.js',
    ],
  },

  authority: 'boutique — tout changement de perimetre de ce domaine doit etre reflete ici.',

  invariants: [
    'tout fichier js/* portant @domain auth doit etre liste dans files.js de ce manifeste',
  ],

};
