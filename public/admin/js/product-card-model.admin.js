/**
 * @komerce-arch
 * @role          admin-product-card-view-model
 * @domain        admin-dashboard
 * @layer         view-model
 * @criticality   medium
 * @inputs        product_object, category_object, card_config_v1
 * @outputs       resolved_card_model (imageUrl, title, subtitle, priceLabel, badges, stockLabel, themeToken, accentToken, isAvailable)
 * @depends       none
 * @used-by       views/ProductsView.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      none
 * @impact-areas  product-catalog, admin-dashboard
 * @version       2026-06
 */

'use strict';
/**
 * @module product-card-model.admin
 * @brief Version autonome de resolveProductCardModel pour le dashboard admin.
 *
 * Ce fichier est chargé comme classic <script> dans /admin/index.html.
 * Il expose window.KProductCardModel pour être consommé par ProductsView.js
 * et tout autre script admin sans dépendance ES module.
 *
 * La logique est la MÊME que public/boutique/js/view-models/product-card-model.js.
 * Si vous modifiez les règles ici, répercutez dans product-card-model.js (boutique).
 *
 * RÈGLES STRICTES : pas de HTML, pas d'eval, pas de new Function.
 * Sources et conditions limitées aux whitelists ci-dessous.
 *
 * @version 1
 * @owner product-card-model.admin.js
 */

