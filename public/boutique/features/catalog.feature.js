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
  },

  contract: {
    exposes: [
      'b-catalog.js / setActiveCat / scrollToCategorySection',
      'shop-schema.js / getCategoryIcon / normalizeCategoryKey',
      'b-pager.js',
      'b-subcat.js',
      'home-controller.js / syncRailActiveState / renderSubcatRail',
      'render-product-card.js / renderProductCard',
      '/api/categories (shop-schema.js)',
    ],
    consumes: [
      'boutique — b-catalog.js, b-pager.js, b-subcat.js, b-product-open-contract.js importent b-bus.js, b-store.js, b-utils.js, b-scroll-owner.js, b-cart-core.js, b-cart.js, b-modal.js',
    ],
  },

  authority: 'boutique — tout changement de perimetre de ce domaine doit etre reflete ici.',

  invariants: [
    'tout fichier js/* portant @domain catalog doit etre liste dans files.js de ce manifeste',
  ],

};
