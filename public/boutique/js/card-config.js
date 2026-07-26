/**
 * @komerce-arch-lite
 * @role          boutique-card-config
 * @domain        catalog
 * @layer         ui-component
 * @owner         public/boutique/js/b-catalog.js
 * @purpose       supports public/boutique/js/b-catalog.js
 * @impact-areas  boutique
 * @version       2026-06
 */
'use strict';

/**
 * @module card-config
 * @brief Configuration dÃ©clarative du rendu des cartes produit Komerce.
 *
 * Ce fichier est la SOURCE DE VÃ‰RITÃ‰ pour la logique "quelle donnÃ©e va oÃ¹"
 * sur une carte produit. Il pilote :
 *   - la preview admin (ProductsView.js)
 *   - Ã  terme : la carte boutique publique via resolveProductCardModel()
 *
 * RÃˆGLES STRICTES :
 *   - Pas de HTML ici.
 *   - Pas de JS dynamique (eval, new Function, expression libre).
 *   - Sources limitÃ©es Ã  ALLOWED_SOURCES (whitelist).
 *   - Conditions limitÃ©es Ã  ALLOWED_CONDITIONS.
 *   - Toujours un fallback si config absente, invalide ou incomplÃ¨te.
 *
 * Pour brancher une config DB Ã  l'avenir : remplacer DEFAULT_CARD_CONFIG
 * par la valeur retournÃ©e par /api/card-config, en passant par validateCardConfig().
 *
 * @version 1
 * @owner card-config.js
 */

'use strict';

// â”€â”€â”€ Whitelist des sources autorisÃ©es â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const ALLOWED_SOURCES = new Set([
  'product.name',
  'product.image_url',
  'product.price_kmf',
  'product.price_aed',
  'product.category',
  'product.subcategory',
  'product.badge',
  'product.promo_pct',
  'product.stock',
  'product.is_available',
  'category.image_url',
  'category.theme_token',
  'category.accent_token',
]);

// â”€â”€â”€ Whitelist des conditions autorisÃ©es â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const ALLOWED_CONDITIONS = new Set([
  'always',
  'not_empty',
  'gt_zero',
  'lte_zero',
  'is_false',
]);

// â”€â”€â”€ Config par dÃ©faut versionnÃ©e â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** @type {CardConfig} */
export const DEFAULT_CARD_CONFIG = {
  version: 1,
  template: 'standard_card_v1',

  image: {
    source: 'product.image_url',
    fallback: ['category.image_url', '/images/placeholder-product.png'],
  },

  title: {
    source: 'product.name',
    visible: true,
  },

  subtitle: {
    source: 'product.subcategory',
    fallback: 'product.category',
    visible: true,
  },

  price: {
    source: 'product.price_kmf',
    format: 'kmf',
    visible: true,
  },

  badges: [
    {
      type: 'promo',
      source: 'product.promo_pct',
      condition: 'gt_zero',
      format: '-{value}%',
    },
    {
      type: 'text',
      source: 'product.badge',
      condition: 'not_empty',
    },
    {
      type: 'stock',
      source: 'product.stock',
      condition: 'lte_zero',
      format: 'Rupture',
    },
  ],

  stock: {
    source: 'product.stock',
    visible: false,
    show_when: 'lte_zero',
  },

  theme: {
    source: 'category.theme_token',
    accent: 'category.accent_token',
  },
};

// â”€â”€â”€ Validation de config externe (future DB) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Valide une config issue d'une source externe (DB, API).
 * Retourne la config si valide, DEFAULT_CARD_CONFIG sinon.
 *
 * @param {unknown} config
 * @returns {CardConfig}
 */
export function validateCardConfig(config) {
  try {
    if (!config || typeof config !== 'object') return DEFAULT_CARD_CONFIG;
    if (config.version !== 1) return DEFAULT_CARD_CONFIG;
    if (typeof config.template !== 'string') return DEFAULT_CARD_CONFIG;

    // VÃ©rifier les sources dÃ©clarÃ©es
    const sourcesToCheck = [];
    if (config.image?.source)    sourcesToCheck.push(config.image.source);
    if (config.title?.source)    sourcesToCheck.push(config.title.source);
    if (config.subtitle?.source) sourcesToCheck.push(config.subtitle.source);
    if (config.price?.source)    sourcesToCheck.push(config.price.source);
    if (config.theme?.source)    sourcesToCheck.push(config.theme.source);
    if (Array.isArray(config.badges)) {
      config.badges.forEach(b => {
        if (b?.source) sourcesToCheck.push(b.source);
        if (b?.condition && !ALLOWED_CONDITIONS.has(b.condition)) {
          throw new Error(`Condition non autorisÃ©e : ${b.condition}`);
        }
      });
    }

    for (const src of sourcesToCheck) {
      if (src && !ALLOWED_SOURCES.has(src)) {
        throw new Error(`Source non autorisÃ©e : ${src}`);
      }
    }

    return config;
  } catch (e) {
    console.warn('[card-config] Config invalide, fallback par dÃ©faut :', e.message);
    return DEFAULT_CARD_CONFIG;
  }
}
