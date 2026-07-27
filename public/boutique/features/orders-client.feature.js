/**
 * @feature       orders-client
 * @type          feature
 * @domain        boutique
 * @status        production
 * @owner         boutique
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      scripts/feature-registry-check.js
 *
 * Projection frontend de la feature canonique orders : intention d'achat
 * locale avant création, puis consultation du cycle de la commande créée.
 */
'use strict';

module.exports = {
  name: 'orders-client',
  type: 'feature',
  domain: 'boutique',
  status: 'production',
  owner: 'boutique',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',
  canonicalFeature: 'orders',
  sliceKind: 'frontend-slice',

  service: 'Maintenir le panier personnel local puis afficher le suivi des commandes créées.',
  perimeter: {
    in: [
      'état et persistance du panier personnel',
      'quantités, mini-panier et badge panier',
      'projection client de l historique et de la timeline commande',
    ],
    out: [
      'vérité produit et stock (catalog)',
      'panier partagé (shared-cart)',
      'encaissement (payments)',
      'transport physique (logistics)',
    ],
  },

  files: {
    boutique: [
      '../js/b-cart-core.js',
      '../js/b-cart-pill.js',
      '../js/b-cart-stepper-guard.js',
      '../js/b-cart.js',
      '../js/cart-product-summary.js',
      '../js/b-mini-cart.js',
      '../js/b-tracking.js',
    ],
    css: [
      '../css/cart.css',
    ],
  },

  docs: [],
  contract: {
    exposes: [],
    internalApi: [
      'b-cart-core.js / cartQty / cartTotal / saveCart / updateCartBadge',
      'b-cart.js / addToCart / setQty / openCart / closeCart / renderCart',
      'b-tracking.js / buildTimeline / renderOrdersHistory / renderOrderDetail',
    ],
    consumes: [
      'catalog — produit, image et catégorie',
      'platform-ops — bus, store, client API et utilitaires',
      'auth-identity — identité et téléphone pour retrouver les commandes',
      'logistics — statuts de transit affichés en lecture',
    ],
  },
  authority: 'boutique — ce slice possède l intention d achat locale et sa projection de suivi, jamais la vérité stock ni la machine de statut.',
  invariants: [
    'total panier dérivé uniquement des lignes réellement persistées',
    'une répétition UI ne crée pas une seconde commande par elle-même',
    'le suivi ne modifie jamais le statut de commande',
    'la timeline reflète les statuts canoniques reçus du backend',
  ],
};
