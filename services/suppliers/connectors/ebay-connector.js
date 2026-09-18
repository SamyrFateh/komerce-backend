/**
 * @komerce-arch
 * @role          ebay-sandbox-browse-connector
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        eBay Sandbox Browse item/search responses
 * @outputs       NormalizedSupplierProduct V2 with exact eBay REST item identity
 * @depends       services/suppliers/normalized-product.js
 * @used-by       services/sourcing-import-dispatch.js, P2/P3 external-provider contract proofs
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md, docs/doctrine/DOCTRINE_SUPPLIER_ORDER_IDENTITY.md, docs/external-providers/suppliers/EBAY.md
 * @impact-areas  catalog, sourcing, supplier-connectivity
 */
'use strict';

const { partitionValid } = require('../normalized-product');

const TOKEN_URL = 'https://api.sandbox.ebay.com/identity/v1/oauth2/token';
const BROWSE_BASE_URL = 'https://api.sandbox.ebay.com/buy/browse/v1';
const APPLICATION_SCOPE = 'https://api.ebay.com/oauth/api_scope';
const PROVIDER = 'ebay';
const SUPPLIER_NAME = 'eBay Sandbox';
const MAX_SEARCH_LIMIT = 10;
const MAX_TARGETED_ITEMS = 20;
const ALLOWED_CURRENCIES = new Set(['AED', 'EUR', 'USD', 'KMF', 'PLN']);

function text(value) {
  return String(value == null ? '' : value).trim();
}

function parseItemId(value) {
  const itemId = text(value);
  const match = itemId.match(/^v1\|([^|\s]{1,100})\|([^|\s]{1,100})$/);
  if (!match) throw new Error('EBAY_ITEM_ID_INVALID');
  return Object.freeze({ itemId, listingId: match[1], variationId: match[2] });
}

function configuration(env = process.env) {
  const clientId = text(env.EBAY_CLIENT_ID);
  const clientSecret = text(env.EBAY_CLIENT_SECRET);
  const environment = text(env.EBAY_ENV).toLowerCase();
  const marketplaceId = text(env.EBAY_MARKETPLACE_ID).toUpperCase();

  if (!clientId || !clientSecret) throw new Error('EBAY_APPLICATION_CREDENTIALS_REQUIRED');
  if (environment !== 'sandbox') throw new Error('EBAY_SANDBOX_ENVIRONMENT_REQUIRED');
  if (!/^EBAY_[A-Z]{2,8}$/.test(marketplaceId)) throw new Error('EBAY_MARKETPLACE_REQUIRED');

  return Object.freeze({ clientId, clientSecret, environment, marketplaceId });
}

function exactMoney(item) {
  const raw = text(item?.price?.value);
  const currency = text(item?.price?.currency).toUpperCase();
  if (!/^[0-9]+(?:\.[0-9]{1,4})?$/.test(raw)) throw new Error('EBAY_NATIVE_PRICE_REQUIRED');
  const value = Number(raw);
  if (!(value > 0) || value > 10000000) throw new Error('EBAY_NATIVE_PRICE_INVALID');
  if (!ALLOWED_CURRENCIES.has(currency)) throw new Error(`EBAY_CURRENCY_UNSUPPORTED_${currency || 'MISSING'}`);
  return Object.freeze({ value, currency });
}

function exactAvailability(item) {
  const availability = Array.isArray(item?.estimatedAvailabilities)
    ? item.estimatedAvailabilities[0]
    : null;
  const status = text(availability?.estimatedAvailabilityStatus);
  const quantity = Number(availability?.estimatedRemainingQuantity);
  if (!status) throw new Error('EBAY_AVAILABILITY_STATUS_REQUIRED');
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new Error('EBAY_AVAILABILITY_QUANTITY_REQUIRED');
  }
  return Object.freeze({ status, quantity });
}

function exactPurchasability(item, availability, now = Date.now()) {
  const fixedPrice = Array.isArray(item?.buyingOptions) && item.buyingOptions.includes('FIXED_PRICE');
  const endAt = Date.parse(text(item?.itemEndDate));
  if (!Number.isFinite(endAt)) throw new Error('EBAY_ITEM_END_DATE_REQUIRED');
  return Object.freeze({
    fixedPrice,
    endAt,
    active: fixedPrice && endAt > now && availability.quantity > 0,
  });
}

