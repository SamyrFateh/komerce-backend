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

  service: 'Maintenir le panier personnel local puis afficher le suivi des commandes créées avec leurs documents essentiels disponibles.',
  perimeter: {
    in: [
      'état et persistance du panier personnel',
      'quantités, mini-panier et badge panier',
      'projection client de l historique et de la timeline commande',
      'projection contextualisée des factures, remboursements et du solde wallet positif dans une commande appartenant à la session',
      'signal visuel actionnable tant qu une commande est disponible au relais',
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
      '../js/cart-public-api.js',
      '../js/b-mini-cart.js',
      '../js/b-tracking.js',
    ],
    css: [
      '../css/cart.css',
      '../css/mobile-cart-convergence.css',
    ],
    tests: [
      '../tests/unit/b-tracking.test.js',
      '../tests/unit/b-tracking-loading-states.test.js',
      '../tests/unit/b-cart-core.test.js',
      '../tests/unit/b-cart.test.js',
      '../tests/unit/cart-public-api-boundary.test.js',
      '../tests/unit/b-mini-cart.test.js',
      '../tests/unit/mobile-cart-convergence.test.js',
    ],
  },

  docs: [],
  contract: {
    exposes: [],
    internalApi: [
      'b-cart-core.js / cartQty / cartTotal / saveCart / updateCartBadge',
      'b-cart.js / addToCart / setQty / openCart / closeCart / renderCart',
      'cart-public-api.js / quickAdd / quickRemove / openCartWithHighlight / getProductCartSummary — frontière publique stable pour consommateurs cross-feature',
      'b-tracking.js / buildTimeline / renderOrdersHistory / renderOrderDetail',
    ],
    consumes: [
      'catalog — produit, image et catégorie',
      'platform-ops — bus, store, client API et utilitaires',
      'auth-identity — identité et téléphone pour retrouver les commandes',
      'logistics — statuts de transit affichés en lecture',
      'documents — factures et reçus de remboursement privés filtrés par référence de commande',
      'wallet — lecture du solde courant sans historique de mouvements',
      'notifications-client — navigation depuis le bandeau et urgence retrait',
      'shared-cart — b-cart.js et b-tracking.js consomment uniquement shared-cart-surface-api.js / shared-cart-library-api.js',
    ],
  },
  authority: 'boutique — ce slice possède l intention d achat locale et sa projection de suivi, jamais la vérité stock ni la machine de statut.',
  invariants: [
    'total panier dérivé uniquement des lignes réellement persistées',
    'une mutation panier synchronise état, badge, lignes et total avant toute ouverture de checkout',
    'le drawer fermé est invisible et absent de l arbre d accessibilité ; une seule action Commander est exposée par contexte',
    'Commander et payer utilisent l accent commerce ; suivre utilise l action de confirmation et les actions réversibles restent secondaires',
    'une répétition UI ne crée pas une seconde commande par elle-même',
    'le suivi ne modifie jamais le statut de commande',
    'la timeline reflète les statuts canoniques reçus du backend',
    'la recherche publique par référence ne charge ni document privé ni solde wallet',
    'ouvrir Mes commandes sans identité affiche directement la recherche publique et ne déclenche ni appel privé aux commandes ni envoi d OTP',
    'un 401 ou 403 après restauration d une identité affiche un état Session expirée distinct et la réidentification reste volontaire',
    'un compte authentifié sans commande affiche un état vide honnête, distinct du parcours anonyme',
    'une commande authentifiée n\'affiche que les factures et remboursements téléchargeables, plus le solde wallet strictement positif',
    'la recherche d historique client partage le défaut téléphonique +269 avec l identité, sans demander les champs de profil inutiles à une simple consultation',
    'le suivi et l historique utilisent sur desktop une composition dédiée sans étirer le formulaire de recherche',
    'une commande disponible au relais est mise en évidence jusqu au retrait indépendamment de l acquittement du bandeau',
  ],
};
