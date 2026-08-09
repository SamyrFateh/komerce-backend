/**
 * @komerce-arch-lite
 * @role          catalog-product-card-model
 * @domain        catalog
 * @layer         view-model
 * @owner         public/boutique/js/b-catalog.js
 * @purpose       supports public/boutique/js/b-catalog.js
 * @impact-areas  catalog, product-discovery
 * @version       2026-06
 */
'use strict';

/**
 * @module product-card-model
 * @brief Helper pur de résolution du modèle carte produit Komerce.
 *
 * Responsabilité unique :
 *   Product + Category + CardConfig → CardModel normalisé
 *
 * Ce module est le SEUL endroit où la logique "quelle donnée va où" est
 * implémentée. Il remplace les logiques éparpillées dans :
 *   - buildPreviewHTML() de ProductsView.js (admin)
 *   - buildProductCardViewModel() (boutique, branché progressivement)
 *
 * RÈGLES STRICTES :
 *   - Pas de rendu HTML.
 *   - Pas d'accès DOM.
 *   - Pas d'appel réseau.
 *   - Pas d'eval / new Function.
 *   - Sources lues uniquement depuis la whitelist ALLOWED_SOURCES.
 *   - Toujours un fallback : retourne un modèle valide même si product = {}.
 *
 * @version 1
 * @owner product-card-model.js
 */

'use strict';

import { DEFAULT_CARD_CONFIG, ALLOWED_SOURCES } from '../card-config.js';

// ─── Constantes ───────────────────────────────────────────────────────────────

const PLACEHOLDER_IMAGE = '/images/placeholder-product.svg';
const DEFAULT_NAME      = 'Produit Komerce';

// ─── Résolution de source (whitelist stricte) ─────────────────────────────────

/**
 * Lit une valeur depuis product ou category selon la source déclarée.
 * Retourne undefined si la source n'est pas dans la whitelist.
 *
 * @param {string} source  - ex: 'product.image_url'
 * @param {Object} product
 * @param {Object} category
 * @returns {*}
 */
function resolveSource(source, product, category) {
  if (!source || !ALLOWED_SOURCES.has(source)) return undefined;

  const [ns, field] = source.split('.');
  if (ns === 'product') return product?.[field];
  if (ns === 'category') return category?.[field];
  return undefined;
}

// ─── Évaluation des conditions ────────────────────────────────────────────────

/**
 * @param {string} condition
 * @param {*}      value
 * @returns {boolean}
 */
function evalCondition(condition, value) {
  switch (condition) {
    case 'always':    return true;
    case 'not_empty': return value !== null && value !== undefined && String(value).trim() !== '';
    case 'gt_zero':   return Number.isFinite(Number(value)) && Number(value) > 0;
    case 'lte_zero':  return Number.isFinite(Number(value)) && Number(value) <= 0;
    case 'is_false':  return value === false;
    default:          return false; // condition inconnue = badge masqué
  }
}

// ─── Formatage du prix KMF ────────────────────────────────────────────────────

/**
 * @param {number} kmf
 * @returns {string} ex: "12 500 KMF"
 */
function formatKmf(kmf) {
  const n = Number(kmf);
  if (!Number.isFinite(n) || n <= 0) return 'Prix à confirmer';
  return new Intl.NumberFormat('fr-FR').format(Math.round(n)) + ' KMF';
}

// ─── Formatage de badge ───────────────────────────────────────────────────────

/**
 * @param {string} format  - ex: '-{value}%' ou 'Rupture'
 * @param {*}      value
 * @returns {string}
 */
function formatBadgeLabel(format, value) {
  if (!format) return String(value ?? '');
  return format.replace('{value}', String(Math.round(Number(value))));
}

// ─── Résolution de l'image avec fallback ────────────────────────────────────

/**
 * @param {Object} imageCfg  - config.image
 * @param {Object} product
 * @param {Object} category
 * @returns {string}  URL toujours définie
 */
