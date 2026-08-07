/**
 * @feature       shared-cart
 * @type          feature
 * @domain        shared-cart
 * @status        production
 * @owner         boutique
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      scripts/feature-registry-check.js
 */
'use strict';

module.exports = {
  name: 'shared-cart',
  type: 'feature',
  domain: 'shared-cart',
  status: 'production',
  owner: 'boutique',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',
  canonicalFeature: 'shared-cart',
  sliceKind: 'frontend-slice',

  service: 'Liste partagée publiée comme snapshot immuable, projetée dans le side cart / drawer canonique ; achat et paiement passent exclusivement par le checkout canonique.',
  perimeter: {
    in: ['création, activation et rendu d’une liste publiée immuable dans la surface panier canonique'],
    out: ['panier personnel, catalogue vivant et paiement hors contrat partagé'],
  },

  files: {
    js: [
      '../js/b-group-banner.js',
      '../js/b-share-cart.js',
      '../js/group/group-api.js',
      '../js/group/group-checkout-adapter.js',
      '../js/group/group-library-remove.js',
      '../js/group/group-price-variation.js',
      '../js/group/group-side-cart.js',
      '../js/group/group-state.js',
      '../js/b-share-phone-guard.js',
    ],
    css: [
      '../css/hero-cart-proxy.css',
      '../css/share-cart.css',
      '../css/shared-list-side-cart.css',
      '../css/shared-list-side-cart-responsive.css',
      '../css/shared-list-library-remove.css',
      '../css/shared-list-lists-tab.css',
    ],
    tests: [
      '../tests/unit/group-checkout-adapter.test.js',
      '../tests/unit/group-price-variation.test.js',
      '../tests/unit/b-share-phone-guard.test.js',
      '../tests/unit/group-side-cart.test.js',
      '../tests/unit/shared-list-responsive-layout.test.js',
    ],
  },

  docs: ['REFACTOR_SUMMARY.md'],
  contract: {
    exposes: [],
    internalApi: [
      'b-share-cart.js / partage de panier',
      'group-side-cart.js / activation et rendu de la liste partageable dans le side cart / drawer canonique',
      'group-library-remove.js / retrait explicite d’un signet reçu dans Mes listes',
      'group-checkout-adapter.js / pont sélection liste -> checkout canonique',
      'group-price-variation.js / comparaison prix snapshot liste vs prix catalogue actuel (recap checkout)',
      'group-api.js / group-state.js',
    ],
    consumes: [
      'auth — identité et téléphone',
      'platform-ops — bus, store et utilitaires',
      'orders — snapshot explicite du panier personnel',
      'payments — checkout canonique',
    ],
  },
  authority: 'boutique — shared-cart possède seul le cycle groupe et la vue participant.',
  invariants: [
    'contenu, quantités et variantes sont figés dès publication ; seuls les claims évoluent',
    'visiteur en lecture seule hors actions explicitement autorisées',
    'aucun appel au catalogue vivant pour une fiche snapshot partagée',
    'une liste active est l’unique surface panier visible ; le panier personnel reste isolé en état',
    'retirer une liste sauvegardée ne supprime jamais la liste ni son token public',
  ],
};
