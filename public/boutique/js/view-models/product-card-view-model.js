/**
 * @komerce-arch-lite
 * @role          catalog-product-card-view-model
 * @domain        catalog
 * @layer         view-model
 * @owner         public/boutique/js/b-catalog.js
 * @purpose       supports public/boutique/js/b-catalog.js
 * @impact-areas  catalog, product-discovery
 * @version       2026-06
 */
'use strict';

/**
 * @module product-card-view-model
 * @component Boutique / Product Card ViewModel
 *
 * Responsibility:
 * - Translate a normalized Komerce product into a stable display contract.
 * - Centralize labels, badges and CSS classes used by product cards.
 * - Protect renderers and CSS from raw sourcing variability.
 *
 * Must not:
 * - Render HTML.
 * - Bind DOM events.
 * - Mutate cart/favorites state.
 * - Fetch products.
 * - Apply supplier-specific CSS.
 *
 * See:
 * - docs/BOUTIQUE_PRODUCT_DISPLAY_CONTRACT.md
 */

import { sanitize, fmt, fmtPrice, optimizeImgUrl } from '../b-utils.js';

'use strict';

const DEFAULT_PRODUCT_NAME = 'Produit Komerce';
const DEFAULT_IMAGE_URL = '/images/placeholder-product.svg';

function normalizeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

function normalizeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizePromoPct(value) {
  const pct = normalizeNumber(value, 0);
  if (pct <= 0 || pct >= 95) return 0;
  return Math.round(pct);
}

function inferFulfillmentType(product) {
  return normalizeString(
    product.fulfillment_type || product.fulfillmentType || product.source_type || product.sourceType,
    'standard'
  );
}

function inferAvailabilityStatus(product) {
  return normalizeString(
    product.availability_status || product.availabilityStatus || product.status,
    'available'
  );
}

function inferDataQualityScore(product) {
  const explicit = product.data_quality_score ?? product.dataQualityScore;
  if (explicit !== undefined && explicit !== null) return normalizeNumber(explicit, 0);

  let score = 0;
  if (product.name) score += 25;
  if (product.price_kmf || product.priceKmf) score += 25;
  if (product.image_url || product.imageUrl || product.images?.length) score += 25;
  if (product.category || product.category_key || product.categoryKey) score += 15;
  if (product.description) score += 10;
  return Math.min(score, 100);
}

function buildCssClasses({ promoPct, fulfillmentType, availabilityStatus, hasVariants, dataQualityScore, product }) {
  const classes = ['k-card--standard'];

  if (promoPct > 0) classes.push('k-card--promo');
  if (product.is_flash || product.isFlash) classes.push('k-card--flash');
  if (product.is_premium || product.isPremium) classes.push('k-card--premium');
  if (product.is_new || product.isNew) classes.push('k-card--new-arrival');

  if (fulfillmentType === 'local_stock') classes.push('k-card--local-stock');
  if (fulfillmentType === 'dubai_sourcing') classes.push('k-card--dubai-sourcing');
  if (fulfillmentType === 'custom_made') classes.push('k-card--custom-made');
  if (fulfillmentType === 'preorder') classes.push('k-card--preorder');
  if (fulfillmentType === 'backorder') classes.push('k-card--backorder');

  if (availabilityStatus === 'low_stock') classes.push('k-card--low-stock');
  if (hasVariants) classes.push('k-card--has-variants');
  if (dataQualityScore > 0 && dataQualityScore < 55) classes.push('k-card--low-confidence');

  return classes;
}

