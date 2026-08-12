/**
 * @feature       payment
 * @type          feature
 * @domain        payment
 * @status        production
 * @owner         boutique
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      scripts/feature-registry-check.js
 *
 * Manifeste niveau 0 (gouvernance fichiers) pour le domaine frontend
 * "payment". Genere pour rattacher les modules JS existants (deja annotes
 * @domain payment dans leur header) a un manifest reel, afin que
 * scripts/feature-registry-check.js cesse de les compter en orphelins.
 */
'use strict';

module.exports = {

  name:     'payment',
  type:     'feature',
  domain:   'payment',
  status:   'production',
  owner:    'boutique',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  // Lot O4 (cross-repo feature coverage) : projection frontend directe de
  // backend:payments (le nom 'payment' au singulier ne colle pas par hasard —
  // verifie par le service rendu : integration/orchestration PayPal, meme
  // perimetre que backend:payments qui exclut explicitement l'ownership
  // commande a orders).
  canonicalFeature: 'payments',
  sliceKind: 'frontend-slice',

  service: "Integration paiement (PayPal) — rendu et orchestration du flux de paiement tiers.",

  perimeter: {
    in:  ['fichiers js/* annotes @domain payment'],
    out: ['logique backend equivalente (repo komerce-backend, feature payments)'],
  },

  files: {
    js: [
      '../js/b-paypal.js',
    ],
    css: [
      // P3b (2026-07-27) : ownership CSS jamais rapatrié lors du split P3 —
      // deja declare cote features/payments.feature.js (racine).
      '../css/paypal.css',
    ],
    tests: [
      '../tests/unit/b-paypal.test.js',
      // teste b-paypal.js directement (require réel).
    ],
  },

  docs: [],

  contract: {
    exposes: [],
    // Migré depuis exposes (audit 2026-07-06, lot UNPARSEABLE) : export JS
    // interne, pas une route HTTP.
    internalApi: [
      'b-paypal.js / renderPayPalButton / isPayPalEnabled',
    ],
    consumes: [
      'boutique — b-paypal.js importe b-cart-core.js, b-utils.js',
      'API — b-paypal.js appelle /api/public/config',
    ],
  },

  authority: 'boutique — tout changement de perimetre de ce domaine doit etre reflete ici.',

  invariants: [
    'tout fichier js/* portant @domain payment doit etre liste dans files.js de ce manifeste',
    'chaque fournisseur tiers expose un chargement local borné, puis un message de repli actionnable sans bloquer le checkout',
  ],

};
