/**
 * @komerce-arch
 * @role          ebay-sandbox-browse-proof
 * @domain        external-provider-contracts
 * @layer         script
 * @criticality   high
 * @inputs        eBay Sandbox application credentials, marketplace, explicit item id or bounded search query
 * @outputs       sanitized P0/P1 eBay Browse contract proof and exact item facts
 * @depends       scripts/provider-contract-proof.js
 * @used-by       operator CLI during eBay provider characterization
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_EXTERNAL_PROVIDER_CONTRACT_PROOFS.md, docs/external-providers/suppliers/EBAY.md
 * @impact-areas  external-provider-contracts, catalog, sourcing
 */
'use strict';

const { buildProof, assertThrough, summary } = require('./provider-contract-proof');

const TOKEN_URL = 'https://api.sandbox.ebay.com/identity/v1/oauth2/token';
const BROWSE_BASE_URL = 'https://api.sandbox.ebay.com/buy/browse/v1';
const APPLICATION_SCOPE = 'https://api.ebay.com/oauth/api_scope';
const DEFAULT_MARKETPLACE = 'EBAY_US';
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
const ITEM_ID_RE = /^v1\|[^|\s]{1,100}\|[^|\s]{1,100}$/;

function compact(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeMarketplace(value) {
  const marketplace = compact(value || DEFAULT_MARKETPLACE).toUpperCase();
  if (!/^EBAY_[A-Z]{2,8}$/.test(marketplace)) throw new Error('EBAY_SANDBOX_MARKETPLACE_INVALID');
  return marketplace;
}

function normalizeLimit(value) {
  const limit = value == null || value === '' ? DEFAULT_LIMIT : Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error(`EBAY_SANDBOX_BROWSE_LIMIT_INVALID_MAX_${MAX_LIMIT}`);
  }
  return limit;
}

function normalizeItemId(value) {
  const itemId = compact(value);
  if (!itemId) return null;
  if (!ITEM_ID_RE.test(itemId)) throw new Error('EBAY_SANDBOX_ITEM_ID_INVALID');
  return itemId;
}

function configuration(env = process.env) {
  const clientId = compact(env.EBAY_SANDBOX_CLIENT_ID);
  const clientSecret = compact(env.EBAY_SANDBOX_CLIENT_SECRET);
  const marketplace = normalizeMarketplace(env.EBAY_SANDBOX_MARKETPLACE_ID);
  const itemId = normalizeItemId(env.EBAY_SANDBOX_ITEM_ID);
  const query = compact(env.EBAY_SANDBOX_SEARCH_QUERY);
  const limit = normalizeLimit(env.EBAY_SANDBOX_SEARCH_LIMIT);

  return Object.freeze({
    clientId,
    clientSecret,
    marketplace,
    itemId,
    query,
    limit,
    credentialsConfigured: Boolean(clientId && clientSecret),
    discoveryConfigured: Boolean(itemId || query),
  });
}

function safeProviderError(status, payload) {
  const errors = Array.isArray(payload?.errors) ? payload.errors : [];
  const ids = errors
    .map(error => compact(error?.errorId || error?.error_id || error?.code))
    .filter(Boolean)
    .slice(0, 5);
  return Object.freeze({
    status: Number.isInteger(status) ? status : null,
    provider_error_ids: ids,
  });
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function requestApplicationToken({ clientId, clientSecret, fetchImpl = global.fetch }) {
  if (!clientId || !clientSecret) throw new Error('EBAY_SANDBOX_APPLICATION_CREDENTIALS_REQUIRED');
  if (typeof fetchImpl !== 'function') throw new Error('EBAY_SANDBOX_FETCH_REQUIRED');

  const basic = Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: APPLICATION_SCOPE,
  });

  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  const payload = await readJson(response);
  if (!response.ok) {
    const diagnostic = safeProviderError(response.status, payload);
    const error = new Error(`EBAY_SANDBOX_OAUTH_FAILED_${response.status}`);
    error.diagnostic = diagnostic;
    throw error;
  }

  const token = compact(payload?.access_token);
  const tokenType = compact(payload?.token_type);
  const expiresIn = Number(payload?.expires_in);
  if (!token) throw new Error('EBAY_SANDBOX_OAUTH_TOKEN_MISSING');

  return Object.freeze({
    token,
    token_type: tokenType || null,
    expires_in: Number.isFinite(expiresIn) ? expiresIn : null,
  });
}

