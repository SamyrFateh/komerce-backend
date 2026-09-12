/**
 * @komerce-arch
 * @role          aliexpress-dropshipper-source-connector
 * @domain        catalog
 * @layer         service
 * @criticality   medium
 * @inputs        AliExpress DS API credentials, feed filters or product ids
 * @outputs       normalized_supplier_product_v2
 * @depends       services/suppliers/normalized-product.js, node:crypto
 * @used-by       services/sourcing-import-dispatch.js, tests/unit/aliexpress-connector.test.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md, docs/doctrine/DOCTRINE_CATALOGUE.md, docs/doctrine/DOCTRINE_SUPPLIER_ORDER_IDENTITY.md
 * @impact-areas  catalog, sourcing, supplier-import
 * @version       2026-09-v3
 */
'use strict';

const crypto = require('crypto');
const { partitionValid } = require('../normalized-product');

const SUPPLIER_NAME = 'AliExpress';
const BASE_URL = 'https://api-sg.aliexpress.com/sync';
const APP_KEY_ENV = 'ALIEXPRESS_APP_KEY';
const APP_SECRET_ENV = 'ALIEXPRESS_APP_SECRET';
const SESSION_ENV = 'ALIEXPRESS_SESSION';
const DEFAULT_FEED_NAME = 'DS bestseller';
const MAX_PAGE_SIZE = 50;
const SOURCE_LOCALE = 'en';
const TARGET_CURRENCY = 'USD';
const TARGET_LANGUAGE = 'EN';

function isConfigured(env = process.env) {
  return Boolean(env?.[APP_KEY_ENV] && env?.[APP_SECRET_ENV] && env?.[SESSION_ENV]);
}

