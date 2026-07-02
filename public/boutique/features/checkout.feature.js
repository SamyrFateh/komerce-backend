/**
 * @feature       checkout
 * @type          feature
 * @domain        checkout
 * @status        production
 * @owner         boutique
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      scripts/feature-registry-check.js
 *
 * Manifeste niveau 0 (gouvernance fichiers) pour le domaine frontend
 * "checkout". Genere pour rattacher les modules JS existants (deja annotes
 * @domain checkout dans leur header) a un manifest reel, afin que
 * scripts/feature-registry-check.js cesse de les compter en orphelins.
 */
'use strict';

module.exports = {

  name:     'checkout',
  type:     'feature',
  domain:   'checkout',
  status:   'production',
  owner:    'boutique',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  service: "Tunnel de commande (rendu du recapitulatif, validation, soumission) — du panier valide a la confirmation.",

  perimeter: {
    in:  ['fichiers js/* annotes @domain checkout'],
    out: ['logique backend equivalente (repo komerce-backend, feature orders)'],
  },

  files: {
    js: [
      '../js/b-checkout-render.js',
      '../js/b-checkout.js',
    ],
  },

  contract: {
    exposes: [
      'b-checkout.js (orchestration checkout, validation commande)',
    ],
    consumes: [
      'auth — b-checkout.js importe b-identity.js, b-phone.js',
      'boutique — b-checkout.js importe b-bus.js, b-store.js, b-utils.js, b-cart-core.js, b-cart.js, b-scroll-owner.js',
      'payment — b-checkout.js importe b-paypal.js',
      'wallet — b-checkout.js appelle /api/wallet',
    ],
  },

  authority: 'boutique — tout changement de perimetre de ce domaine doit etre reflete ici.',

  invariants: [
    'tout fichier js/* portant @domain checkout doit etre liste dans files.js de ce manifeste',
  ],

};
