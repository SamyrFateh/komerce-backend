/**
 * @feature       platform-ops
 * @type          transversal
 * @domain        boutique
 * @status        production
 * @owner         boutique
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      scripts/feature-registry-check.js
 */
'use strict';

module.exports = {
  name: 'platform-ops',
  type: 'transversal',
  domain: 'boutique',
  status: 'production',
  owner: 'boutique',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',
  canonicalFeature: 'platform-ops',
  sliceKind: 'frontend-transversal',

  service: 'Socle et shell techniques de la Boutique : entrée, état partagé, bus, API client, navigation et layout global.',
  perimeter: {
    in: [
      'bootstrap de page et orchestration UI globale',
      'bus, store, client API, utilitaires et ownership du scroll',
      'navigation, anti-FOUC et composition responsive globale',
      'adaptations visuelles globales mobile et desktop',
      'tokens, reset, layout et interactions transverses',
    ],
    out: [
      'vérité produit, panier, paiement ou commande',
      'règles métier propres aux slices consommatrices',
    ],
  },

  files: {
    boutique: [
      '../js/main.js',
      '../js/komerce-api.js',
      '../js/b-store.js',
      '../js/b-bus.js',
      '../js/b-utils.js',
      '../js/b-scroll-owner.js',
      '../js/b-boutique-wow-style.js',
      '../js/anti-fouc.js',
      '../js/hero-bootstrap.js',
      '../js/b-nav.js',
      '../js/boutique.js',
      '../js/b-desktop-global-cart-access.js',
      '../js/b-desktop-sidebar.js',
      '../js/b-desktop-upgrade.js',
      '../js/b-greeting.js',
      '../js/b-home-premium-v1.js',
      '../js/card-config.js',
    ],
    css: [
      '../css/tokens.css',
      '../css/reset.css',
      '../css/layout.css',
      '../css/boutique-desktop.css',
      '../css/interactions.css',
    ],
    assets: [
      '../index.html',
    ],
  },

  docs: [],
  contract: {
    exposes: [],
    internalApi: [
      'b-bus.js / bus',
      'b-store.js / state / dom',
      'b-utils.js / API et formatage',
      'b-scroll-owner.js / ownership scroll',
      'b-nav.js / navigation globale',
    ],
    consumes: [
      'auth-identity — état de session affiché',
      'catalog — navigation vers la découverte produit',
      'orders — accès au panier et au suivi',
      'wallet — accès à la surface wallet',
    ],
  },
  authority: 'boutique — le shell compose les surfaces mais ne possède aucune vérité métier.',
  invariants: [
    'un seul bus, un seul store et un seul client API partagés',
    'le shell ne recalcule ni prix, ni stock, ni statut métier',
    'les adaptations responsive globales restent sans logique métier',
    'les tokens et règles de layout transverses ont un propriétaire unique',
  ],
};
