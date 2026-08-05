/**
 * @komerce-arch-lite
 * @role          css-bundle-config
 * @domain        boutique
 * @layer         build-config
 * @owner         public/boutique/scripts/deploy-css.js
 * @purpose       Source unique de vérité pour la composition des bundles CSS.
 *                Consommé par deploy-css.js (bundler) et audit-boutique-arch.js (gate).
 * @impact-areas  css-pipeline, audit
 * @version       2026-07
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
    files: ['categories', 'products', 'modal-shell', 'modal-media', 'modal-product', 'modal-product-lot4-hybrid',
            'modal-mobile-canonical', 'modal-enriched-content', 'modal-cart-sku-guard',
            'cart', 'interactions', 'modal-mobile-suggestion-actions', 'hero-cart-proxy',
            'shared-list-side-cart', 'shared-list-side-cart-responsive', 'share-cart', 'identity', 'paypal', 'wallet', 'komerce'],
  },
  {
    out: 'desktop.css',
    files: ['boutique-desktop'],
  },
];

module.exports = { BUNDLES };
