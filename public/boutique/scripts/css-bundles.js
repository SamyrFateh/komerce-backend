/**
 * @komerce-arch-lite
 * @role          css-bundle-config
 * @domain        boutique
 * @layer         build-config
 * @owner         public/boutique/scripts/deploy-css.js
 * @purpose       Source unique de vérité pour la composition des bundles CSS.
 *                Consommé par deploy-css.js (bundler) et audit-boutique-arch.js (gate).
 * @impact-areas  css-pipeline, audit
 * @version       2026-08
 */

'use strict';

/**
 * Chaque entrée décrit un bundle CSS de sortie.
 * - out         : nom du fichier dans css/dist/
 * - files       : noms des sources dans css/ (sans extension .css)
 * - versionFile : fichier propriétaire du ?v=N lorsque le bundle est chargé
 *                 dynamiquement ; par défaut index.html.
 *
 * Ajouter un nouveau fichier CSS ici suffit — deploy-css.js et audit-boutique-arch.js
 * liront automatiquement cette liste.
 */
const BUNDLES = [
  {
    out: 'base.css',
    files: ['tokens', 'reset', 'layout', 'hero', 'hero-ultra-mobile', 'mobile-shell-convergence'],
  },
  {
    out: 'components.css',
    files: ['categories', 'category-cutout-navigation', 'products', 'product-image-loading', 'discovery-rail', 'spike-vertical-shell', 'modal-shell', 'modal-media', 'modal-product', 'modal-product-lot4-hybrid',
            'modal-desktop-density', 'modal-mobile-canonical', 'modal-enriched-content', 'modal-cart-sku-guard',
            'cart', 'interactions', 'modal-mobile-suggestion-actions', 'modal-product-polish', 'modal-suggestion-filter', 'modal-suggestion-card-polish', 'hero-cart-proxy',
            'shared-list-side-cart', 'shared-list-side-cart-responsive', 'shared-list-library-remove',
            'shared-list-lists-tab',
            'identity', 'paypal', 'wallet', 'komerce', 'notifications', 'checkout-vertical-rail',
            'mobile-catalog-convergence', 'mobile-cart-convergence'],
  },
  {
    out: 'desktop.css',
    files: ['boutique-desktop', 'side-cart-desktop-polish', 'category-cutout-navigation-desktop', 'responsive-desktop-matrix'],
  },
  {
    out: 'checkout-desktop-v2.css',
    files: ['checkout-desktop-v2'],
    versionFile: 'js/checkout-desktop-style.js',
  },
  {
    out: 'discovery-desktop-v2.css',
    files: ['discovery-desktop-v2'],
    versionFile: 'js/discovery-desktop-style.js',
  },
];

module.exports = { BUNDLES };
