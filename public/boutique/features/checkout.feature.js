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

  // Lot O4 (cross-repo feature coverage) : canonicalFeature fixe a 'payments'
  // sur PREUVE FICHIER (backend:payments.files.boutique revendique
  // factuellement b-checkout.js + b-checkout-render.js ; backend:orders.files.boutique
  // est vide). sliceKind='ui-orchestration' (pas 'frontend-slice' pur) car ce
  // manifeste orchestre a la fois la soumission de commande ET la selection du
  // moyen de paiement, sans etre l'implementation exclusive de l'un ou l'autre.
  // ONTOLOGY GAP documente et NON tranche silencieusement — voir
  // governance/business-graph-ontology-gaps.json (id: checkout-orders-boutique-coverage) :
  // backend:orders devrait-il revendiquer une part de ce fichier (rendu
  // recapitulatif / soumission) ? Decision produit non prise par O4.
  canonicalFeature: 'payments',
  sliceKind: 'ui-orchestration',

  service: "Tunnel de commande canonique : récapitulatif, identité, point de retrait, paiement et confirmation en cartes indépendantes.",

  perimeter: {
    in:  ['fichiers js/* annotes @domain checkout', 'présentation responsive du tunnel checkout'],
    out: ['logique backend equivalente (repo komerce-backend, feature orders)'],
  },

  files: {
    js: [
      '../js/b-checkout-render.js',
      '../js/b-checkout.js',
    ],
    css: [
      '../css/checkout-vertical-rail.css',
    ],
    tests: [
      '../tests/unit/b-checkout.test.js',
      // teste b-checkout.js directement (require réel) ; mocke b-checkout-render.js
      // en tant que collaborateur (normal), ne teste donc pas ce fichier en direct.
      // (décoy ../../../tests/unit/b-checkout-pure.test.js supprimé 2026-07-09 :
      // 0 import réel, logique recopiée. Couverture réelle des fonctions
      // pures désormais dans b-checkout.test.js — cf. describe('getDefaultPhoneCodeForZone')
      // et describe('délégation téléphone (b-phone.js)') — et dans b-phone.test.js.)
    ],
  },

  docs: [],

  contract: {
    exposes: [],
    // Migré depuis exposes (audit 2026-07-06, lot UNPARSEABLE) : export JS
    // interne, pas une route HTTP.
    internalApi: [
      'b-checkout.js (orchestration checkout, validation commande)',
      'checkout-vertical-rail.css (projection UI identité → relais → paiement)',
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
    'le skin checkout ne modifie jamais les calculs, contrats API, OTP ou transitions de paiement',
    'le checkout final présente des cartes indépendantes sans fausse progression ; son chrome est neutre, les moyens de paiement restent compacts et le wallet ne devient jamais une étape obligatoire',
  ],

};