function mediaFrom(item, itemId) {
  const urls = [
    item?.image?.imageUrl,
    ...(Array.isArray(item?.additionalImages) ? item.additionalImages.map(image => image?.imageUrl) : []),
  ]
    .map(text)
    .filter(url => /^https?:\/\//i.test(url));

  return [...new Set(urls)].slice(0, 100).map((url, index) => ({
    supplier_media_id: `ebay:${itemId}:${index}`.slice(0, 128),
    url,
    role: 'PRODUCT',
    display_order: index,
  }));
}

function normalizeBrowseItem(item, { expectedItemId, marketplaceId, now = Date.now() } = {}) {
  const parsed = parseItemId(item?.itemId);
  if (expectedItemId && parsed.itemId !== parseItemId(expectedItemId).itemId) {
    throw new Error('EBAY_ITEM_ID_MISMATCH');
  }

  const marketplace = text(marketplaceId).toUpperCase();
  if (!/^EBAY_[A-Z]{2,8}$/.test(marketplace)) throw new Error('EBAY_MARKETPLACE_REQUIRED');
  const listingMarketplace = text(item?.listingMarketplaceId).toUpperCase();
  if (listingMarketplace && listingMarketplace !== marketplace) {
    throw new Error('EBAY_LISTING_MARKETPLACE_MISMATCH');
  }

  const title = text(item?.title);
  if (!title) throw new Error('EBAY_TITLE_REQUIRED');

  const money = exactMoney(item);
  const availability = exactAvailability(item);
  const purchasability = exactPurchasability(item, availability, now);
  const media = mediaFrom(item, parsed.itemId);

  const productRef = text(item?.itemGroupId)
    || text(item?.legacyItemId)
    || parsed.listingId;
  const supplierSku = `ebay-sandbox:${parsed.listingId}:${parsed.variationId}`;
  if (supplierSku.length > 128) throw new Error('EBAY_SUPPLIER_SKU_TOO_LONG');

  return {
    schema_version: '2',
    supplier_name: SUPPLIER_NAME,
    supplier_product_id: productRef,
    product_name: title.slice(0, 300),
    supplier_category: text(item?.categoryPath || item?.categoryId) || null,
    purchase_price: money.value,
    currency: money.currency,
    stock_available: availability.quantity,
    product_url: text(item?.itemWebUrl) || null,
    source_locale: null,
    media,
    option_axes: [],
    sellable_units: [{
      supplier_sku: supplierSku,
      supplier_unit_ref: parsed.itemId,
      supplier_order_identity: {
        provider: PROVIDER,
        version: 1,
        payload: {
          environment: 'sandbox',
          marketplace_id: marketplace,
          item_id: parsed.itemId,
        },
      },
      option_values: {},
      purchase_price: money.value,
      currency: money.currency,
      stock_available: availability.quantity,
      is_active: purchasability.active,
      media_refs: media.map(entry => entry.supplier_media_id),
    }],
    raw_payload: {
      ebay: {
        environment: 'sandbox',
        marketplace_id: marketplace,
        item,
      },
    },
  };
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function applicationToken(config, fetchImpl = global.fetch) {
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`, 'utf8').toString('base64');
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: APPLICATION_SCOPE,
    }).toString(),
  });
  const payload = await readJson(response);
  const token = text(payload?.access_token);
  if (!response.ok || !token) throw new Error(`EBAY_OAUTH_REJECTED_${response.status}`);
  return token;
}

async function authorizedGet(url, config, token, fetchImpl = global.fetch) {
  const response = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': config.marketplaceId,
    },
  });
  const payload = await readJson(response);
  if (!response.ok) throw new Error(`EBAY_BROWSE_REJECTED_${response.status}`);
  return payload;
}

async function fetchExactItem(itemId, config, token, fetchImpl = global.fetch) {
  const exact = parseItemId(itemId).itemId;
  const url = new URL(`/buy/browse/v1/item/${encodeURIComponent(exact)}`, BROWSE_BASE_URL);
  return authorizedGet(url, config, token, fetchImpl);
}

async function discoverItemIds(keyword, limit, config, token, fetchImpl = global.fetch) {
  const q = text(keyword);
  if (!q) throw new Error('EBAY_SEARCH_QUERY_REQUIRED');
  const size = Number(limit ?? 5);
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_SEARCH_LIMIT) {
    throw new Error(`EBAY_SEARCH_LIMIT_INVALID_MAX_${MAX_SEARCH_LIMIT}`);
  }
  const url = new URL('/buy/browse/v1/item_summary/search', BROWSE_BASE_URL);
  url.search = new URLSearchParams({ q, limit: String(size) }).toString();
  const payload = await authorizedGet(url, config, token, fetchImpl);
  const rows = Array.isArray(payload?.itemSummaries) ? payload.itemSummaries.slice(0, size) : [];
  return [...new Set(rows.map(row => {
    try { return parseItemId(row?.itemId).itemId; } catch { return null; }
  }).filter(Boolean))];
}

async function fetchProducts(options = {}) {
  const config = configuration(options.env || process.env);
  const fetchImpl = options.fetchImpl || global.fetch;
  const token = await applicationToken(config, fetchImpl);

  let itemIds = Array.isArray(options.productIds)
    ? [...new Set(options.productIds.map(value => parseItemId(value).itemId))]
    : [];
  if (itemIds.length > MAX_TARGETED_ITEMS) throw new Error(`EBAY_TOO_MANY_TARGETED_ITEMS_MAX_${MAX_TARGETED_ITEMS}`);
  if (!itemIds.length) {
    itemIds = await discoverItemIds(options.keyword, options.size, config, token, fetchImpl);
  }

  const products = [];
  const invalid = [];
  for (const itemId of itemIds) {
    const raw = await fetchExactItem(itemId, config, token, fetchImpl);
    try {
      products.push(normalizeBrowseItem(raw, {
        expectedItemId: itemId,
        marketplaceId: config.marketplaceId,
        now: options.now,
      }));
    } catch (error) {
      invalid.push({ supplier_product_id: itemId, errors: [error.message] });
    }
  }

  const checked = partitionValid(products);
  return {
    products: checked.valid,
    invalid: [...invalid, ...checked.invalid],
    total: itemIds.length,
    source: 'ebay_browse_api',
  };
}

function inactiveReason(env = process.env) {
  try {
    configuration(env);
    return null;
  } catch (error) {
    return error.message;
  }
}

module.exports = {
  TOKEN_URL,
  BROWSE_BASE_URL,
  APPLICATION_SCOPE,
  PROVIDER,
  SUPPLIER_NAME,
  ALLOWED_CURRENCIES,
  parseItemId,
  configuration,
  exactMoney,
  exactAvailability,
  exactPurchasability,
  normalizeBrowseItem,
  applicationToken,
  discoverItemIds,
  fetchExactItem,
  fetchProducts,
  get IS_ACTIVE() { return inactiveReason() === null; },
  get INACTIVE_REASON() { return inactiveReason(); },
};
