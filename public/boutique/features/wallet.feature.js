/**
 * @feature       wallet
 * @type          feature
 * @domain        wallet
 * @status        production
 * @owner         boutique
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      scripts/feature-registry-check.js
 *
 * Manifeste niveau 0 (gouvernance fichiers) pour le domaine frontend
 * "wallet". Genere pour rattacher les modules JS existants (deja annotes
 * @domain wallet dans leur header) a un manifest reel, afin que
 * scripts/feature-registry-check.js cesse de les compter en orphelins.
 */
'use strict';

module.exports = {

  name:     'wallet',
  type:     'feature',
  domain:   'wallet',
  status:   'production',
  owner:    'boutique',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  service: "Portefeuille et fidelite cote boutique (consultation solde, utilisation avoir).",

  perimeter: {
    in:  ['fichiers js/* annotes @domain wallet'],
    out: ['logique backend equivalente (repo komerce-backend, feature wallet-loyalty)'],
  },

  files: {
    js: [
      '../js/b-wallet.js',
    ],
  },

  docs: [],

  contract: {
    exposes: [],
    // Migré depuis exposes (audit 2026-07-06, lot UNPARSEABLE) : export JS
    // interne, pas une route HTTP.
    internalApi: [
      'b-wallet.js / porte-monnaie utilisateur',
    ],
    consumes: [
      'auth — b-wallet.js importe b-identity.js',
      'boutique — b-wallet.js importe b-utils.js',
    ],
  },

  authority: 'boutique — tout changement de perimetre de ce domaine doit etre reflete ici.',

  invariants: [
    'tout fichier js/* portant @domain wallet doit etre liste dans files.js de ce manifeste',
  ],

};
