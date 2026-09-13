/**
 * @komerce-arch
 * @role          cj-dropshipping-api-connector
 * @domain        catalog
 * @layer         service
 * @criticality   medium
 * @inputs        CJ API v2 credentials and product search/detail filters
 * @outputs       normalized_supplier_product_v2 with optional commandable units
 * @depends       services/suppliers/normalized-product.js
 * @used-by       services/sourcing-import-dispatch.js, scripts/cj-showcase-sampler.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md, docs/doctrine/DOCTRINE_CATALOGUE.md, docs/doctrine/DOCTRINE_SUPPLIER_ORDER_IDENTITY.md
 * @impact-areas  catalog, sourcing, supplier-import, purchasing
 * @version       2026-09-v2
 */
'use strict';

const { partitionValid } = require('../normalized-product');

const SUPPLIER_NAME = 'CJdropshipping';
const PROVIDER_ID = 'cj';
const BASE_URL = 'https://developers.cjdropshipping.com/api2.0/v1';
const AUTH_PATH = '/authentication/getAccessToken';
const PRODUCT_LIST_V2_PATH = '/product/listV2';
const PRODUCT_QUERY_PATH = '/product/query';
const API_KEY_ENV = 'CJ_API_KEY';
const ACCESS_TOKEN_ENV = 'CJ_ACCESS_TOKEN';
const MAX_PAGE_SIZE = 100;
const MAX_TARGETED_PRODUCTS = 20;
const SOURCE_LOCALE = 'en';

let cachedAccessToken = null;

function isConfigured(env = process.env) {
  return Boolean(env?.[ACCESS_TOKEN_ENV] || env?.[API_KEY_ENV]);
}

