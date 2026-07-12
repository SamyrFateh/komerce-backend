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
    in:  [
      'fichiers js/* annotes @domain catalog',
      'consommation du Product Detail Contract public',
      'etat de selection SKU unique partage mobile/desktop',
      'composition responsive mobile PDC-4 et desktop PDC-5 de la fiche produit',
      'orchestration unique du fetch Product Detail pour la modal',
    ],
    out: ['logique backend equivalente (repo komerce-backend, feature catalog)'],
  },

  files: {
    js: [
      '../js/b-cart-product-open-style.js',
      '../js/b-catalog-desktop-enhancers.js',
      '../js/b-catalog.js',
      '../js/b-modal-desktop-product.js',
      '../js/b-modal-mobile-product.js',
      '../js/b-modal-product-detail-bootstrap.js',
      '../js/b-pager.js',
      '../js/b-product-open-contract.js',
      '../js/b-subcat.js',
      '../js/controllers/home-controller.js',
      '../js/product-store.js',
      '../js/render/render-home-sections.js',
      '../js/render/render-product-card.js',
      '../js/shop-schema.js',
      '../js/taxonomy-no-hardcode.test.js',
      '../js/view-models/modal-selection-model.js',
      '../js/view-models/product-card-model.js',
      '../js/view-models/product-card-view-model.js',
    ],
    css: [
      '../css/hero.css',
    ],
    tests: [
      '../tests/unit/render-home-sections.test.js',
      '../tests/unit/modal-selection-model.test.js',
      '../tests/unit/b-modal-mobile-product.test.js',
      '../tests/unit/b-modal-desktop-product.test.js',
      '../tests/unit/b-modal-product-detail-bootstrap.test.js',
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
    internalApi: [
      'b-catalog.js / setActiveCat / scrollToCategorySection',
      'shop-schema.js / getCategoryIcon / normalizeCategoryKey',
      'b-pager.js',
      'b-subcat.js',
      'home-controller.js / syncRailActiveState / renderSubcatRail',
      'render-product-card.js / renderProductCard',
      'modal-selection-model.js / createModalSelection / selectModalOption',
      'b-modal-product-detail-bootstrap.js / setupProductDetailModal',
      'b-modal-mobile-product.js / renderMobileProductDetail',
      'b-modal-desktop-product.js / renderDesktopProductDetail',
    ],
    consumes: [
      'boutique — b-catalog.js, b-pager.js, b-subcat.js, b-product-open-contract.js importent b-bus.js, b-store.js, b-utils.js, b-scroll-owner.js, b-cart-core.js, b-cart.js, b-modal.js',
      'catalog (backend) — shop-schema.js appelle GET /api/categories',
      'catalog (backend) — b-modal-product-detail-bootstrap.js appelle GET /api/products/:id/detail une seule fois par ouverture produit',
    ],
  },

  authority: 'boutique — modal-selection-model.js reste l owner unique de l etat de selection SKU ; b-modal-product-detail-bootstrap.js possede le chargement du contrat detail pour les deux viewports.',

  invariants: [
    'tout fichier js/* portant @domain catalog doit etre liste dans files.js de ce manifeste',
    'tout CSS/test propre a la home catalogue (hero.css, render-home-sections) doit etre liste dans files.css / files.tests',
    'mobile et desktop consomment le meme Product Detail Contract et le meme modal-selection-model',
    'aucun renderer responsive ne reconstruit un stock par axe',
    'un seul fetch Product Detail et une seule creation de selection alimentent les deux compositions',
  ],
};
