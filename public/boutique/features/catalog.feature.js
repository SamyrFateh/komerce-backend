/**
 * @feature       catalog
 * @type          feature
 * @domain        catalog
 * @status        production
 * @owner         boutique
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      scripts/feature-registry-check.js
 */
'use strict';

module.exports = {
  name: 'catalog',
  type: 'feature',
  domain: 'catalog',
  status: 'production',
  owner: 'boutique',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',
  canonicalFeature: 'catalog',
  sliceKind: 'frontend-slice',

  service: 'Navigation et affichage catalogue : catégories, produits, cartes, favoris et fiche produit.',
  perimeter: {
    in: [
      'navigation et découverte produit',
      'Product Detail Contract public',
      'état de sélection SKU partagé mobile/desktop',
      'rendu des catégories, sections, favoris et cartes produit',
      'adaptations visuelles responsive de la découverte produit',
    ],
    out: [
      'shell et layout globaux (platform-ops)',
      'panier personnel et commande (orders)',
      'classement produit backend (recommendations)',
    ],
  },

  files: {
    js: [
      '../js/b-cart-product-open-style.js',
      '../js/b-favs.js',
      '../js/b-catalog-desktop-enhancers.js',
      '../js/b-catalog.js',
      '../js/b-desktop-global-cart-access.js',
      '../js/b-desktop-sidebar.js',
      '../js/b-desktop-upgrade.js',
      '../js/b-greeting.js',
      '../js/b-home-premium-v1.js',
      '../js/card-config.js',
      '../js/hero-bootstrap.js',
      '../js/b-pager.js',
      '../js/b-product-open-contract.js',
      '../js/b-subcat.js',
      '../js/controllers/home-controller.js',
      '../js/product-store.js',
      '../js/render/render-categories.js',
      '../js/render/category-shelf-visuals.js',
      '../js/market-context.js',
      '../js/render/render-home-sections.js',
      '../js/render/render-product-card.js',
      '../js/shop-schema.js',
      '../js/taxonomy-no-hardcode.test.js',
      '../js/view-models/product-card-model.js',
      '../js/view-models/product-card-view-model.js',
    ],
    css: [
      '../css/hero.css',
      '../css/hero-ultra-mobile.css',
      '../css/categories.css',
      '../css/products.css',
      '../css/category-cutout-navigation.css',
      '../css/mobile-catalog-convergence.css',
      '../css/category-cutout-navigation-desktop.css',
    ],
    assets: [
      '../../images/komerce_hero_catalog_canonical_v4.webp',
      '../../images/komerce_hero_catalog_canonical_v5_mobile.webp',
      '../categories/cat-all-v3.webp',
      '../categories/cat-soldes-v3.webp',
      '../categories/cat-mode-v3.webp',
      '../categories/cat-maison-v3.webp',
      '../categories/cat-tech-v3.webp',
      '../categories/cat-bricolage-v3.webp',
      '../categories/cat-perso-v3.webp',
      '../categories/cat-auto-v3.webp',
    ],
    tests: [
      '../tests/unit/hero-ultra-mobile.test.js',
      '../tests/unit/b-favs.test.js',
      '../tests/unit/b-greeting.test.js',
      '../tests/unit/render-home-sections.test.js',
      '../tests/unit/render-categories.test.js',
      '../tests/unit/hero-desktop-panorama.test.js',
      '../tests/unit/category-subcategory-continuity.test.js',
      '../tests/unit/category-cutout-assets-integrity.test.js',
      '../tests/unit/products.test.js',
      '../tests/unit/mobile-catalog-convergence.test.js',
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
      'render-categories.js / renderCategories',
      'render-product-card.js / renderProductCard',
      'modal-selection-model.js / createModalSelection / selectModalOption',
    ],
    consumes: [
      'platform-ops — bus, store, utilitaires et scroll',
      'orders — actions panier depuis les surfaces produit',
      'auth-identity — salutation best-effort de session',
      'catalog (backend) — catégories et Product Detail Contract',
    ],
  },

  authority: 'boutique — catalog possède la découverte produit ; modal-selection-model possède seul la sélection SKU.',
  invariants: [
    'tout fichier js portant @domain catalog est listé dans ce manifeste ou modal-product',
    'mobile et desktop consomment le même Product Detail Contract',
    'aucun renderer ne reconstruit un stock par axe',
    'les adaptations visuelles du catalogue ne deviennent jamais un shell applicatif global',
    'les catégories restent sur une ligne et défilent horizontalement quand la largeur disponible ne suffit pas',
    'sur desktop premium, catégories et sous-catégories forment un stack compact de même largeur sans modifier le rail mobile',
    'les huit images du rail sont déclarées une seule fois dans shop-schema et partagent un format panoramique cohérent',
    'le hero desktop conserve son texte et les deux visages lisibles avec ou sans réserve du side cart, sans modifier le hero mobile',
    'chaque bouton favori expose son état réel par aria-pressed et un libellé Ajouter ou Retirer synchronisé',
    'ajout, achat et promotion utilisent l accent commerce ; l état déjà au panier reste positif et le favori actif reste éditorial',
    'la vue Favoris conserve sur desktop une composition intentionnelle pour les états vide et un seul produit',
  ],
};