async function authorizedGet(url, { token, marketplace, fetchImpl = global.fetch }) {
  if (!token) throw new Error('EBAY_SANDBOX_APPLICATION_TOKEN_REQUIRED');
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': marketplace,
    },
  });
  const payload = await readJson(response);
  if (!response.ok) {
    const diagnostic = safeProviderError(response.status, payload);
    const error = new Error(`EBAY_SANDBOX_BROWSE_FAILED_${response.status}`);
    error.diagnostic = diagnostic;
    throw error;
  }
  return payload;
}

async function searchItems({ token, marketplace, query, limit = DEFAULT_LIMIT, fetchImpl = global.fetch }) {
  const q = compact(query);
  if (!q) throw new Error('EBAY_SANDBOX_SEARCH_QUERY_REQUIRED');
  const boundedLimit = normalizeLimit(limit);
  const url = new URL('/buy/browse/v1/item_summary/search', BROWSE_BASE_URL);
  url.search = new URLSearchParams({ q, limit: String(boundedLimit) }).toString();
  const payload = await authorizedGet(url, { token, marketplace, fetchImpl });
  const rows = Array.isArray(payload?.itemSummaries) ? payload.itemSummaries : [];
  return Object.freeze({
    total: Number.isFinite(Number(payload?.total)) ? Number(payload.total) : null,
    next_present: Boolean(payload?.next),
    items: rows.slice(0, boundedLimit).map(row => Object.freeze({
      item_id: compact(row?.itemId) || null,
      title_present: Boolean(compact(row?.title)),
      price_currency: compact(row?.price?.currency) || null,
      price_value: compact(row?.price?.value) || null,
    })),
  });
}

async function getItem({ token, marketplace, itemId, fetchImpl = global.fetch }) {
  const exactItemId = normalizeItemId(itemId);
  if (!exactItemId) throw new Error('EBAY_SANDBOX_ITEM_ID_REQUIRED');
  const url = new URL(`/buy/browse/v1/item/${encodeURIComponent(exactItemId)}`, BROWSE_BASE_URL);
  const payload = await authorizedGet(url, { token, marketplace, fetchImpl });

  return Object.freeze({
    item_id: compact(payload?.itemId) || null,
    legacy_item_id: compact(payload?.legacyItemId) || null,
    title_present: Boolean(compact(payload?.title)),
    price_currency: compact(payload?.price?.currency) || null,
    price_value: compact(payload?.price?.value) || null,
    availability_status: compact(payload?.estimatedAvailabilities?.[0]?.estimatedAvailabilityStatus) || null,
    estimated_remaining_quantity: Number.isFinite(Number(payload?.estimatedAvailabilities?.[0]?.estimatedRemainingQuantity))
      ? Number(payload.estimatedAvailabilities[0].estimatedRemainingQuantity)
      : null,
    seller_username_present: Boolean(compact(payload?.seller?.username)),
    item_end_date_present: Boolean(compact(payload?.itemEndDate)),
    shipping_options_present: Array.isArray(payload?.shippingOptions) && payload.shippingOptions.length > 0,
  });
}

function firstExactSearchItem(search) {
  const row = (Array.isArray(search?.items) ? search.items : []).find(item => {
    try {
      return Boolean(normalizeItemId(item?.item_id));
    } catch {
      return false;
    }
  });
  return row?.item_id || null;
}

