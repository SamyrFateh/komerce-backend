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
 * - out   : nom du fichier dans css/dist/
 * - files : noms des sources dans css/ (sans extension .css)
 *
 * Ajouter un nouveau fichier CSS ici suffit — deploy-css.js et audit-boutique-arch.js
 * liront automatiquement cette liste.
 */
const BUNDLES = [
  {
    out: 'base.css',
    files: ['tokens', 'reset', 'layout', 'hero'],
  },
  {
    out: 'components.css',
    files: ['categories', 'category-cutout-navigation', 'products', 'modal-shell', 'modal-media', 'modal-product', 'modal-product-lot4-hybrid',
            'modal-mobile-canonical', 'modal-enriched-content', 'modal-cart-sku-guard',
            'cart', 'interactions', 'modal-mobile-suggestion-actions', 'modal-product-polish', 'hero-cart-proxy',
            'shared-list-side-cart', 'shared-list-side-cart-responsive', 'shared-list-library-remove',
            'shared-list-lists-tab',
            'share-cart', 'identity', 'paypal', 'wallet', 'komerce', 'notifications', 'checkout-vertical-rail'],
  },
  {
    out: 'desktop.css',
    files: ['boutique-desktop', 'category-cutout-navigation-desktop'],
  },
];

module.exports = { BUNDLES };
