/**
 * @komerce-arch
 * @role          boutique-product-store
 * @domain        catalog
 * @layer         state-store
 * @criticality   high
 * @inputs        raw_products, cache_state, availability_flags
 * @outputs       normalized_products, cached_products, promo_products
 * @depends       localStorage, shop-schema.js
 * @used-by       b-catalog.js, boutique.js, suggestion-modules
 * @doctrine      product_source_unique, catalogue_cache_fallback, produit_reference_stable
 * @impact-areas  catalog, product-discovery, suggestions, offline-fallback
 * @version       2026-06
 */
'use strict';

/**
 * @module product-store
 * @brief Source unique des produits normalises de la boutique.
 *
 * La grille, la recherche, la modale et les sections lisent
 * toutes cette meme couche de produits.
 */

import { getDbKeysForCategory, matchesSubcategory, normalizeCategoryKey } from './shop-schema.js';

const CACHE_KEY = 'komerce_products_cache';

let productCache = [];

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
  const cached = localStorage.getItem(CACHE_KEY);
  if (!cached) return [];
  try {
    return JSON.parse(cached);
  } catch (error) {
    return [];
  }
}

export function writeCache(products) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(products));
}

export async function fetchProducts() {
  try {
    if (typeof K === 'undefined' || !K.products) {
      throw new Error('K non disponible');
    }
    const response = await K.products.list({ limit: 1000 });
    const products = toArray(response).filter((product) => product.is_available !== false);
    writeCache(products);
    return setProducts(products);
  } catch (error) {
    const fallback = readCache();
    if (!fallback.length) throw error;
    return setProducts(fallback.filter((product) => product.is_available !== false));
  }
}
