/**
 * @feature       shared-cart
 * @type          feature
 * @domain        shared-cart
 * @status        production
 * @owner         boutique
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      scripts/feature-registry-check.js
 *
 * Manifeste niveau 0 (gouvernance fichiers) pour le domaine frontend
 * "shared-cart". Genere pour rattacher les modules JS existants (deja annotes
 * @domain shared-cart dans leur header) a un manifest reel, afin que
 * scripts/feature-registry-check.js cesse de les compter en orphelins.
 */
'use strict';

module.exports = {

  name:     'shared-cart',
  type:     'feature',
  domain:   'shared-cart',
  status:   'production',
  owner:    'boutique',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  // Lot O4 (cross-repo feature coverage) : meme identite metier que
  // backend:shared-cart — cas de preuve canonique de la mission O4 §12 (une
  // seule identite cross-repo, pas deux business features distinctes).
  canonicalFeature: 'shared-cart',
  sliceKind: 'frontend-slice',

  service: "Panier partage et flux groupe (creation, gestion, rendu createur/participant, orchestration commande collective).",

  perimeter: {
    in:  ['fichiers js/* annotes @domain shared-cart'],
    out: ['logique backend equivalente (repo komerce-backend, feature shared-cart)'],
  },

  files: {
    js: [
      '../js/b-group-banner.js',
      '../js/b-group-view.js',
      '../js/b-share-cart.js',
      '../js/group/group-api.js',
      '../js/group/group-helpers.js',
      '../js/group/group-render-creator.js',
      '../js/group/group-state.js',
      // P3 (2026-07-27) : rapatriés depuis boutique.feature.js — header
      // @purpose déclarait déjà "supports b-group-view.js" avant ce
      // déplacement.
      '../js/b-friendly-group-redirect.js',
      '../js/b-share-phone-guard.js',
    ],
    css: [
      // P3b (2026-07-27) : ownership CSS jamais rapatrié lors du split P3 —
      // deja declare cote features/shared-cart.feature.js (racine).
      '../css/group-cart-flow.css',
      '../css/hero-cart-proxy.css',
      '../css/share-cart.css',
      '../css/shared-followup.css',
    ],
    tests: [
      '../tests/unit/group-render-creator.test.js',
      // P3 (2026-07-27) : rapatriés avec leurs fichiers js correspondants.
      '../tests/unit/b-friendly-group-redirect.test.js',
      '../tests/unit/b-share-phone-guard.test.js',
    ],
  },

  docs: [
    'REFACTOR_SUMMARY.md',
  ],

  contract: {
    exposes: [],
    // Migré depuis exposes (audit 2026-07-06, lot UNPARSEABLE) : exports JS
    // internes, pas des routes HTTP.
    internalApi: [
      'b-share-cart.js / partage de panier',
      'b-group-view.js / vue panier groupe',
      'b-group-banner.js / bannière groupe',
      'group-api.js / group-state.js / group-helpers.js / group-render-creator.js',
    ],
    consumes: [
      'auth — b-group-view.js, b-share-cart.js importent b-identity.js ; b-share-cart.js importe b-phone.js',
      'boutique — b-group-view.js, b-share-cart.js, b-group-banner.js importent b-bus.js, b-store.js, b-utils.js, b-cart-core.js, b-cart.js',
      'checkout — b-share-cart.js importe b-checkout.js',
    ],
  },

  authority: 'boutique — tout changement de perimetre de ce domaine doit etre reflete ici.',

  invariants: [
    'tout fichier js/* portant @domain shared-cart doit etre liste dans files.js de ce manifeste',
    'tout test unitaire couvrant un fichier files.js de ce manifeste doit etre liste dans files.tests',
  ],

};
