/**
 * @feature       catalog
 * @type          feature
 * @domain        catalog
 * @status        production
 * @owner         boutique
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      scripts/feature-registry-check.js
 *
 * Manifeste niveau 0 (gouvernance fichiers) pour le domaine frontend
 * "catalog". Genere pour rattacher les modules JS existants (deja annotes
 * @domain catalog dans leur header) a un manifest reel, afin que
 * scripts/feature-registry-check.js cesse de les compter en orphelins.
 */
'use strict';

module.exports = {

  name:     'catalog',
  type:     'feature',
  domain:   'catalog',
  status:   'production',
  owner:    'boutique',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  // Lot O4 (cross-repo feature coverage) : meme identite metier que
  // backend:catalog (service equivalent : navigation/decouverte produit).
  // Preuve fichier : 11/13 fichiers js listes ici sont deja revendiques par
  // backend:catalog.files.boutique ; les 2 restants (b-cart-product-open-style.js,
  // css/hero.css) etaient un ecart factuel comble au meme lot (voir
  // features/catalog.feature.js cote backend).
  canonicalFeature: 'catalog',
  sliceKind: 'frontend-slice',

  service: "Navigation et affichage catalogue (listing, sous-categories, fiches produit, rendu cartes) — tout ce qui touche au parcours de decouverte des produits.",

  perimeter: {
    in:  ['fichiers js/* annotes @domain catalog'],
    out: ['logique backend equivalente (repo komerce-backend, feature catalog)'],
  },

  files: {
    js: [
      '../js/b-cart-product-open-style.js',
      '../js/b-catalog-desktop-enhancers.js',
      '../js/b-catalog.js',
      '../js/b-pager.js',
      '../js/b-product-open-contract.js',
      '../js/b-subcat.js',
      '../js/controllers/home-controller.js',
      '../js/product-store.js',
      '../js/render/render-home-sections.js',
      '../js/render/render-product-card.js',
      '../js/shop-schema.js',
      '../js/taxonomy-no-hardcode.test.js',
      '../js/view-models/product-card-model.js',
      '../js/view-models/product-card-view-model.js',
    ],
    css: [
      // Backfill gouvernance globale (governance/boutique-global-ownership) :
      // hero.css pilote la section hero de la home, périmètre "catalogue vivant"
      // déjà déclaré ci-dessus en perimeter.in.
      '../css/hero.css',
    ],
    tests: [
      '../tests/unit/render-home-sections.test.js',
    ],
  },

  docs: [
    'RAPPORT_HERO_DESKTOP.md',
    'docs/BOUTIQUE_CATEGORY_NAVIGATION_REDESIGN.md',
    'docs/BOUTIQUE_PRODUCT_DISPLAY_CONTRACT.md',
    'docs/MOBILE_BOUTIQUE_FIXES.md',
    'docs/komerce-categories-design.md',
  ],

  contract: {
    exposes: [],
    // Migré depuis exposes (audit 2026-07-06, lot UNPARSEABLE) : exports JS
    // internes, pas des routes HTTP.
    internalApi: [
      'b-catalog.js / setActiveCat / scrollToCategorySection',
      'shop-schema.js / getCategoryIcon / normalizeCategoryKey',
      'b-pager.js',
      'b-subcat.js',
      'home-controller.js / syncRailActiveState / renderSubcatRail',
      'render-product-card.js / renderProductCard',
    ],
    consumes: [
      'boutique — b-catalog.js, b-pager.js, b-subcat.js, b-product-open-contract.js importent b-bus.js, b-store.js, b-utils.js, b-scroll-owner.js, b-cart-core.js, b-cart.js, b-modal.js',
      // Rangé ici et non dans exposes (audit 2026-07-06) : GET /api/categories est une
      // route réelle du backend (routes/categories.js, feature catalog backend),
      // appelée par shop-schema.js — ce n'est pas un endpoint exposé par la boutique.
      'catalog (backend) — shop-schema.js appelle GET /api/categories',
    ],
  },

  authority: 'boutique — tout changement de perimetre de ce domaine doit etre reflete ici.',

  invariants: [
    'tout fichier js/* portant @domain catalog doit etre liste dans files.js de ce manifeste',
    'tout CSS/test propre a la home catalogue (hero.css, render-home-sections) doit etre liste dans files.css / files.tests',
  ],

};
