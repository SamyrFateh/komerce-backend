/**
 * @komerce-arch
 * @role          cj-dropshipping-api-connector
 * @domain        catalog
 * @layer         service
 * @criticality   medium
 * @inputs        CJ API v2 credentials and product search filters
 * @outputs       normalized_supplier_product_v2
 * @depends       services/suppliers/normalized-product.js
 * @used-by       services/sourcing-import-dispatch.js, scripts/cj-showcase-sampler.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md, docs/doctrine/DOCTRINE_CATALOGUE.md
 * @impact-areas  catalog, sourcing, supplier-import
 * @version       2026-09-v1
 */
'use strict';

const { partitionValid } = require('../normalized-product');

const SUPPLIER_NAME = 'CJdropshipping';
const BASE_URL = 'https://developers.cjdropshipping.com/api2.0/v1';
const AUTH_PATH = '/authentication/getAccessToken';
const PRODUCT_LIST_V2_PATH = '/product/listV2';
const API_KEY_ENV = 'CJ_API_KEY';
const ACCESS_TOKEN_ENV = 'CJ_ACCESS_TOKEN';
const MAX_PAGE_SIZE = 100;
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
    .slice(0, 200) || null;
}

function normalizeCjProduct(raw = {}) {
  const id = String(raw.id || raw.pid || raw.spu || raw.sku || '').trim() || null;
  const name = String(raw.nameEn || raw.productNameEn || '').trim();
  const image = String(raw.bigImage || raw.productImage || '').trim() || null;
  const description = stripHtml(raw.description);
  const stock = nonNegativeIntegerOrNull(raw.totalVerifiedInventory ?? raw.warehouseInventoryNum);
  const purchasePrice = positiveNumberOrNull(raw.nowPrice ?? raw.discountPrice ?? raw.sellPrice);
  const supplierCategory = categoryLabel(raw) || String(raw.categoryName || '').trim().slice(0, 200) || null;

  const media = image ? [{
    supplier_media_id: id ? `${id}:hero` : null,
    url: image,
    role: 'PRODUCT',
    alt: name || null,
    option_values: null,
    display_order: 0,
  }] : null;

  return {
    schema_version: '2',
    supplier_name: SUPPLIER_NAME,
    supplier_product_id: id,
    product_name: name,
    supplier_category: supplierCategory,
    purchase_price: purchasePrice,
    currency: 'USD',
    image_url: image,
    product_url: null,
    description,
    stock_available: stock,
    min_order_qty: minOrderQty(raw.directMinOrderNum),
    supplier_delay_days: parseDeliveryDays(raw.deliveryCycle),
    weight_kg: null,
    source_locale: SOURCE_LOCALE,
    dimensions: null,
    media,
    option_axes: null,
    sellable_units: null,
    brand: null,
    highlights: null,
    specifications: null,
    sections: null,
    materials: null,
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

async function fetchProducts(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const env = options.env || process.env;
  const accessToken = await getAccessToken({ fetchImpl, env });
  const url = buildProductListUrl(options);
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'CJ-Access-Token': accessToken,
    },
  });
  const body = await parseJsonResponse(response, 'recherche produits');
  const rawProducts = flattenProductList(body);
  const normalized = rawProducts.map(normalizeCjProduct);
  const { valid, invalid } = partitionValid(normalized);
  return {
    products: valid,
    invalid,
    total: normalized.length,
    page: body?.data?.pageNumber ?? clampPage(options.page),
    total_records: body?.data?.totalRecords ?? null,
    request_id: body?.requestId ?? null,
  };
}

function resetTokenCacheForTests() {
  cachedAccessToken = null;
}

const IS_ACTIVE = isConfigured(process.env);
const INACTIVE_REASON = inactiveReason(process.env);

module.exports = {
  SUPPLIER_NAME,
  BASE_URL,
  API_KEY_ENV,
  ACCESS_TOKEN_ENV,
  MAX_PAGE_SIZE,
  IS_ACTIVE,
  INACTIVE_REASON,
  isConfigured,
  inactiveReason,
  normalizeCjProduct,
  flattenProductList,
  getAccessToken,
  buildProductListUrl,
  fetchProducts,
  resetTokenCacheForTests,
};
