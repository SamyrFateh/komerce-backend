/**
 * @komerce-arch
 * @role          boutique-product-store
 * @domain        catalog
 * @layer         state-store
 * @criticality   high
 * @inputs        raw_products, cache_state, availability_flags, market_context
 * @outputs       normalized_products, market_scoped_cached_products, promo_products
 * @depends       localStorage, shop-schema.js, market-context.js, komerce-api.js
 * @used-by       b-catalog.js, boutique.js, suggestion-modules
 * @doctrine      product_source_unique, catalogue_cache_fallback, produit_reference_stable, market_cache_isolation
 * @impact-areas  catalog, product-discovery, suggestions, offline-fallback, market-autonomy
 * @version       2026-09
 */
'use strict';

import { getDbKeysForCategory, matchesSubcategory, normalizeCategoryKey } from './shop-schema.js';

const CACHE_KEY = 'komerce_products_cache';
let productCache = [];

function currentMarketCode() {
  if (typeof window === 'undefined' || !window.KomerceMarket) return null;
  const api = window.KomerceMarket;
  return (api.getPreviewOverride && api.getPreviewOverride()) || api.DEFAULT || null;
}

function cacheKey() {
  const marketCode = currentMarketCode();
  return marketCode ? `${CACHE_KEY}_${marketCode}` : CACHE_KEY;
}

// b-catalog possède encore un appel historique direct K.products.list().
// Tant que ce chemin n'est pas supprimé, on impose ici le market context sur
// l'API commune au chargement du module. K est déjà chargé avant main.js dans
// index.html. Le wrapper ne fabrique aucune autorité : il transmet seulement
// un code marché de présentation au GET public ; le checkout reste ancré par
// relais.market_id côté serveur.
function installMarketAwareProductApi() {
  const api = typeof globalThis !== 'undefined' ? globalThis.K?.products : null;
  if (!api || api.__marketAwareListInstalled || typeof api.list !== 'function') return;
  const originalList = api.list.bind(api);
  api.list = function marketAwareList(filters = {}) {
    const market = filters.market || currentMarketCode();
    return originalList({ ...filters, ...(market ? { market } : {}) });
  };
  Object.defineProperty(api, '__marketAwareListInstalled', {
    value: true,
    configurable: false,
    enumerable: false,
  });
}

installMarketAwareProductApi();

// Le fallback historique de b-catalog lit encore la clé non scopée. Pour un
// marché non-KM on la supprime fail-closed : mieux vaut afficher « pas de
// connexion » qu'une grille KM mise en cache sous ?market=CM/CG.
if (typeof localStorage !== 'undefined' && currentMarketCode() && currentMarketCode() !== 'KM') {
  localStorage.removeItem(CACHE_KEY);
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.products)) return value.products;
  return [];
}

export function normalizeProduct(product) {
  const normalized = { ...product };
  normalized.rawCategory = product.category || '';
  normalized.displayCategory = normalizeCategoryKey(product.category);
  normalized.images = Array.isArray(product.images) && product.images.length
    ? product.images
    : (product.image_url ? [product.image_url] : []);
  normalized.is_available = product.is_available !== false;
  return normalized;
}

export function setProducts(products) {
  productCache = products.map(normalizeProduct);
  return productCache;
}

export function getAllProducts() {
  return [...productCache];
}

export function getProductById(id) {
  return productCache.find((product) => String(product.id) === String(id)) || null;
}

export function getPromoProducts() {
  return productCache.filter((product) => (product.promo_pct || 0) > 0);
}

export function getProductsByCategory(categoryKey) {
  if (!categoryKey || categoryKey === 'all') return getAllProducts();
  const dbKeys = new Set(getDbKeysForCategory(categoryKey));
  return productCache.filter((product) => dbKeys.has(product.rawCategory || product.category));
}

export function getProductsBySubcategory(categoryKey, subcategoryKey) {
  let list = getProductsByCategory(categoryKey);
  if (!subcategoryKey) return list;
  return list.filter((product) => matchesSubcategory(categoryKey, subcategoryKey, product.subcategory));
}

export function partitionProductsByCategory(products) {
  const byCategory = {};
  products.forEach((product) => {
    const category = normalizeCategoryKey(product.rawCategory || product.category) || 'Autres';
    if (!byCategory[category]) byCategory[category] = [];
    byCategory[category].push(product);
  });
  return byCategory;
}

export function getRecommendedProducts(product, limit = 12) {
  if (!product) return [];
  return productCache
    .filter((candidate) =>
      String(candidate.id) !== String(product.id) &&
      normalizeCategoryKey(candidate.rawCategory || candidate.category) ===
        normalizeCategoryKey(product.rawCategory || product.category)
    )
    .slice(0, limit);
}

function readCache() {
  const cached = localStorage.getItem(cacheKey());
  if (!cached) return [];
  try {
    return JSON.parse(cached);
  } catch (error) {
    return [];
  }
}

export function writeCache(products) {
  localStorage.setItem(cacheKey(), JSON.stringify(products));
}

export async function fetchProducts() {
  try {
    if (typeof K === 'undefined' || !K.products) {
      throw new Error('K non disponible');
    }
    const market = currentMarketCode();
    const response = await K.products.list({
      limit: 1000,
      ...(market ? { market } : {}),
    });
    const products = toArray(response).filter((product) => product.is_available !== false);
    writeCache(products);
    return setProducts(products);
  } catch (error) {
    const fallback = readCache();
    if (!fallback.length) throw error;
    return setProducts(fallback.filter((product) => product.is_available !== false));
  }
}