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
  // backend:shared-cart â€” cas de preuve canonique de la mission O4 Â§12 (une
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
      // P3 (2026-07-27) : rapatriÃ©s depuis boutique.feature.js â€” header
      // @purpose dÃ©clarait dÃ©jÃ  "supports b-group-view.js" avant ce
      // dÃ©placement.
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
      // P3 (2026-07-27) : rapatriÃ©s avec leurs fichiers js correspondants.
      '../tests/unit/b-friendly-group-redirect.test.js',
      '../tests/unit/b-share-phone-guard.test.js',
    ],
  },

  docs: [
    'REFACTOR_SUMMARY.md',
  ],

  contract: {
    exposes: [],
    // MigrÃ© depuis exposes (audit 2026-07-06, lot UNPARSEABLE) : exports JS
    // internes, pas des routes HTTP.
    internalApi: [
      'b-share-cart.js / partage de panier',
      'b-group-view.js / vue panier groupe',
      'b-group-banner.js / banniÃ¨re groupe',
      'group-api.js / group-state.js / group-helpers.js / group-render-creator.js',
    ],
    consumes: [
      'auth â€” b-group-view.js, b-share-cart.js importent b-identity.js ; b-share-cart.js importe b-phone.js',
      'boutique â€” b-group-view.js, b-share-cart.js, b-group-banner.js importent b-bus.js, b-store.js, b-utils.js, b-cart-core.js, b-cart.js',
      'checkout â€” b-share-cart.js importe b-checkout.js',
    ],
  },

  authority: 'boutique â€” tout changement de perimetre de ce domaine doit etre reflete ici.',

  invariants: [
    'tout fichier js/* portant @domain shared-cart doit etre liste dans files.js de ce manifeste',
    'tout test unitaire couvrant un fichier files.js de ce manifeste doit etre liste dans files.tests',
  ],

};