(function (global) {
  'use strict';

  // ─── Whitelist des sources autorisées ───────────────────────────────────────

  const ALLOWED_SOURCES = new Set([
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

  // ─── Whitelist des conditions autorisées ────────────────────────────────────

  const ALLOWED_CONDITIONS = new Set([
    'always',
    'not_empty',
    'gt_zero',
    'lte_zero',
    'is_false',
  ]);

  // ─── Config par défaut ──────────────────────────────────────────────────────

  const DEFAULT_CARD_CONFIG = {
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
      { type: 'promo', source: 'product.promo_pct', condition: 'gt_zero',  format: '-{value}%' },
      { type: 'text',  source: 'product.badge',     condition: 'not_empty' },
      { type: 'stock', source: 'product.stock',      condition: 'lte_zero', format: 'Rupture'   },
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

  // ─── Helpers internes ────────────────────────────────────────────────────────

  const PLACEHOLDER_IMAGE = '/images/placeholder-product.png';
  const DEFAULT_NAME      = 'Produit Komerce';

  function resolveSource(source, product, category) {
    if (!source || !ALLOWED_SOURCES.has(source)) return undefined;
    const parts = source.split('.');
    const ns = parts[0], field = parts[1];
    if (ns === 'product')  return product  ? product[field]  : undefined;
    if (ns === 'category') return category ? category[field] : undefined;
    return undefined;
  }

  function evalCondition(condition, value) {
    switch (condition) {
      case 'always':    return true;
      case 'not_empty': return value !== null && value !== undefined && String(value).trim() !== '';
      case 'gt_zero':   return Number.isFinite(Number(value)) && Number(value) > 0;
      case 'lte_zero':  return Number.isFinite(Number(value)) && Number(value) <= 0;
      case 'is_false':  return value === false;
      default:          return false;
    }
  }

  function formatKmf(kmf) {
    const n = Number(kmf);
    if (!Number.isFinite(n) || n <= 0) return 'Prix à confirmer';
    return new Intl.NumberFormat('fr-FR').format(Math.round(n)) + ' KMF';
  }

  function formatBadgeLabel(format, value) {
    if (!format) return String(value != null ? value : '');
    return format.replace('{value}', String(Math.round(Number(value))));
  }

  function resolveImage(imageCfg, product, category) {
    if (!imageCfg) return PLACEHOLDER_IMAGE;
    let primary = resolveSource(imageCfg.source, product, category);
    if (primary && typeof primary === 'string' && primary.trim()) return primary.trim();

    const fallbacks = Array.isArray(imageCfg.fallback) ? imageCfg.fallback : [];
    for (let i = 0; i < fallbacks.length; i++) {
      let fb = fallbacks[i];
      if (ALLOWED_SOURCES.has(fb)) {
        const val = resolveSource(fb, product, category);
        if (val && typeof val === 'string' && val.trim()) return val.trim();
      } else if (typeof fb === 'string' && fb.trim()) {
        return fb.trim();
      }
    }
    return PLACEHOLDER_IMAGE;
  }

  function resolveBadges(badgesCfg, product, category) {
    if (!Array.isArray(badgesCfg)) return [];
    const out = [];
    for (let i = 0; i < badgesCfg.length; i++) {
      const b = badgesCfg[i];
      if (!b || typeof b !== 'object') continue;
      const condition = b.condition || 'always';
      const value     = resolveSource(b.source, product, category);
      if (!evalCondition(condition, value)) continue;
      const label = b.format
        ? formatBadgeLabel(b.format, value)
        : (value != null ? String(value) : '');
      if (!label) continue;
      out.push({ type: b.type || 'text', label: label });
    }
    return out;
  }

  function resolveSubtitle(subtitleCfg, product, category) {
    if (!subtitleCfg) return '';
    let primary = resolveSource(subtitleCfg.source, product, category);
    if (primary && String(primary).trim()) return String(primary).trim();
    if (subtitleCfg.fallback) {
      let fb = resolveSource(subtitleCfg.fallback, product, category);
      if (fb && String(fb).trim()) return String(fb).trim();
    }
    return '';
  }

  // ─── Point d'entrée public ───────────────────────────────────────────────────

  /**
   * Résout le modèle de carte produit.
   *
   * @param {Object} product   - Données produit brutes
   * @param {Object} category  - Objet catégorie brut (depuis /api/categories)
   * @param {Object} [config]  - Config déclarative (défaut = DEFAULT_CARD_CONFIG)
   * @returns {{ imageUrl, title, subtitle, priceLabel, badges, stockLabel, themeToken, accentToken, isAvailable }}
   */
  function resolve(product, category, config) {
    product  = product  || {};
    category = category || {};
    const cfg  = (config && config.version === 1) ? config : DEFAULT_CARD_CONFIG;

    const imageUrl    = resolveImage(cfg.image, product, category);
    const rawTitle    = resolveSource(cfg.title && cfg.title.source, product, category);
    const title       = (rawTitle && String(rawTitle).trim()) ? String(rawTitle).trim() : DEFAULT_NAME;
    const subtitle    = resolveSubtitle(cfg.subtitle, product, category);
    const rawPrice    = resolveSource(cfg.price && cfg.price.source, product, category);
    const priceLabel  = (cfg.price && cfg.price.format === 'kmf')
      ? formatKmf(rawPrice)
      : (rawPrice != null ? String(rawPrice) : 'Prix à confirmer');
    const badges      = resolveBadges(cfg.badges, product, category);
    const rawStock    = resolveSource(cfg.stock && cfg.stock.source, product, category);
    const showStock   = cfg.stock && cfg.stock.show_when
      ? evalCondition(cfg.stock.show_when, rawStock)
      : Boolean(cfg.stock && cfg.stock.visible);
    const stockLabel  = (showStock && rawStock !== undefined) ? String(rawStock) : '';
    const themeToken  = resolveSource(cfg.theme && cfg.theme.source, product, category);
    const accentToken = resolveSource(cfg.theme && cfg.theme.accent,  product, category);
    const isAvailable = product.is_available !== false
      && (product.stock == null || Number(product.stock) > 0);

    return {
      imageUrl:    imageUrl,
      title:       title,
      subtitle:    subtitle,
      priceLabel:  priceLabel,
      badges:      badges,
      stockLabel:  stockLabel,
      themeToken:  themeToken  != null ? themeToken  : null,
      accentToken: accentToken != null ? accentToken : null,
      isAvailable: isAvailable,
    };
  }

  // ─── Export global ───────────────────────────────────────────────────────────

  global.KProductCardModel = {
    resolve:            resolve,
    DEFAULT_CARD_CONFIG: DEFAULT_CARD_CONFIG,
    ALLOWED_SOURCES:    ALLOWED_SOURCES,
    ALLOWED_CONDITIONS: ALLOWED_CONDITIONS,
  };

}(window));