function inactiveReason(env = process.env) {
  return isConfigured(env)
    ? null
    : `${API_KEY_ENV} ou ${ACCESS_TOKEN_ENV} requis`;
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function clampPage(value) {
  const page = Number.parseInt(value ?? 1, 10);
  if (!Number.isInteger(page) || page < 1 || page > 1000) {
    throw new Error('[CJdropshipping] page doit être comprise entre 1 et 1000');
  }
  return page;
}

function clampPageSize(value) {
  const size = Number.parseInt(value ?? 20, 10);
  if (!Number.isInteger(size) || size < 1 || size > MAX_PAGE_SIZE) {
    throw new Error(`[CJdropshipping] size doit être comprise entre 1 et ${MAX_PAGE_SIZE}`);
  }
  return size;
}

function positiveNumberOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function nonNegativeIntegerOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function minOrderQty(value) {
  const n = Number.parseInt(value ?? 1, 10);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

function parseDeliveryDays(value) {
  if (value == null || value === '') return null;
  const numbers = String(value).match(/\d+/g)?.map(Number).filter(Number.isFinite) || [];
  if (!numbers.length) return null;
  return Math.min(365, Math.max(...numbers));
}

function stripHtml(value) {
  if (!value) return null;
  return String(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 10000) || null;
}

function categoryLabel(raw = {}) {
  return [raw.oneCategoryName, raw.twoCategoryName, raw.threeCategoryName]
    .filter(Boolean)
    .join(' > ')
    .slice(0, 200) || String(raw.categoryName || '').trim().slice(0, 200) || null;
}

function normalizeHttpUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^\/\//.test(raw)) return `https:${raw}`;
  if (/^http:\/\//i.test(raw)) return raw.replace(/^http:/i, 'https:');
  return /^https:\/\//i.test(raw) ? raw : null;
}

function optionAxisKey(label, index) {
  const key = String(label || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return key ? `cj_${key}` : `cj_option_${index + 1}`;
}

function variantStock(variant = {}) {
  const totals = toArray(variant.inventories)
    .map((row) => nonNegativeIntegerOrNull(row?.totalInventory ?? row?.totalInventoryNum))
    .filter((value) => value !== null);
  if (totals.length) return totals.reduce((sum, value) => sum + value, 0);
  return nonNegativeIntegerOrNull(variant.inventoryNum ?? variant.totalInventoryNum);
}

function buildVariantOptionModel(raw = {}, variants = []) {
  const labels = String(raw.productKeyEn || raw.variantKeyEn || '')
    .split('-')
    .map((value) => value.trim())
    .filter(Boolean);
  const axes = labels.map((label, index) => ({
    key: optionAxisKey(label, index),
    display_name: label,
    values: [],
    display_order: index,
  }));

  const optionsByVid = new Map();
  for (const variant of variants) {
    const vid = String(variant?.vid || '').trim();
    const variantKey = String(variant?.variantKey || variant?.variantNameEn || variant?.variantName || variant?.variantSku || vid).trim();
    const values = variantKey.split('-').map((value) => value.trim());
    const optionValues = {};

    if (axes.length && values.length === axes.length) {
      axes.forEach((axis, index) => {
        const value = values[index];
        if (!value) return;
        optionValues[axis.key] = value;
        if (!axis.values.includes(value)) axis.values.push(value);
      });
    } else {
      if (!axes.length) {
        axes.push({ key: 'cj_variant', display_name: 'Variant', values: [], display_order: 0 });
      }
      const axis = axes[0];
      const value = variantKey || vid;
      optionValues[axis.key] = value;
      if (value && !axis.values.includes(value)) axis.values.push(value);
    }
    if (vid) optionsByVid.set(vid, optionValues);
  }

  return { axes: axes.length ? axes : null, optionsByVid };
}

function buildCommandableStructure(raw = {}) {
  const productId = String(raw.pid || raw.id || '').trim() || null;
  const variants = toArray(raw.variants).filter((variant) => variant && String(variant.vid || '').trim());
  if (!productId || !variants.length) return { option_axes: null, sellable_units: null, variant_media: [] };

  const { axes, optionsByVid } = buildVariantOptionModel(raw, variants);
  const variantMedia = [];
  const seenMedia = new Set();
  const sellableUnits = variants.map((variant) => {
    const vid = String(variant.vid || '').trim();
    const variantSku = String(variant.variantSku || '').trim() || vid;
    const stock = variantStock(variant);
    const price = positiveNumberOrNull(variant.variantSellPrice);
    const image = normalizeHttpUrl(variant.variantImage);
    const mediaRefs = [];

    if (image && !seenMedia.has(image)) {
      seenMedia.add(image);
      const mediaId = `${productId}:variant:${vid}`;
      variantMedia.push({
        supplier_media_id: mediaId,
        url: image,
        role: 'PRODUCT',
        alt: String(variant.variantNameEn || variant.variantKey || '').trim() || null,
        option_values: optionsByVid.get(vid) || null,
        display_order: variantMedia.length + 1,
      });
      mediaRefs.push(mediaId);
    }

    return {
      supplier_sku: variantSku,
      supplier_unit_ref: vid,
      supplier_order_identity: {
        provider: PROVIDER_ID,
        version: 1,
        payload: {
          pid: productId,
          vid,
          variant_sku: variantSku,
        },
      },
      option_values: optionsByVid.get(vid) || {},
      stock_available: stock,
      purchase_price: price,
      currency: 'USD',
      media_refs: mediaRefs.length ? mediaRefs : null,
      is_active: stock !== null && stock > 0 && price !== null,
    };
  });

  return { option_axes: axes, sellable_units: sellableUnits, variant_media: variantMedia };
}

function normalizeCjProduct(raw = {}) {
  const id = String(raw.id || raw.pid || raw.productId || raw.spu || raw.sku || raw.productSku || '').trim() || null;
  const name = String(raw.nameEn || raw.productNameEn || raw.productName || '').trim();
  const image = normalizeHttpUrl(raw.bigImage || raw.productImage);
  const description = stripHtml(raw.description);
  const commandable = buildCommandableStructure({ ...raw, pid: raw.pid || raw.id || raw.productId || id });
  const unitStocks = (commandable.sellable_units || []).map((unit) => unit.stock_available).filter((value) => value !== null);
  const unitPrices = (commandable.sellable_units || []).map((unit) => unit.purchase_price).filter((value) => value !== null);
  const stock = unitStocks.length
    ? unitStocks.reduce((sum, value) => sum + value, 0)
    : nonNegativeIntegerOrNull(raw.totalVerifiedInventory ?? raw.warehouseInventoryNum);
  const purchasePrice = unitPrices.length
    ? Math.min(...unitPrices)
    : positiveNumberOrNull(raw.nowPrice ?? raw.discountPrice ?? raw.sellPrice);
  const supplierCategory = categoryLabel(raw);

  const media = [];
  const seenMedia = new Set();
  function addMedia(url, supplierMediaId, alt, optionValues = null) {
    const normalized = normalizeHttpUrl(url);
    if (!normalized || seenMedia.has(normalized)) return;
    seenMedia.add(normalized);
    media.push({
      supplier_media_id: supplierMediaId,
      url: normalized,
      role: 'PRODUCT',
      alt: alt || null,
      option_values: optionValues,
      display_order: media.length,
    });
  }
  if (image) addMedia(image, id ? `${id}:hero` : null, name || null);
  for (const url of toArray(raw.productImageSet)) addMedia(url, id ? `${id}:media:${media.length + 1}` : null, name || null);
  for (const item of commandable.variant_media) addMedia(item.url, item.supplier_media_id, item.alt, item.option_values);

  return {
    schema_version: '2',
    supplier_name: SUPPLIER_NAME,
    supplier_product_id: id,
    product_name: name,
    supplier_category: supplierCategory,
    purchase_price: purchasePrice,
    currency: 'USD',
    image_url: image || media[0]?.url || null,
    product_url: null,
    description,
    stock_available: stock,
    min_order_qty: minOrderQty(raw.directMinOrderNum),
    supplier_delay_days: parseDeliveryDays(raw.deliveryCycle),
    weight_kg: positiveNumberOrNull(raw.productWeight) ? Number(raw.productWeight) / 1000 : null,
    source_locale: SOURCE_LOCALE,
    dimensions: null,
    media: media.length ? media : null,
    option_axes: commandable.option_axes,
    sellable_units: commandable.sellable_units,
    brand: null,
    highlights: null,
    specifications: null,
    sections: null,
    materials: toArray(raw.materialNameEnSet).filter(Boolean).slice(0, 20),
    care: null,
    warnings: null,
    raw_payload: {
      source: 'cj_api_v2',
      source_title: name || null,
      source_description: raw.description ?? null,
      source_locale: SOURCE_LOCALE,
      cj: raw,
    },
  };
}

function flattenProductList(body = {}) {
  const content = Array.isArray(body?.data?.content) ? body.data.content : [];
  const out = [];
  for (const group of content) {
    if (Array.isArray(group?.productList)) out.push(...group.productList);
  }
  return out;
}

async function parseJsonResponse(response, label) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.result === false || body.success === false) {
    const requestId = body.requestId ? ` requestId=${body.requestId}` : '';
    throw new Error(`[CJdropshipping] ${label} échoué (${response.status}): ${body.message || 'erreur inconnue'}${requestId}`);
  }
  return body;
}

async function getAccessToken({ fetchImpl = fetch, env = process.env, forceRefresh = false } = {}) {
  if (env?.[ACCESS_TOKEN_ENV]) return env[ACCESS_TOKEN_ENV];
  if (!forceRefresh && cachedAccessToken) return cachedAccessToken;
  const apiKey = env?.[API_KEY_ENV];
  if (!apiKey) throw new Error(`[CJdropshipping] ${API_KEY_ENV} ou ${ACCESS_TOKEN_ENV} requis`);

  const response = await fetchImpl(`${BASE_URL}${AUTH_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ apiKey }),
  });
  const body = await parseJsonResponse(response, 'authentification');
  const token = body?.data?.accessToken;
  if (!token) throw new Error('[CJdropshipping] accessToken absent de la réponse d’authentification');
  cachedAccessToken = token;
  return token;
}

function buildProductListUrl(options = {}) {
  const url = new URL(`${BASE_URL}${PRODUCT_LIST_V2_PATH}`);
  url.searchParams.set('page', String(clampPage(options.page)));
  url.searchParams.set('size', String(clampPageSize(options.size ?? options.page_size)));
  const keyword = options.keyword ?? options.keyWord ?? options.query;
  if (keyword) url.searchParams.set('keyWord', String(keyword).trim());
  if (options.categoryId ?? options.category_id) url.searchParams.set('categoryId', String(options.categoryId ?? options.category_id));
  if (options.countryCode ?? options.country_code) url.searchParams.set('countryCode', String(options.countryCode ?? options.country_code).toUpperCase());
  if (options.startWarehouseInventory ?? options.start_warehouse_inventory) {
    url.searchParams.set('startWarehouseInventory', String(options.startWarehouseInventory ?? options.start_warehouse_inventory));
  }
  if (options.verifiedWarehouse ?? options.verified_warehouse) {
    url.searchParams.set('verifiedWarehouse', String(options.verifiedWarehouse ?? options.verified_warehouse));
  }
  url.searchParams.append('features', 'enable_description');
  url.searchParams.append('features', 'enable_category');
  return url;
}

async function fetchProductDetail(productId, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const env = options.env || process.env;
  const accessToken = options.accessToken || await getAccessToken({ fetchImpl, env });
  const pid = String(productId || '').trim();
  if (!pid) throw new Error('[CJdropshipping] product id requis');
  const url = new URL(`${BASE_URL}${PRODUCT_QUERY_PATH}`);
  url.searchParams.set('pid', pid);
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { Accept: 'application/json', 'CJ-Access-Token': accessToken },
  });
  const body = await parseJsonResponse(response, `détail produit ${pid}`);
  if (!body?.data || typeof body.data !== 'object') {
    throw new Error(`[CJdropshipping] détail produit ${pid} absent`);
  }
  return { product: body.data, request_id: body.requestId ?? null };
}

async function mapWithConcurrency(items, limit, mapper) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

function normalizeProductIds(options = {}) {
  return [...new Set(toArray(options.productIds ?? options.product_ids)
    .map((value) => String(value || '').trim())
    .filter(Boolean))]
    .slice(0, MAX_TARGETED_PRODUCTS);
}

async function fetchProducts(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const env = options.env || process.env;
  const accessToken = await getAccessToken({ fetchImpl, env });
  const productIds = normalizeProductIds(options);

  if (productIds.length) {
    const details = await mapWithConcurrency(productIds, 4, async (productId) => {
      try {
        const detail = await fetchProductDetail(productId, { fetchImpl, env, accessToken });
        return { productId, raw: detail.product, request_id: detail.request_id, error: null };
      } catch (error) {
        return { productId, raw: null, request_id: null, error };
      }
    });
    const normalized = details.filter((item) => item.raw).map((item) => normalizeCjProduct(item.raw));
    const { valid, invalid } = partitionValid(normalized);
    const detailErrors = details
      .filter((item) => item.error)
      .map((item) => ({ supplier_product_id: item.productId, error: item.error.message }));
    return {
      products: valid,
      invalid: [...invalid, ...detailErrors],
      total: productIds.length,
      page: 1,
      total_records: productIds.length,
      request_id: details.find((item) => item.request_id)?.request_id || null,
      source: 'cj_api_v2_product_query',
    };
  }

  const url = buildProductListUrl(options);
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'CJ-Access-Token': accessToken,
    },
  });
  const body = await parseJsonResponse(response, 'recherche produits');
  let rawProducts = flattenProductList(body);

  if (options.includeCommandableUnits === true || options.include_commandable_units === true) {
    const ids = rawProducts.map((raw) => String(raw.id || raw.pid || '').trim()).filter(Boolean);
    const details = await mapWithConcurrency(ids, 4, async (productId) => {
      const detail = await fetchProductDetail(productId, { fetchImpl, env, accessToken });
      return detail.product;
    });
    rawProducts = details;
  }

  const normalized = rawProducts.map(normalizeCjProduct);
  const { valid, invalid } = partitionValid(normalized);
  return {
    products: valid,
    invalid,
    total: normalized.length,
    page: body?.data?.pageNumber ?? clampPage(options.page),
    total_records: body?.data?.totalRecords ?? null,
    request_id: body?.requestId ?? null,
    source: 'cj_api_v2',
  };
}

function resetTokenCacheForTests() {
  cachedAccessToken = null;
}

const IS_ACTIVE = isConfigured(process.env);
const INACTIVE_REASON = inactiveReason(process.env);

module.exports = {
  SUPPLIER_NAME,
  PROVIDER_ID,
  BASE_URL,
  API_KEY_ENV,
  ACCESS_TOKEN_ENV,
  MAX_PAGE_SIZE,
  MAX_TARGETED_PRODUCTS,
  IS_ACTIVE,
  INACTIVE_REASON,
  isConfigured,
  inactiveReason,
  normalizeCjProduct,
  variantStock,
  buildVariantOptionModel,
  buildCommandableStructure,
  flattenProductList,
  getAccessToken,
  buildProductListUrl,
  fetchProductDetail,
  fetchProducts,
  resetTokenCacheForTests,
};