function resolveImage(imageCfg, product, category) {
  if (!imageCfg) return PLACEHOLDER_IMAGE;

  // Source principale
  const primary = resolveSource(imageCfg.source, product, category);
  if (primary && typeof primary === 'string' && primary.trim()) return primary.trim();

  // Fallbacks en ordre
  const fallbacks = Array.isArray(imageCfg.fallback) ? imageCfg.fallback : [];
  for (const fb of fallbacks) {
    // fb peut être une source déclarée ('category.image_url') ou une URL littérale
    if (ALLOWED_SOURCES.has(fb)) {
      const val = resolveSource(fb, product, category);
      if (val && typeof val === 'string' && val.trim()) return val.trim();
    } else if (typeof fb === 'string' && fb.trim()) {
      return fb.trim(); // URL littérale (ex: placeholder)
    }
  }

  return PLACEHOLDER_IMAGE;
}

// ─── Résolution des badges ────────────────────────────────────────────────────

/**
 * @param {Array}  badgesCfg
 * @param {Object} product
 * @param {Object} category
 * @returns {Array<{type: string, label: string}>}
 */
function resolveBadges(badgesCfg, product, category) {
  if (!Array.isArray(badgesCfg)) return [];

  return badgesCfg.reduce((acc, b) => {
    if (!b || typeof b !== 'object') return acc;

    const condition = b.condition || 'always';
    const value     = resolveSource(b.source, product, category);

    if (!evalCondition(condition, value)) return acc;

    const label = b.format
      ? formatBadgeLabel(b.format, value)
      : (value !== null && value !== undefined ? String(value) : '');

    if (!label) return acc;

    acc.push({ type: b.type || 'text', label });
    return acc;
  }, []);
}

// ─── Résolution du sous-titre ─────────────────────────────────────────────────

function resolveSubtitle(subtitleCfg, product, category) {
  if (!subtitleCfg) return '';

  const primary = resolveSource(subtitleCfg.source, product, category);
  if (primary && String(primary).trim()) return String(primary).trim();

  if (subtitleCfg.fallback) {
    const fb = resolveSource(subtitleCfg.fallback, product, category);
    if (fb && String(fb).trim()) return String(fb).trim();
  }

  return '';
}

// ─── Point d'entrée principal ─────────────────────────────────────────────────

/**
 * Résout le modèle de carte produit à partir de données brutes.
 *
 * @param {Object}     product   - Données produit brutes (API /api/products)
 * @param {Object}     category  - Objet catégorie brut (API /api/categories)
 * @param {CardConfig} [config]  - Config déclarative (défaut = DEFAULT_CARD_CONFIG)
 * @returns {ProductCardModel}
 */
export function resolveProductCardModel(product = {}, category = {}, config = DEFAULT_CARD_CONFIG) {
  // Sécurité : config invalide → fallback silencieux
  const cfg = (config && config.version === 1) ? config : DEFAULT_CARD_CONFIG;

  // Image
  const imageUrl = resolveImage(cfg.image, product, category);

  // Titre
  const rawTitle = resolveSource(cfg.title?.source, product, category);
  const title    = (rawTitle && String(rawTitle).trim()) ? String(rawTitle).trim() : DEFAULT_NAME;

  // Sous-titre
  const subtitle = resolveSubtitle(cfg.subtitle, product, category);

  // Prix
  const rawPrice  = resolveSource(cfg.price?.source, product, category);
  const priceLabel = cfg.price?.format === 'kmf'
    ? formatKmf(rawPrice)
    : (rawPrice != null ? String(rawPrice) : 'Prix à confirmer');

  // Badges
  const badges = resolveBadges(cfg.badges, product, category);

  // Stock
  const rawStock   = resolveSource(cfg.stock?.source, product, category);
  const showStock  = cfg.stock?.show_when
    ? evalCondition(cfg.stock.show_when, rawStock)
    : Boolean(cfg.stock?.visible);
  const stockLabel = showStock && rawStock !== undefined ? String(rawStock) : '';

  // Thème
  const themeToken  = resolveSource(cfg.theme?.source, product, category) ?? null;
  const accentToken = resolveSource(cfg.theme?.accent, product, category) ?? null;

  // Disponibilité
  const isAvailable = product.is_available !== false && (product.stock == null || Number(product.stock) > 0);

  return {
    imageUrl,
    title,
    subtitle,
    priceLabel,
    badges,
    stockLabel,
    themeToken,
    accentToken,
    isAvailable,
  };
}
