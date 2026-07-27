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

  // Lot O4 (cross-repo feature coverage) : rattache a backend:wallet (solde,
  // credit/debit), PAS backend:wallet-loyalty. Le manifeste lui-meme le
  // documente en perimeter.out ("scindees de wallet-loyalty au Lot O1.2") et
  // son fichier unique (b-wallet.js) traite consultation solde/utilisation
  // avoir — pas de logique de recompenses fidelite (feature loyalty separee
  // cote backend). Mission O4 §12 : ne pas recreer wallet-loyalty cote boutique.
  canonicalFeature: 'wallet',
  sliceKind: 'frontend-slice',

  service: "Portefeuille et fidelite cote boutique (consultation solde, utilisation avoir).",

  perimeter: {
    in:  ['fichiers js/* annotes @domain wallet'],
    out: ['logique backend equivalente (repo komerce-backend, features wallet + loyalty — scindees de wallet-loyalty au Lot O1.2, 2026-07-12)'],
  },

  files: {
    js: [
      '../js/b-wallet.js',
    ],
    css: [
      // P3b (2026-07-27) : ownership CSS jamais rapatrié lors du split P3 —
      // deja declare cote features/wallet.feature.js (racine).
      '../css/wallet.css',
    ],
    tests: [
      '../tests/unit/b-wallet.test.js',
      // teste b-wallet.js directement (require réel) ; mocke b-utils.js et
      // b-identity.js en tant que collaborateurs (normal).
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