async function runEbayBrowseReadOnlyProof({ env = process.env, fetchImpl = global.fetch } = {}) {
  const config = configuration(env);
  let tokenMeta = null;
  let tokenError = null;
  let search = null;
  let searchError = null;
  let exactItem = null;
  let exactItemError = null;

  if (config.credentialsConfigured) {
    try {
      tokenMeta = await requestApplicationToken({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        fetchImpl,
      });
    } catch (error) {
      tokenError = error;
    }
  }

  let selectedItemId = config.itemId;
  if (tokenMeta?.token && !selectedItemId && config.query) {
    try {
      search = await searchItems({
        token: tokenMeta.token,
        marketplace: config.marketplace,
        query: config.query,
        limit: config.limit,
        fetchImpl,
      });
      selectedItemId = firstExactSearchItem(search);
    } catch (error) {
      searchError = error;
    }
  }

  if (tokenMeta?.token && selectedItemId) {
    try {
      exactItem = await getItem({
        token: tokenMeta.token,
        marketplace: config.marketplace,
        itemId: selectedItemId,
        fetchImpl,
      });
    } catch (error) {
      exactItemError = error;
    }
  }

  const exactIdentityConfirmed = Boolean(
    exactItem?.item_id
    && selectedItemId
    && exactItem.item_id === selectedItemId
    && normalizeItemId(exactItem.item_id),
  );
  const nativeMoneyKnown = Boolean(exactItem?.price_currency && exactItem?.price_value);
  const browseAccepted = Boolean(exactItem || search);
  const tokenAccepted = Boolean(tokenMeta?.token);

  const proof = buildProof({
    provider: 'EBAY',
    environment: 'SANDBOX',
    conversation: {
      operation: 'BUY_BROWSE_EXACT_ITEM',
      phases: {
        EXPECTS: [
          { id: 'EXACT_PURCHASABLE_ITEM', state: 'KNOWN', evidence: 'BROWSE_SEARCH_THEN_GET_ITEM' },
          { id: 'NATIVE_PRICE_CURRENCY', state: 'KNOWN', evidence: 'BROWSE_ITEM_PRICE' },
        ],
        REQUIRES: [
          {
            id: 'SANDBOX_APPLICATION_KEYSET',
            state: 'KNOWN',
            evidence: config.credentialsConfigured ? 'CONFIGURED' : 'MISSING',
          },
          { id: 'APPLICATION_OAUTH_SCOPE', state: 'KNOWN', evidence: APPLICATION_SCOPE },
          { id: 'MARKETPLACE_CONTEXT', state: 'KNOWN', evidence: config.marketplace },
          {
            id: 'EXACT_ITEM_OR_SEARCH_QUERY',
            state: 'KNOWN',
            evidence: config.itemId ? 'EXPLICIT_ITEM_ID' : (config.query ? 'BOUNDED_SEARCH_QUERY' : 'MISSING'),
          },
        ],
        SENDS: [
          { id: 'CLIENT_CREDENTIALS_TOKEN_REQUEST', state: 'KNOWN', evidence: 'FORM_URLENCODED_NO_SECRET_EVIDENCE' },
          {
            id: 'BOUNDED_BROWSE_READ',
            state: 'KNOWN',
            evidence: config.itemId ? 'GET_ITEM_DIRECT' : `SEARCH_LIMIT_${config.limit}_THEN_GET_ITEM`,
          },
        ],
        RECEIVES: [
          {
            id: 'TOKEN_RESPONSE',
            state: 'KNOWN',
            evidence: tokenAccepted ? 'ACCEPTED' : (tokenError?.message || 'NOT_ATTEMPTED'),
          },
          {
            id: 'BROWSE_RESPONSE',
            state: 'KNOWN',
            evidence: browseAccepted
              ? (exactItem ? 'EXACT_ITEM_READ' : 'SEARCH_READ')
              : (exactItemError?.message || searchError?.message || 'NOT_ATTEMPTED'),
          },
        ],
        CONFIRMS: [
          {
            id: 'EXACT_ITEM_READBACK',
            state: 'KNOWN',
            evidence: exactIdentityConfirmed ? 'ITEM_ID_MATCH' : 'NOT_CONFIRMED',
          },
        ],
        EXPOSES: [
          {
            id: 'EXACT_ITEM_IDENTITY',
            state: 'KNOWN',
            evidence: exactIdentityConfirmed ? exactItem.item_id : 'NOT_EXPOSED',
          },
          {
            id: 'NATIVE_MONEY',
            state: 'KNOWN',
            evidence: nativeMoneyKnown ? `${exactItem.price_value}_${exactItem.price_currency}` : 'NOT_EXPOSED',
          },
        ],
      },
    },
    stages: {
      P0: [
        {
          id: 'SANDBOX_KEYSET_CONFIGURED',
          pass: config.credentialsConfigured,
          evidence: config.credentialsConfigured ? 'CLIENT_ID_AND_SECRET_PRESENT' : 'MISSING_CONFIGURATION',
        },
        {
          id: 'DISCOVERY_TARGET_CONFIGURED',
          pass: config.discoveryConfigured,
          evidence: config.itemId ? 'EXPLICIT_ITEM_ID' : (config.query ? 'SEARCH_QUERY' : 'MISSING'),
        },
      ],
      P1: [
        {
          id: 'APPLICATION_TOKEN_ACCEPTED',
          pass: tokenAccepted,
          evidence: tokenAccepted
            ? `TOKEN_TYPE_${tokenMeta.token_type || 'UNKNOWN'}_EXPIRY_${tokenMeta.expires_in ?? 'UNKNOWN'}`
            : (tokenError?.message || 'NOT_ATTEMPTED'),
        },
        {
          id: 'BOUNDED_BROWSE_READ_ACCEPTED',
          pass: browseAccepted,
          evidence: browseAccepted
            ? (exactItem ? 'GET_ITEM_OK' : `SEARCH_OK_${search?.items?.length || 0}`)
            : (searchError?.message || exactItemError?.message || 'NOT_ATTEMPTED'),
        },
        {
          id: 'EXACT_ITEM_READBACK',
          pass: exactIdentityConfirmed,
          evidence: exactIdentityConfirmed ? exactItem.item_id : (exactItemError?.message || 'NOT_CONFIRMED'),
        },
        {
          id: 'NATIVE_MONEY_OBSERVED',
          pass: nativeMoneyKnown,
          evidence: nativeMoneyKnown ? `${exactItem.price_value}_${exactItem.price_currency}` : 'NOT_OBSERVED',
        },
      ],
    },
  });

  return Object.freeze({
    proof,
    report: summary(proof),
    diagnostics: Object.freeze({
      marketplace: config.marketplace,
      credentials_configured: config.credentialsConfigured,
      discovery_target: config.itemId ? 'explicit_item_id' : (config.query ? 'bounded_search' : 'none'),
      search_limit: config.limit,
      token_accepted: tokenAccepted,
      search_result_count: search?.items?.length ?? null,
      search_next_present: search?.next_present ?? null,
      selected_item_id: selectedItemId || null,
      exact_item: exactItem || null,
      token_error: tokenError ? {
        message: tokenError.message,
        diagnostic: tokenError.diagnostic || null,
      } : null,
      search_error: searchError ? {
        message: searchError.message,
        diagnostic: searchError.diagnostic || null,
      } : null,
      exact_item_error: exactItemError ? {
        message: exactItemError.message,
        diagnostic: exactItemError.diagnostic || null,
      } : null,
    }),
  });
}

function readThrough(argv) {
  const flag = argv.find(arg => arg.startsWith('--through='));
  const through = compact(flag ? flag.slice('--through='.length) : 'P1').toUpperCase();
  if (!['P0', 'P1'].includes(through)) throw new Error('Usage: node scripts/ebay-sandbox-browse-proof.js [--through=P0|P1]');
  const unknown = argv.filter(arg => !arg.startsWith('--through='));
  if (unknown.length) throw new Error('Usage: node scripts/ebay-sandbox-browse-proof.js [--through=P0|P1]');
  return through;
}

async function run(argv = process.argv.slice(2), options = {}) {
  const through = readThrough(argv);
  const result = await runEbayBrowseReadOnlyProof(options);
  assertThrough(result.proof, through);
  return { report: result.report, diagnostics: result.diagnostics };
}

if (require.main === module) {
  run().then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = {
  TOKEN_URL,
  BROWSE_BASE_URL,
  APPLICATION_SCOPE,
  DEFAULT_MARKETPLACE,
  configuration,
  safeProviderError,
  requestApplicationToken,
  searchItems,
  getItem,
  firstExactSearchItem,
  runEbayBrowseReadOnlyProof,
  readThrough,
  run,
};