function inactiveReason(env = process.env) {
  return isConfigured(env)
    ? null
    : `${APP_KEY_ENV}, ${APP_SECRET_ENV} et ${SESSION_ENV} requis (accès AliExpress Dropshipper autorisé)`;
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
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

function normalizeHttpUrl(value) {
  if (!value || value === '0') return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\/\//.test(raw)) return `https:${raw}`;
  if (/^http:\/\//i.test(raw)) return raw.replace(/^http:/i, 'https:');
  if (/^https:\/\//i.test(raw)) return raw;
  return null;
}

function formatTopTimestamp(date = new Date()) {
  return String(date.getTime());
}

function stringifyParam(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function signTopParams(params, secret) {
  const canonical = Object.keys(params)
    .filter((key) => key !== 'sign' && params[key] !== undefined && params[key] !== null)
    .sort()
    .map((key) => `${key}${stringifyParam(params[key])}`)
    .join('');
  return crypto.createHmac('sha256', secret).update(canonical, 'utf8').digest('hex').toUpperCase();
}

function buildTopRequest(method, businessParams = {}, { env = process.env, now = new Date() } = {}) {
  if (!isConfigured(env)) throw new Error(`[${SUPPLIER_NAME}] ${inactiveReason(env)}`);
  const params = {
    method,
    app_key: env[APP_KEY_ENV],
    session: env[SESSION_ENV],
    simplify: 'true',
    sign_method: 'sha256',
    timestamp: formatTopTimestamp(now),
  };
  for (const [key, value] of Object.entries(businessParams || {})) {
    if (value !== undefined && value !== null && value !== '') params[key] = stringifyParam(value);
  }
  params.sign = signTopParams(params, env[APP_SECRET_ENV]);
  return new URLSearchParams(params);
}

function responseKeyFor(method) {
  return `${method.replace(/\./g, '_')}_response`;
}

async function invokeTop(method, businessParams, { fetchImpl = fetch, env = process.env, now = new Date() } = {}) {
  const query = buildTopRequest(method, businessParams, { env, now });
  const response = await fetchImpl(`${BASE_URL}?${query.toString()}`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error_response) {
    const err = body.error_response || body || {};
    throw new Error(`[${SUPPLIER_NAME}] ${method} échoué (${response.status}): ${err.sub_msg || err.msg || err.message || 'erreur inconnue'}`);
  }
  const payload = body[responseKeyFor(method)] || body;
  if (!payload || typeof payload !== 'object') throw new Error(`[${SUPPLIER_NAME}] réponse ${method} absente`);
  if (payload.rsp_code && String(payload.rsp_code) !== '200' && !payload.result) {
    throw new Error(`[${SUPPLIER_NAME}] ${method}: ${payload.rsp_msg || `rsp_code=${payload.rsp_code}`}`);
  }
  return payload;
}

function clampPage(value) {
  const page = Number.parseInt(value ?? 1, 10);
  if (!Number.isInteger(page) || page < 1 || page > 1000) {
    throw new Error(`[${SUPPLIER_NAME}] page doit être comprise entre 1 et 1000`);
  }
  return page;
}

function clampPageSize(value) {
  const size = Number.parseInt(value ?? 20, 10);
  if (!Number.isInteger(size) || size < 1 || size > MAX_PAGE_SIZE) {
    throw new Error(`[${SUPPLIER_NAME}] size doit être comprise entre 1 et ${MAX_PAGE_SIZE}`);
  }
  return size;
}

function extractProductId(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (/^\d{5,20}$/.test(raw)) return raw;
  const match = raw.match(/\/item\/(\d{5,20})\.html/i) || raw.match(/[?&]product[_-]?id=(\d{5,20})/i);
  return match ? match[1] : null;
}

function propertyAxisKey(prop = {}) {
  const id = String(prop.sku_property_id ?? '').trim();
  if (id && id !== '0') return `p_${id}`;
  const name = String(prop.sku_property_name || 'option')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100);
  return name || 'option';
}

function propertyValue(prop = {}) {
  const custom = String(prop.property_value_definition_name ?? '').trim();
  if (custom && custom !== '0') return custom.slice(0, 200);
  const raw = String(prop.sku_property_value ?? '').trim();
  return raw ? raw.slice(0, 200) : null;
}

function extractSkuProperties(sku = {}) {
  return toArray(sku?.ae_sku_property_dtos?.ae_sku_property_d_t_o)
    .map((prop) => ({
      raw: prop,
      key: propertyAxisKey(prop),
      display_name: String(prop.sku_property_name || '').trim().slice(0, 200) || null,
      value: propertyValue(prop),
      image: normalizeHttpUrl(prop.sku_image),
    }))
    .filter((prop) => prop.value);
}

function buildSkuAttr(sku = {}) {
  const pairs = [];
  for (const prop of toArray(sku?.ae_sku_property_dtos?.ae_sku_property_d_t_o)) {
    const propertyId = String(prop?.sku_property_id ?? '').trim();
    const valueId = String(prop?.sku_property_value ?? '').trim();
    if (!propertyId || propertyId === '0' || !valueId || valueId === '0') continue;
    pairs.push(`${propertyId}:${valueId}`);
  }
  return pairs.length ? pairs.join(';') : null;
}

function rawSupplierUnitRef(sku = {}) {
  const value = sku.id ?? sku.sku_id ?? sku.skuId;
  if (value == null || String(value).trim() === '') return null;
  return String(value).trim().slice(0, 256);
}

function splitImageUrls(value) {
  return String(value || '')
    .split(';')
    .map(normalizeHttpUrl)
    .filter(Boolean);
}

function buildRichStructure(productId, detail = {}, feed = {}) {
  const skuList = toArray(detail?.ae_item_sku_info_dtos?.ae_item_sku_info_d_t_o);
  const axesMap = new Map();
  const media = [];
  const mediaByUrl = new Map();

  function addMedia(url, role, optionValues = null) {
    const normalizedUrl = normalizeHttpUrl(url);
    if (!normalizedUrl) return null;
    const existing = mediaByUrl.get(normalizedUrl);
    if (existing) return existing;
    const mediaId = `${productId}:media:${media.length + 1}`;
    const item = {
      supplier_media_id: mediaId,
      url: normalizedUrl,
      role,
      alt: null,
      option_values: optionValues,
      display_order: media.length,
    };
    media.push(item);
    mediaByUrl.set(normalizedUrl, mediaId);
    return mediaId;
  }

  const baseImages = [
    ...splitImageUrls(detail?.ae_multimedia_info_dto?.image_urls),
    normalizeHttpUrl(feed.product_main_image_url),
    ...toArray(feed?.product_small_image_urls?.string).map(normalizeHttpUrl),
  ].filter(Boolean);
  for (const url of baseImages) addMedia(url, 'PRODUCT');

  const parsedSkus = skuList.map((sku) => {
    const properties = extractSkuProperties(sku);
    const optionValues = {};
    for (const prop of properties) {
      optionValues[prop.key] = prop.value;
      if (!axesMap.has(prop.key)) {
        axesMap.set(prop.key, { key: prop.key, display_name: prop.display_name, values: [], display_order: axesMap.size });
      }
      const axis = axesMap.get(prop.key);
      if (!axis.values.includes(prop.value)) axis.values.push(prop.value);
    }
    const mediaRefs = [];
    for (const prop of properties) {
      if (!prop.image) continue;
      const ref = addMedia(prop.image, 'PRODUCT', { [prop.key]: prop.value });
      if (ref && !mediaRefs.includes(ref)) mediaRefs.push(ref);
    }
    return { sku, optionValues, mediaRefs };
  });

  const optionAxes = axesMap.size ? [...axesMap.values()] : null;
  const sellableUnits = parsedSkus.length ? parsedSkus.map(({ sku, optionValues, mediaRefs }, index) => {
    const stock = nonNegativeIntegerOrNull(sku.sku_available_stock ?? sku.ipm_sku_stock);
    const price = positiveNumberOrNull(sku.offer_sale_price ?? sku.sku_price);
    const supplierSku = String(sku.sku_code || sku.id || `${productId}:sku:${index + 1}`).slice(0, 128);
    const skuAttr = buildSkuAttr(sku);
    const nativeUnitRef = rawSupplierUnitRef(sku);
    const supplierUnitRef = nativeUnitRef || skuAttr || null;
    const identityPayload = {};
    if (nativeUnitRef) identityPayload.sku_id = nativeUnitRef;
    if (skuAttr) identityPayload.sku_attr = skuAttr;
    const supplierOrderIdentity = supplierUnitRef && Object.keys(identityPayload).length
      ? { provider: 'aliexpress', version: 1, payload: identityPayload }
      : null;
    return {
      supplier_sku: supplierSku,
      supplier_unit_ref: supplierUnitRef,
      supplier_order_identity: supplierOrderIdentity,
      option_values: optionValues,
      stock_available: stock,
      purchase_price: price,
      currency: String(sku.currency_code || TARGET_CURRENCY).toUpperCase(),
      media_refs: mediaRefs.length ? mediaRefs : null,
      is_active: sku.sku_stock === false ? false : true,
    };
  }) : null;

  return { media: media.length ? media : null, option_axes: optionAxes, sellable_units: sellableUnits };
}

function normalizeDsProduct(detailResult = {}, feed = {}) {
  const detail = detailResult?.result || detailResult || {};
  const base = detail.ae_item_base_info_dto || {};
  const productId = String(base.product_id || feed.product_id || '').trim() || null;
  const name = String(base.subject || feed.product_title || '').trim().slice(0, 300);
  const rich = buildRichStructure(productId || 'unknown', detail, feed);
  const skuList = toArray(detail?.ae_item_sku_info_dtos?.ae_item_sku_info_d_t_o);
  const skuPrices = skuList.map((sku) => positiveNumberOrNull(sku.offer_sale_price ?? sku.sku_price)).filter(Boolean);
  const feedPrice = positiveNumberOrNull(feed.target_sale_price ?? feed.sale_price ?? feed.app_sale_price);
  const purchasePrice = skuPrices.length ? Math.min(...skuPrices) : feedPrice;
  const currency = String(
    skuList.find((sku) => sku.currency_code)?.currency_code ||
    base.currency_code ||
    feed.target_sale_price_currency ||
    feed.sale_price_currency ||
    TARGET_CURRENCY
  ).toUpperCase();
  const numericStocks = skuList
    .map((sku) => nonNegativeIntegerOrNull(sku.sku_available_stock ?? sku.ipm_sku_stock))
    .filter((value) => value !== null);
  const stock = numericStocks.length ? numericStocks.reduce((sum, value) => sum + value, 0) : null;
  const packageInfo = detail.package_info_dto || {};
  const logistics = detail.logistics_info_dto || {};
  const category = [feed.first_level_category_name, feed.second_level_category_name]
    .filter(Boolean).join(' > ').slice(0, 200) || (base.category_id ? `AliExpress category ${base.category_id}` : null);
  const specifications = toArray(detail?.ae_item_properties?.ae_item_property)
    .map((prop, index) => ({
      group: null,
      key: prop.attr_name_id != null ? String(prop.attr_name_id).slice(0, 128) : null,
      label: String(prop.attr_name || '').trim().slice(0, 200),
      value: String(prop.attr_value ?? '').trim().slice(0, 500),
      unit: prop.attr_value_unit ? String(prop.attr_value_unit).slice(0, 50) : null,
      display_order: index,
    }))
    .filter((spec) => spec.label && spec.value)
    .slice(0, 60);
  const hero = rich.media?.[0]?.url || null;
  const productUrl = normalizeHttpUrl(feed.product_detail_url) || (productId ? `https://www.aliexpress.com/item/${productId}.html` : null);

  return {
    schema_version: '2',
    supplier_name: SUPPLIER_NAME,
    supplier_product_id: productId,
    product_name: name,
    supplier_category: category,
    purchase_price: purchasePrice,
    currency,
    image_url: hero,
    product_url: productUrl,
    description: stripHtml(base.detail),
    stock_available: stock,
    min_order_qty: null,
    supplier_delay_days: nonNegativeIntegerOrNull(logistics.delivery_time),
    weight_kg: positiveNumberOrNull(packageInfo.gross_weight),
    source_locale: SOURCE_LOCALE,
    dimensions: (positiveNumberOrNull(packageInfo.package_length) && positiveNumberOrNull(packageInfo.package_width) && positiveNumberOrNull(packageInfo.package_height)) ? {
      l_cm: Number(packageInfo.package_length),
      w_cm: Number(packageInfo.package_width),
      h_cm: Number(packageInfo.package_height),
    } : null,
    media: rich.media,
    option_axes: rich.option_axes,
    sellable_units: rich.sellable_units,
    brand: null,
    highlights: null,
    specifications: specifications.length ? specifications : null,
    sections: null,
    materials: null,
    care: null,
    warnings: null,
    raw_payload: {
      source: 'aliexpress_ds_api',
      source_title: name || null,
      source_locale: SOURCE_LOCALE,
      aliexpress: { feed, detail },
    },
  };
}

function flattenFeedProducts(payload = {}) {
  const result = payload.result || payload;
  const products = result?.products || {};
  return toArray(products.integer || products.product || products.products);
}

async function fetchFeed(options = {}) {
  const payload = await invokeTop('aliexpress.ds.recommend.feed.get', {
    country: String(options.countryCode || options.country_code || 'KM').toUpperCase(),
    target_currency: TARGET_CURRENCY,
    target_language: TARGET_LANGUAGE,
    page_size: clampPageSize(options.size ?? options.page_size),
    page_no: clampPage(options.page),
    category_id: options.categoryId ?? options.category_id,
    sort: options.sort,
    feed_name: options.feedName || options.feed_name || DEFAULT_FEED_NAME,
  }, options);
  return payload.result || payload;
}

async function fetchProductDetail(productId, options = {}) {
  const payload = await invokeTop('aliexpress.ds.product.get', {
    product_id: productId,
    ship_to_country: String(options.countryCode || options.country_code || 'KM').toUpperCase(),
    target_currency: TARGET_CURRENCY,
    target_language: TARGET_LANGUAGE,
  }, options);
  return payload;
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

async function fetchProducts(options = {}) {
  const env = options.env || process.env;
  if (!isConfigured(env)) throw new Error(`[${SUPPLIER_NAME}] ${inactiveReason(env)}`);

  let feedItems = [];
  let productIds = toArray(options.productIds ?? options.product_ids)
    .map(extractProductId)
    .filter(Boolean);
  const urlId = extractProductId(options.productUrl ?? options.product_url);
  if (urlId) productIds.push(urlId);
  productIds = [...new Set(productIds)].slice(0, MAX_PAGE_SIZE);

  let feedMeta = null;
  if (!productIds.length) {
    feedMeta = await fetchFeed({ ...options, env });
    feedItems = flattenFeedProducts(feedMeta);
    productIds = feedItems.map((item) => extractProductId(item.product_id)).filter(Boolean);
  }
  if (!productIds.length) {
    return { products: [], invalid: [], total: 0, page: clampPage(options.page), total_records: 0 };
  }

  const feedById = new Map(feedItems.map((item) => [String(item.product_id), item]));
  const details = await mapWithConcurrency(productIds, 4, async (productId) => ({
    productId,
    payload: await fetchProductDetail(productId, { ...options, env }),
  }));
  const normalized = details.map(({ productId, payload }) => normalizeDsProduct(payload, feedById.get(String(productId)) || {}));
  const { valid, invalid } = partitionValid(normalized);

  return {
    products: valid,
    invalid,
    total: normalized.length,
    page: feedMeta?.current_page_no ?? clampPage(options.page),
    total_records: feedMeta?.total_record_count ?? normalized.length,
    source: 'aliexpress_ds_api',
  };
}

const IS_ACTIVE = isConfigured(process.env);
const INACTIVE_REASON = inactiveReason(process.env);

module.exports = {
  SUPPLIER_NAME,
  BASE_URL,
  APP_KEY_ENV,
  APP_SECRET_ENV,
  SESSION_ENV,
  DEFAULT_FEED_NAME,
  MAX_PAGE_SIZE,
  IS_ACTIVE,
  INACTIVE_REASON,
  isConfigured,
  inactiveReason,
  formatTopTimestamp,
  signTopParams,
  buildTopRequest,
  invokeTop,
  extractProductId,
  buildSkuAttr,
  rawSupplierUnitRef,
  normalizeDsProduct,
  flattenFeedProducts,
  fetchFeed,
  fetchProductDetail,
  fetchProducts,
};
