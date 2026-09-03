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

  // Décision produit 2026-08 — résolution de l'ONTOLOGY GAP O4
  // checkout-orders-boutique-coverage : le checkout boutique est une
  // projection/orchestration de la feature canonique orders. Son service
  // principal est de transformer une sélection en commande ; payment est une
  // capacité traversée pour l'encaissement, pas l'owner du tunnel complet.
  // Le domaine frontend checkout reste autonome pour sa gouvernance locale
  // (renderers, responsive, tests), sans créer de micro-feature backend.
  canonicalFeature: 'orders',
  sliceKind: 'ui-orchestration',

  service: "Tunnel de commande canonique : récapitulatif, identité, point de retrait, paiement et confirmation en cartes indépendantes.",

  perimeter: {
    in:  [
      'fichiers js/* annotes @domain checkout',
      'présentation responsive du tunnel checkout',
      'projection desktop V2 du checkout : récapitulatif lisible, colonne transactionnelle prioritaire et scroll vertical unique',
      'localisation cartographique du relais sélectionné avant confirmation de la commande',
      'projection desktop des produits récemment consultés sous le récapitulatif du panier personnel',
      'projection desktop de suggestions (moteur recommendations) sous le récapitulatif d\'un checkout de liste partagée — freeze produit 22-08-2026',
    ],
    out: [
      'cycle de vie backend de la commande (feature orders, owner canonique)',
      'encaissement Stripe/PayPal/cash (feature payments, capacité consommée)',
      'calcul de classement des suggestions (feature recommendations, owner canonique — checkout consomme GET /api/boutique/suggestions sans le posséder)',
    ],
  },

  files: {
    js: [
      '../js/b-checkout-render.js',
      '../js/b-checkout.js',
      '../js/checkout-desktop-style.js',
    ],
    css: [
      '../css/checkout-vertical-rail.css',
      '../css/checkout-desktop-v2.css',
    ],
    tests: [
      '../tests/unit/b-checkout.test.js',
      '../tests/unit/b-checkout-render.test.js',
      '../tests/unit/checkout-responsive-css.test.js',
      '../tests/unit/checkout-desktop-style.test.js',
      '../tests/unit/checkout-desktop-v2-css.test.js',
      // b-checkout.test.js teste l'orchestrateur réel en mockant ses
      // collaborateurs ; b-checkout-render.test.js couvre le renderer DOM pur.
    ],
  },

  docs: [
    '../../../docs/doctrine/CHECKOUT_UNIFIED_ATTACK.md',
  ],

  contract: {
    exposes: [],
    // Migré depuis exposes (audit 2026-07-06, lot UNPARSEABLE) : export JS
    // interne, pas une route HTTP.
    internalApi: [
      'b-checkout.js (orchestration checkout, validation commande)',
      'checkout-vertical-rail.css (projection UI identité → relais → paiement)',
      'checkout-desktop-v2.css (projection desktop V2, sans second scroll transactionnel)',
    ],
    consumes: [
      'orders — feature canonique : création et cycle de vie de la commande',
      'auth — b-checkout.js importe b-identity.js, b-phone.js',
      'boutique — b-checkout.js importe b-bus.js, b-store.js, b-utils.js, b-cart-core.js, b-cart.js, b-scroll-owner.js',
      'catalogue — historique local canonique state.viewedHistory et produits déjà chargés',
      'payment — b-checkout.js importe b-paypal.js ; l’encaissement reste possédé par payments',
      'wallet — b-checkout.js appelle /api/wallet',
      'recommendations — b-checkout.js appelle GET /api/boutique/suggestions (signal cart_product_ids) pour le rail de suggestions du checkout de liste partagée, freeze 22-08-2026',
    ],
  },

  authority: 'boutique — tout changement de perimetre de ce domaine doit etre reflete ici ; orders reste l’owner canonique du service métier.',

  invariants: [
    'tout fichier js/* portant @domain checkout doit etre liste dans files.js de ce manifeste',
    'le skin checkout ne modifie jamais les calculs, contrats API, OTP ou transitions de paiement',
    'orders est l’owner canonique du checkout ; payments ne possède que l’encaissement et ses intégrations spécifiques',
    'le checkout final présente des cartes indépendantes sans fausse progression ; son chrome est neutre, les moyens de paiement restent compacts et le wallet ne devient jamais une étape obligatoire',
    'le checkout rend sa coque et son récapitulatif immédiatement, indépendamment du chargement des SDK de paiement',
    'sur desktop, la colonne transactionnelle ne possède aucun scroll vertical imbriqué : le body checkout reste l’unique scroll owner du tunnel',
    'une intention Acheter maintenant finalise uniquement la ligne courante explicitement transmise, sans absorber le panier personnel existant',
    'le rayon récemment consulté est limité au checkout du panier personnel ; il ne sélectionne jamais une variante implicitement et ne modifie CheckoutSelection qu’après une action Ajouter explicite',
    'le rail de suggestions (checkout de liste partagée, freeze 22-08-2026) ne modifie JAMAIS CheckoutSelection.items ni le récapitulatif figé affiché — tout ajout va exclusivement dans state.cart (panier personnel, entité séparée), jamais fusionné avec la liste payée. Toast distinct ("Ajouté à votre panier personnel") pour ne jamais laisser croire à une modification de la liste figée',
    'le rail de suggestions du checkout de liste partagée échoue silencieusement (jamais un throw, jamais un état de chargement bloquant) — une suggestion indisponible ne doit jamais dégrader le reste du tunnel checkout',
    'les CTA de récapitulatif et de paiement utilisent l accent commerce ; le chrome reste neutre et les couleurs propres aux moyens de paiement sont préservées',
    'le relais sélectionné expose avant confirmation un lien cartographique discret ; son activation ne change jamais le relais et n ouvre jamais le picker',
  ],

};