function buildBadges({ promoPct, fulfillmentType, availabilityStatus, hasVariants }) {
  const badges = [];

  if (promoPct > 0) badges.push({ key: 'promo', label: `-${promoPct}%`, className: 'k-card-badge--promo' });
  if (fulfillmentType === 'local_stock') badges.push({ key: 'local_stock', label: 'Disponible', className: 'k-card-badge--local-stock' });
  if (fulfillmentType === 'dubai_sourcing') badges.push({ key: 'dubai_sourcing', label: 'Sur commande', className: 'k-card-badge--dubai-sourcing' });
  if (fulfillmentType === 'custom_made') badges.push({ key: 'custom_made', label: 'Sur mesure', className: 'k-card-badge--custom-made' });
  if (availabilityStatus === 'low_stock') badges.push({ key: 'low_stock', label: 'Stock limité', className: 'k-card-badge--low-stock' });
  if (hasVariants) badges.push({ key: 'variants', label: 'Variantes', className: 'k-card-badge--variants' });

  return badges;
}

export function buildProductCardViewModel(product = {}, options = {}) {
  const id = product.id;
  const name = normalizeString(product.name, DEFAULT_PRODUCT_NAME);
  const description = normalizeString(product.description, '');
  const priceKmf = normalizeNumber(product.price_kmf ?? product.priceKmf, 0);
  const promoPct = normalizePromoPct(product.promo_pct ?? product.promoPct);
  const oldPriceKmf = promoPct > 0 && priceKmf > 0
    ? Math.round(priceKmf / (1 - promoPct / 100))
    : 0;

  // Objet catégorie (optionnel) — fourni par render-product-card.js via options.category.
  // Permet de résoudre : image de fallback catégorie, theme_token, accent_token.
  const categoryObj = (options.category && typeof options.category === 'object')
    ? options.category
    : null;

  // Image : product > category > placeholder
  const rawImageUrl = normalizeString(
    product.image_url || product.imageUrl || product.images?.[0]?.url || product.images?.[0],
    ''
  );
  const imageUrl = rawImageUrl
    || normalizeString(categoryObj?.imageUrl || categoryObj?.image_url, '')
    || DEFAULT_IMAGE_URL;

  // Thème visuel — depuis la catégorie DB
  const themeToken  = categoryObj?.themeToken  || categoryObj?.theme_token  || null;
  const accentToken = categoryObj?.accentToken || categoryObj?.accent_token || null;

  const fulfillmentType = inferFulfillmentType(product);
  const availabilityStatus = inferAvailabilityStatus(product);
  const hasVariants = Boolean(product.has_variants || product.hasVariants || product.variants?.length);
  const dataQualityScore = inferDataQualityScore(product);

  const cssClasses = buildCssClasses({
    promoPct,
    fulfillmentType,
    availabilityStatus,
    hasVariants,
    dataQualityScore,
    product,
  });

  const badges = buildBadges({ promoPct, fulfillmentType, availabilityStatus, hasVariants });

  return {
    id,
    raw: product,
    variant: options.variant || 'grid',
    name,
    safeName: sanitize(name),
    shortName: sanitize(normalizeString(product.short_name || product.shortName, name)),
    description,
    safeDescription: sanitize(description),
    imageUrl,
    optimizedImageUrl: optimizeImgUrl(imageUrl, options.imageSize || 400),
    imageAlt: sanitize(normalizeString(product.image_alt || product.imageAlt, name)),
    priceKmf,
    priceLabel: priceKmf > 0 ? fmtPrice(priceKmf) : 'Prix à confirmer',
    priceEurLabel: priceKmf > 0 ? `≈ ${fmt(priceKmf, 'EUR')}` : '',
    oldPriceKmf,
    oldPriceLabel: oldPriceKmf > 0 ? fmtPrice(oldPriceKmf) : '',
    promoPct,
    promoLabel: promoPct > 0 ? `-${promoPct}%` : '',
    badges,
    cssClasses,
    cssClassName: cssClasses.join(' '),
    cardVariant: promoPct > 0 ? 'promo' : 'standard',
    fulfillmentType,
    availabilityStatus,
    hasVariants,
    dataQualityScore,
    // Thème catégorie (depuis /api/categories via options.category)
    themeToken,
    accentToken,
  };
}
