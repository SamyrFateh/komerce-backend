/**
 * @komerce-arch
 * @role          allegro-sandbox-client
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        sandbox credentials, bounded read request, guarded seller draft/shipping seed/publication
 * @outputs       provider JSON, bounded shipping capabilities, ephemeral access token
 * @depends       db.js, node:crypto
 * @used-by       services/suppliers/connectors/allegro-connector.js, services/suppliers/allegro-purchase-reconciliation.js, scripts/allegro-sandbox-check.js, scripts/allegro-shipping-rate-contract.js
 * @db-read       supplier_oauth_connections
 * @db-write      supplier_oauth_connections
 * @db-txn        owned
 * @doctrine      docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md, docs/doctrine/DOCTRINE_PROCUREMENT_FULFILLMENT.md, docs/doctrine/DOCTRINE_EXTERNAL_PROVIDER_CONTRACT_PROOFS.md
 * @impact-areas  catalog, supplier-import, purchasing, secrets
 */
'use strict';

const crypto = require('node:crypto');
const API = 'https://api.allegro.pl.allegrosandbox.pl';
const TOKEN = 'https://allegro.pl.allegrosandbox.pl/auth/oauth/token';
const KEY = 'allegro_sandbox';
const AAD = Buffer.from('komerce:supplier-oauth:allegro_sandbox:refresh');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE_PROVIDER_TOKEN_RE = /^[A-Za-z0-9_.\[\]-]{1,120}$/;
const MONEY_RE = /^(?:0|[1-9][0-9]{0,6})\.[0-9]{2}$/;
const WEIGHT_RE = /^(?:0|[1-9][0-9]{0,6})\.[0-9]{3}$/;
const GOLDEN_PRODUCER_NAME = 'KOMERCE GOLDEN TEST ONLY';
const GOLDEN_SHIPPING_RATE_NAME = 'Komerce Golden Test Only';
const GOLDEN_PRODUCER_DATA = Object.freeze({
  tradeName: 'Komerce Golden Sandbox Manufacturer',
  address: Object.freeze({ countryCode: 'PL', street: 'Testowa 1', postalCode: '00-001', city: 'Warszawa' }),
  contact: Object.freeze({ email: 'sandbox-golden@komerce.co' }),
});

function configuration(env) {
  if (env.KOMERCE_ALLOW_ALLEGRO_SANDBOX !== '1') throw new Error('ALLEGRO_SANDBOX_DISABLED');
  for (const name of ['CLIENT_ID', 'CLIENT_SECRET', 'USER_AGENT', 'TOKEN_ENCRYPTION_KEY']) {
    if (!env[`ALLEGRO_SANDBOX_${name}`]?.trim()) throw new Error(`ALLEGRO_SANDBOX_${name} requis`);
  }
  const raw = env.ALLEGRO_SANDBOX_TOKEN_ENCRYPTION_KEY.trim();
  if (!/^[a-f0-9]{64}$/i.test(raw)) throw new Error('ALLEGRO_SANDBOX_TOKEN_ENCRYPTION_KEY: 32 octets hex requis');
  return { key: Buffer.from(raw, 'hex'), userAgent: env.ALLEGRO_SANDBOX_USER_AGENT.trim() };
}

function seedConfiguration(env) {
  const c = configuration(env);
  const runtime = String(env.KOMERCE_ENV || env.NODE_ENV || '').trim().toLowerCase();
  if (runtime !== 'staging') throw new Error('ALLEGRO_SANDBOX_SEED_STAGING_ONLY');
  if (env.KOMERCE_ALLOW_ALLEGRO_SANDBOX_SEED !== '1') throw new Error('ALLEGRO_SANDBOX_SEED_DISABLED');
  return c;
}

function publicationOfferId(value) {
  const id = String(value ?? '').trim();
  if (!/^[0-9]{1,30}$/.test(id)) throw new Error('ALLEGRO_SANDBOX_PUBLICATION_OFFER_ID_INVALID');
  return id;
}

function publicationCommandId(value) {
  const id = String(value ?? '').trim().toLowerCase();
  if (!UUID_RE.test(id)) throw new Error('ALLEGRO_SANDBOX_PUBLICATION_COMMAND_ID_INVALID');
  return id;
}

function sellerSettingId(value, label) {
  const id = String(value ?? '').trim().toLowerCase();
  if (!UUID_RE.test(id)) throw new Error(`ALLEGRO_SANDBOX_${label}_ID_INVALID`);
  return id;
}

function safeCountry(value) {
  const country = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? country : null;
}

function safeMoney(value) {
  const amount = String(value ?? '').trim();
  return MONEY_RE.test(amount) ? amount : null;
}

function safeWeight(value) {
  const weight = String(value ?? '').trim();
  return WEIGHT_RE.test(weight) ? weight : null;
}

function safeDuration(value) {
  const duration = String(value ?? '').trim().toUpperCase();
  return duration.startsWith('P') && SAFE_PROVIDER_TOKEN_RE.test(duration) ? duration : null;
}

function safeSettingRows(rows, { includeType = false } = {}) {
  return (Array.isArray(rows) ? rows : []).slice(0, 60)
    .map(row => {
      const id = String(row?.id || '').trim().toLowerCase();
      if (!UUID_RE.test(id)) return null;
      const out = { id };
      if (includeType && SAFE_PROVIDER_TOKEN_RE.test(String(row?.type || '').trim())) out.type = String(row.type).trim();
      return out;
    })
    .filter(Boolean);
}

function safeShippingRateRows(rows) {
  return (Array.isArray(rows) ? rows : []).slice(0, 60)
    .map(row => {
      const id = String(row?.id || '').trim().toLowerCase();
      if (!UUID_RE.test(id)) return null;
      const type = String(row?.type || '').trim().toUpperCase();
      return {
        id,
        type: ['PHYSICAL', 'ELECTRONIC'].includes(type) ? type : null,
        dispatch_country: safeCountry(row?.dispatchCountry),
        managed_by_allegro: typeof row?.features?.managedByAllegro === 'boolean' ? row.features.managedByAllegro : null,
        is_fulfillment: typeof row?.features?.isFulfillment === 'boolean' ? row.features.isFulfillment : null,
      };
    })
    .filter(Boolean);
}

function safeShippingRateDetail(payload) {
  const row = safeShippingRateRows([payload])[0];
  if (!row) return null;
  const rates = (Array.isArray(payload?.rates) ? payload.rates : []).slice(0, 60).map(rate => {
    const methodId = String(rate?.deliveryMethod?.id || '').trim().toLowerCase();
    if (!UUID_RE.test(methodId)) return null;
    const quantity = Number(rate?.maxQuantityPerPackage);
    const firstAmount = safeMoney(rate?.firstItemRate?.amount);
    const firstCurrency = String(rate?.firstItemRate?.currency || '').trim().toUpperCase();
    const weightSupported = rate?.maxPackageWeight != null;
    const weightValue = weightSupported ? safeWeight(rate?.maxPackageWeight?.value) : null;
    const weightUnit = weightSupported && SAFE_PROVIDER_TOKEN_RE.test(String(rate?.maxPackageWeight?.unit || '').trim())
      ? String(rate.maxPackageWeight.unit).trim().toUpperCase() : null;
    return {
      delivery_method_id: methodId,
      max_quantity_per_package: Number.isSafeInteger(quantity) && quantity > 0 ? quantity : null,
      first_item_rate: {
        amount: firstAmount,
        currency: SAFE_PROVIDER_TOKEN_RE.test(firstCurrency) ? firstCurrency : null,
      },
      max_package_weight: weightSupported ? { value: weightValue, unit: weightUnit } : null,
      shipping_time: rate?.shippingTime == null ? null : {
        from: safeDuration(rate?.shippingTime?.from),
        to: safeDuration(rate?.shippingTime?.to),
      },
    };
  }).filter(Boolean);
  return { ...row, rates };
}

function safeDeliveryMethodRows(rows) {
  return (Array.isArray(rows) ? rows : []).slice(0, 500).map(row => {
    const id = String(row?.id || '').trim().toLowerCase();
    if (!UUID_RE.test(id)) return null;
    const constraints = row?.shippingRatesConstraints || {};
    const maxQuantity = Number(constraints?.maxQuantityPerPackage?.max);
    const paymentPolicy = String(row?.paymentPolicy || '').trim().toUpperCase();
    const currency = String(constraints?.firstItemRate?.currency || '').trim().toUpperCase();
    const weightSupported = typeof constraints?.maxPackageWeight?.supported === 'boolean'
      ? constraints.maxPackageWeight.supported : null;
    return {
      id,
      payment_policy: SAFE_PROVIDER_TOKEN_RE.test(paymentPolicy) ? paymentPolicy : null,
      dispatch_country: safeCountry(row?.dispatchCountry),
      destination_country: safeCountry(row?.destinationCountry),
      shipping_rates_constraints: {
        allowed: typeof constraints?.allowed === 'boolean' ? constraints.allowed : null,
        max_quantity_per_package_max: Number.isSafeInteger(maxQuantity) && maxQuantity > 0 ? maxQuantity : null,
        max_package_weight: {
          supported: weightSupported,
          min: safeWeight(constraints?.maxPackageWeight?.min),
          max: safeWeight(constraints?.maxPackageWeight?.max),
          unit: SAFE_PROVIDER_TOKEN_RE.test(String(constraints?.maxPackageWeight?.unit || '').trim())
            ? String(constraints.maxPackageWeight.unit).trim().toUpperCase() : null,
        },
        first_item_rate: {
          min: safeMoney(constraints?.firstItemRate?.min),
          max: safeMoney(constraints?.firstItemRate?.max),
          currency: SAFE_PROVIDER_TOKEN_RE.test(currency) ? currency : null,
        },
        shipping_time: {
          default: {
            from: safeDuration(constraints?.shippingTime?.default?.from),
            to: safeDuration(constraints?.shippingTime?.default?.to),
          },
          customizable: typeof constraints?.shippingTime?.customizable === 'boolean'
            ? constraints.shippingTime.customizable : null,
        },
      },
    };
  }).filter(Boolean);
}

function safeReturnPolicyRows(rows) {
  return (Array.isArray(rows) ? rows : []).slice(0, 60)
    .map(row => {
      const id = String(row?.id || '').trim().toLowerCase();
      if (!UUID_RE.test(id)) return null;
      const range = String(row?.availability?.range || '').trim().toUpperCase();
      const withdrawalPeriod = String(row?.withdrawalPeriod || '').trim().toUpperCase();
      return {
        id,
        is_fulfillment: typeof row?.isFulfillment === 'boolean' ? row.isFulfillment : null,
        availability_range: SAFE_PROVIDER_TOKEN_RE.test(range) ? range : null,
        withdrawal_period: /^P[1-9][0-9]{0,2}D$/.test(withdrawalPeriod) ? withdrawalPeriod : null,
      };
    })
    .filter(Boolean);
}

function requiredProductParameterIds(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter(row => row?.requiredForProduct === true)
    .map(row => String(row.id || '').trim())
    .filter(id => /^[0-9]{1,20}$/.test(id));
}

function safeProvider422Diagnostic(payload) {
  const errors = Array.isArray(payload?.errors) ? payload.errors : [];
  const safe = [];
  for (const item of errors.slice(0, 5)) {
    const code = String(item?.code || '').trim();
    const path = String(item?.path || '').trim();
    if (!SAFE_PROVIDER_TOKEN_RE.test(code)) continue;
    safe.push(SAFE_PROVIDER_TOKEN_RE.test(path) ? `${code}@${path}` : code);
  }
  return safe.length ? `[${safe.join(',')}]` : '';
}

function goldenShippingRatePayload(input) {
  if (!input || input.name !== GOLDEN_SHIPPING_RATE_NAME || input.type !== 'PHYSICAL' || input.dispatchCountry !== 'PL') {
    throw new Error('ALLEGRO_SANDBOX_GOLDEN_SHIPPING_RATE_PAYLOAD_INVALID');
  }
  if (!Array.isArray(input.rates) || input.rates.length !== 1) throw new Error('ALLEGRO_SANDBOX_GOLDEN_SHIPPING_RATE_RATES_INVALID');
  const rate = input.rates[0];
  const methodId = sellerSettingId(rate?.deliveryMethod?.id, 'DELIVERY_METHOD');
  const quantity = Number(rate?.maxQuantityPerPackage);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 999999) throw new Error('ALLEGRO_SANDBOX_GOLDEN_SHIPPING_RATE_QUANTITY_INVALID');
  const amount = safeMoney(rate?.firstItemRate?.amount);
  if (!amount || String(rate?.firstItemRate?.currency || '').toUpperCase() !== 'PLN') throw new Error('ALLEGRO_SANDBOX_GOLDEN_SHIPPING_RATE_PRICE_INVALID');
  if (Object.prototype.hasOwnProperty.call(rate, 'nextItemRate')) throw new Error('ALLEGRO_SANDBOX_GOLDEN_SHIPPING_RATE_NEXT_ITEM_RATE_FORBIDDEN');
  const normalized = {
    name: GOLDEN_SHIPPING_RATE_NAME,
    type: 'PHYSICAL',
    dispatchCountry: 'PL',
    rates: [{
      deliveryMethod: { id: methodId },
      maxQuantityPerPackage: quantity,
      firstItemRate: { amount, currency: 'PLN' },
    }],
  };
  if (rate?.shippingTime != null) {
    const from = safeDuration(rate.shippingTime.from);
    const to = safeDuration(rate.shippingTime.to);
    if (!from || !to) throw new Error('ALLEGRO_SANDBOX_GOLDEN_SHIPPING_RATE_TIME_INVALID');
    normalized.rates[0].shippingTime = { from, to };
  }
  if (rate?.maxPackageWeight != null) {
    const value = safeWeight(rate.maxPackageWeight.value);
    const unit = String(rate.maxPackageWeight.unit || '').trim().toUpperCase();
    if (!value || !SAFE_PROVIDER_TOKEN_RE.test(unit)) throw new Error('ALLEGRO_SANDBOX_GOLDEN_SHIPPING_RATE_WEIGHT_INVALID');
    normalized.rates[0].maxPackageWeight = { value, unit };
  }
  return normalized;
}

function encrypt(token, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD);
  return [Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]).toString('base64'),
    iv.toString('base64'), cipher.getAuthTag().toString('base64')];
}

function decrypt(row, key) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(row.refresh_token_iv, 'base64'));
  decipher.setAAD(AAD);
  decipher.setAuthTag(Buffer.from(row.refresh_token_tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(row.refresh_token_ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

function createClient({ env = process.env, dbImpl, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  let cached = null;
  let inFlight = null;

  async function json(url, init) {
    let response;
    try {
      response = await fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000) });
    } catch {
      throw new Error('ALLEGRO_TRANSPORT_UNAVAILABLE');
    }
    if (!response.ok) {
      let diagnostic = '';
      if ([400, 403, 422].includes(response.status)) {
        try { diagnostic = safeProvider422Diagnostic(await response.json()); } catch { diagnostic = ''; }
      }
      throw new Error(`ALLEGRO_HTTP_${response.status}${diagnostic}`);
    }
    try { return await response.json(); } catch { throw new Error('ALLEGRO_INVALID_JSON'); }
  }

  async function accessToken(c) {
    if (cached && cached.expires > now() + 60000) return cached.token;
    if (!inFlight) {
      inFlight = (async () => {
        const db = dbImpl || require('../../db');
        const token = await db.withTransaction(async (tx) => {
          await tx.query('SELECT pg_advisory_xact_lock(218, 7411)');
          const { rows } = await tx.query('SELECT refresh_token_ciphertext, refresh_token_iv, refresh_token_tag FROM supplier_oauth_connections WHERE supplier_key = $1', [KEY]);
          let refresh;
          try { refresh = rows.length ? decrypt(rows[0], c.key) : env.ALLEGRO_SANDBOX_REFRESH_TOKEN?.trim(); }
          catch { throw new Error('ALLEGRO_REFRESH_TOKEN_UNREADABLE'); }
          if (!refresh) throw new Error('ALLEGRO_REFRESH_TOKEN_REQUIRED');
          const startedAt = now();
          const payload = await json(TOKEN, {
            method: 'POST',
            headers: {
              Authorization: `Basic ${Buffer.from(`${env.ALLEGRO_SANDBOX_CLIENT_ID.trim()}:${env.ALLEGRO_SANDBOX_CLIENT_SECRET.trim()}`).toString('base64')}`,
              'Content-Type': 'application/x-www-form-urlencoded',
              'User-Agent': c.userAgent,
            },
            body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh }).toString(),
          });
          if (typeof payload?.access_token !== 'string' || !payload.access_token.trim()
            || typeof payload.refresh_token !== 'string' || !payload.refresh_token.trim()
            || !Number.isFinite(payload.expires_in) || payload.expires_in <= 60
            || String(payload.token_type).toLowerCase() !== 'bearer') throw new Error('ALLEGRO_INVALID_TOKEN_RESPONSE');
          const [ciphertext, iv, tag] = encrypt(payload.refresh_token, c.key);
          await tx.query(`INSERT INTO supplier_oauth_connections
            (supplier_key, access_token_ciphertext, access_token_iv, access_token_tag, access_expires_at,
             refresh_token_ciphertext, refresh_token_iv, refresh_token_tag, token_type, last_refreshed_at)
            VALUES ($1, '', '', '', to_timestamp(0), $2, $3, $4, 'Bearer', now())
            ON CONFLICT (supplier_key) DO UPDATE SET
              refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
              refresh_token_iv = EXCLUDED.refresh_token_iv, refresh_token_tag = EXCLUDED.refresh_token_tag,
              updated_at = now(), last_refreshed_at = now()`, [KEY, ciphertext, iv, tag]);
          return { token: payload.access_token, expires: startedAt + payload.expires_in * 1000 };
        });
        cached = token;
        return token.token;
      })().finally(() => { inFlight = null; });
    }
    return inFlight;
  }

  async function authorizedJson(c, url, init = {}) {
    const bearer = await accessToken(c);
    try {
      return await json(url.toString(), {
        ...init,
        headers: {
          Authorization: `Bearer ${bearer}`,
          Accept: 'application/vnd.allegro.public.v1+json',
          'Accept-Language': 'pl-PL',
          'User-Agent': c.userAgent,
          ...(init.headers || {}),
        },
      });
    } catch (error) {
      if (error.message === 'ALLEGRO_HTTP_401') cached = null;
      throw error;
    }
  }

  async function get(path, params = {}) {
    const c = configuration(env);
    if (!/^\/sale\/(offers|product-offers\/[0-9]{1,30})$/.test(path)) throw new Error('ALLEGRO_READ_PATH_NOT_ALLOWED');
    const url = new URL(path, API);
    url.search = new URLSearchParams(params).toString();
    return authorizedJson(c, url, { method: 'GET' });
  }

  async function listSellerOrders({
    status = 'READY_FOR_PROCESSING',
    limit = 20,
    boughtAtGte = null,
  } = {}) {
    const c = configuration(env);
    if (status !== 'READY_FOR_PROCESSING') {
      throw new Error('ALLEGRO_SELLER_ORDERS_STATUS_UNSUPPORTED');
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('ALLEGRO_SELLER_ORDERS_LIMIT_INVALID');
    }
    const params = {
      status,
      limit: String(limit),
      sort: '-lineItems.boughtAt',
    };
    if (boughtAtGte != null) {
      const millis = Date.parse(String(boughtAtGte));
      if (!Number.isFinite(millis)) throw new Error('ALLEGRO_SELLER_ORDERS_BOUGHT_AT_GTE_INVALID');
      params['lineItems.boughtAt.gte'] = new Date(millis).toISOString();
    }
    const url = new URL('/order/checkout-forms', API);
    url.search = new URLSearchParams(params).toString();
    return authorizedJson(c, url, { method: 'GET' });
  }

  async function getSellerOrder(checkoutFormId) {
    const c = configuration(env);
    const id = String(checkoutFormId || '').trim().toLowerCase();
    if (!UUID_RE.test(id)) throw new Error('ALLEGRO_CHECKOUT_FORM_ID_INVALID');
    const url = new URL(`/order/checkout-forms/${id}`, API);
    return authorizedJson(c, url, { method: 'GET' });
  }

  async function getShippingRateDetail(shippingRateId) {
    const c = configuration(env);
    const id = sellerSettingId(shippingRateId, 'SHIPPING_RATE');
    const payload = await authorizedJson(c, new URL(`/sale/shipping-rates/${id}`, API), { method: 'GET' });
    const detail = safeShippingRateDetail(payload);
    if (!detail || detail.id !== id) throw new Error('ALLEGRO_SANDBOX_SHIPPING_RATE_DETAIL_INVALID');
    return detail;
  }

  async function getDeliveryMethods({ marketplace = 'allegro-pl' } = {}) {
    const c = configuration(env);
    if (marketplace !== 'allegro-pl') throw new Error('ALLEGRO_SANDBOX_DELIVERY_MARKETPLACE_INVALID');
    const url = new URL('/sale/delivery-methods', API);
    url.search = new URLSearchParams({ marketplace }).toString();
    const payload = await authorizedJson(c, url, { method: 'GET' });
    return { delivery_methods: safeDeliveryMethodRows(payload?.deliveryMethods) };
  }

  async function searchProducts(phrase, { limit = 10 } = {}) {
    const c = seedConfiguration(env);
    const q = String(phrase || '').trim();
    if (q.length < 2 || q.length > 120) throw new Error('ALLEGRO_SANDBOX_SEED_QUERY_INVALID');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new Error('ALLEGRO_SANDBOX_SEED_LIMIT_INVALID');
    const url = new URL('/sale/products', API);
    url.search = new URLSearchParams({ phrase: q }).toString();
    const payload = await authorizedJson(c, url, { method: 'GET' });
    const products = Array.isArray(payload?.products) ? payload.products.slice(0, limit) : [];
    return { ...payload, products };
  }

  async function inspectProductPublishability(productId) {
    const c = seedConfiguration(env);
    const id = String(productId || '').trim();
    if (!/^[A-Za-z0-9-]{1,80}$/.test(id)) throw new Error('ALLEGRO_SANDBOX_SEED_PRODUCT_ID_INVALID');
    const product = await authorizedJson(c, new URL(`/sale/products/${id}`, API), { method: 'GET' });
    const categoryId = String(product?.category?.id || '').trim();
    if (!/^[0-9]{1,20}$/.test(categoryId)) throw new Error('ALLEGRO_SANDBOX_SEED_CATEGORY_ID_MISSING');
    const category = await authorizedJson(c, new URL(`/sale/categories/${categoryId}/parameters`, API), { method: 'GET' });
    const required = requiredProductParameterIds(category?.parameters);
    const present = new Set((Array.isArray(product?.parameters) ? product.parameters : [])
      .map(row => String(row?.id || '').trim()));
    const missing = required.filter(idValue => !present.has(idValue));
    const productSafety = product?.productSafety || {};
    const imageCount = Array.isArray(product?.images) ? product.images.length : 0;
    const safetyInformationPresent = Boolean(productSafety.safetyInformation || product?.safetyInformation);
    return {
      product_id: id,
      category_id: categoryId,
      image_count: imageCount,
      safety_information_present: safetyInformationPresent,
      responsible_producer_present: Boolean(productSafety.responsibleProducer || product?.responsibleProducer),
      missing_required_product_parameter_ids: missing,
      publishable: imageCount > 0 && safetyInformationPresent && missing.length === 0,
    };
  }

  async function ensureGoldenResponsibleProducer() {
    const c = seedConfiguration(env);
    const listUrl = new URL('/sale/responsible-producers', API);
    listUrl.search = new URLSearchParams({ limit: '1000', offset: '0' }).toString();
    const listed = await authorizedJson(c, listUrl, { method: 'GET' });
    const matches = (Array.isArray(listed?.responsibleProducers) ? listed.responsibleProducers : [])
      .filter(row => row?.name === GOLDEN_PRODUCER_NAME && UUID_RE.test(String(row?.id || '').toLowerCase()));
    if (matches.length > 1) throw new Error('ALLEGRO_SANDBOX_GOLDEN_PRODUCER_AMBIGUOUS');
    if (matches.length === 1) return { id: String(matches[0].id).toLowerCase(), created: false };
    const created = await authorizedJson(c, new URL('/sale/responsible-producers', API), {
      method: 'POST',
      headers: { 'Content-Type': 'application/vnd.allegro.public.v1+json' },
      body: JSON.stringify({ name: GOLDEN_PRODUCER_NAME, producerData: GOLDEN_PRODUCER_DATA }),
    });
    return { id: sellerSettingId(created?.id, 'GOLDEN_PRODUCER'), created: true };
  }

  async function createDraftOffer({ productId, name, externalId, pricePln, stock = 10, responsibleProducerId }) {
    const c = seedConfiguration(env);
    const id = String(productId || '').trim();
    const title = String(name || '').trim();
    const external = String(externalId || '').trim();
    const price = Number(pricePln);
    if (!/^[A-Za-z0-9-]{1,80}$/.test(id)) throw new Error('ALLEGRO_SANDBOX_SEED_PRODUCT_ID_INVALID');
    if (title.length < 3 || title.length > 75) throw new Error('ALLEGRO_SANDBOX_SEED_NAME_INVALID');
    if (!/^komerce-sandbox-publishable-seed-[1-3]$/.test(external)) throw new Error('ALLEGRO_SANDBOX_SEED_EXTERNAL_ID_INVALID');
    if (!Number.isFinite(price) || price <= 0 || price > 1000000) throw new Error('ALLEGRO_SANDBOX_SEED_PRICE_INVALID');
    if (!Number.isSafeInteger(stock) || stock < 1 || stock > 1000) throw new Error('ALLEGRO_SANDBOX_SEED_STOCK_INVALID');
    const producer = sellerSettingId(responsibleProducerId, 'GOLDEN_PRODUCER');
    const payload = {
      productSet: [{ product: { id }, responsibleProducer: { type: 'ID', id: producer } }],
      name: title,
      external: { id: external },
      sellingMode: { price: { amount: price.toFixed(2), currency: 'PLN' } },
      stock: { available: stock },
      publication: { status: 'INACTIVE' },
    };
    const url = new URL('/sale/product-offers', API);
    return authorizedJson(c, url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/vnd.allegro.public.v1+json' },
      body: JSON.stringify(payload),
    });
  }

  async function getSellerSettings() {
    const c = configuration(env);
    const [shipping, returns, implied] = await Promise.all([
      authorizedJson(c, new URL('/sale/shipping-rates', API), { method: 'GET' }),
      authorizedJson(c, new URL('/after-sales-service-conditions/return-policies', API), { method: 'GET' }),
      authorizedJson(c, new URL('/after-sales-service-conditions/implied-warranties', API), { method: 'GET' }),
    ]);
    return {
      shipping_rates: safeShippingRateRows(shipping?.shippingRates),
      return_policies: safeReturnPolicyRows(returns?.returnPolicies),
      implied_warranties: safeSettingRows(implied?.impliedWarranties),
    };
  }

  async function createGoldenShippingRate(payload) {
    const c = seedConfiguration(env);
    const body = goldenShippingRatePayload(payload);
    const created = await authorizedJson(c, new URL('/sale/shipping-rates', API), {
      method: 'POST',
      headers: { 'Content-Type': 'application/vnd.allegro.public.v1+json' },
      body: JSON.stringify(body),
    });
    const detail = safeShippingRateDetail(created);
    if (!detail?.id) throw new Error('ALLEGRO_SANDBOX_GOLDEN_SHIPPING_RATE_CREATE_INVALID');
    return detail;
  }

  async function completeSeedOffer(offerId, { shippingRateId, returnPolicyId, impliedWarrantyId, responsibleProducerId }) {
    const c = seedConfiguration(env);
    const id = publicationOfferId(offerId);
    const shipping = sellerSettingId(shippingRateId, 'SHIPPING_RATE');
    const returns = sellerSettingId(returnPolicyId, 'RETURN_POLICY');
    const implied = sellerSettingId(impliedWarrantyId, 'IMPLIED_WARRANTY');
    const producer = sellerSettingId(responsibleProducerId, 'GOLDEN_PRODUCER');

    const current = await authorizedJson(c, new URL(`/sale/product-offers/${id}`, API), { method: 'GET' });
    const productId = String(current?.productSet?.[0]?.product?.id || '').trim();
    if (!/^[A-Za-z0-9-]{1,80}$/.test(productId)) throw new Error('ALLEGRO_SANDBOX_SEED_PRODUCT_ID_MISSING');

    // Re-sending the canonical product id intentionally refreshes catalog-owned
    // product data, including GPSR information when Allegro's product catalog has it.
    // We only bind seller-owned settings that already exist on this account.
    const payload = {
      productSet: [{ product: { id: productId }, responsibleProducer: { type: 'ID', id: producer } }],
      delivery: { shippingRates: { id: shipping } },
      afterSalesServices: {
        impliedWarranty: { id: implied },
        returnPolicy: { id: returns },
      },
    };
    const patched = await authorizedJson(c, new URL(`/sale/product-offers/${id}`, API), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/vnd.allegro.public.v1+json' },
      body: JSON.stringify(payload),
    });
    const product = patched?.productSet?.[0] || {};
    return {
      offer_id: id,
      product_id: productId,
      publication_status: String(patched?.publication?.status || 'UNKNOWN').toUpperCase(),
      delivery_bound: String(patched?.delivery?.shippingRates?.id || '').toLowerCase() === shipping,
      return_policy_bound: String(patched?.afterSalesServices?.returnPolicy?.id || '').toLowerCase() === returns,
      implied_warranty_bound: String(patched?.afterSalesServices?.impliedWarranty?.id || '').toLowerCase() === implied,
      responsible_producer_present: Boolean(product?.responsibleProducer),
      safety_information_present: Boolean(product?.safetyInformation),
    };
  }

  async function activateOffer(offerId, { commandId = crypto.randomUUID() } = {}) {
    const c = seedConfiguration(env);
    const id = publicationOfferId(offerId);
    const command = publicationCommandId(commandId);
    const url = new URL(`/sale/offer-publication-commands/${command}`, API);
    const payload = {
      offerCriteria: [{ offers: [{ id }], type: 'CONTAINS_OFFERS' }],
      publication: { action: 'ACTIVATE' },
    };
    const provider = await authorizedJson(c, url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/vnd.allegro.public.v1+json' },
      body: JSON.stringify(payload),
    });
    return { offer_id: id, command_id: command, provider };
  }

  async function getPublicationTasks(commandId, { limit = 100, offset = 0 } = {}) {
    const c = seedConfiguration(env);
    const command = publicationCommandId(commandId);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000
      || !Number.isSafeInteger(offset) || offset < 0 || offset > 999) {
      throw new Error('ALLEGRO_SANDBOX_PUBLICATION_TASK_PAGE_INVALID');
    }
    const url = new URL(`/sale/offer-publication-commands/${command}/tasks`, API);
    url.search = new URLSearchParams({ limit: String(limit), offset: String(offset) }).toString();
    return authorizedJson(c, url, { method: 'GET' });
  }

  return {
    get,
    listSellerOrders,
    getSellerOrder,
    getShippingRateDetail,
    getDeliveryMethods,
    searchProducts,
    inspectProductPublishability,
    ensureGoldenResponsibleProducer,
    createDraftOffer,
    getSellerSettings,
    createGoldenShippingRate,
    completeSeedOffer,
    activateOffer,
    getPublicationTasks,
  };
}

const client = createClient();
module.exports = {
  configuration,
  seedConfiguration,
  safeProvider422Diagnostic,
  safeSettingRows, safeShippingRateRows, safeShippingRateDetail, safeDeliveryMethodRows, safeReturnPolicyRows,
  goldenShippingRatePayload,
  requiredProductParameterIds,
  GOLDEN_PRODUCER_NAME,
  GOLDEN_SHIPPING_RATE_NAME,
  createClient,
  get: client.get,
  listSellerOrders: client.listSellerOrders,
  getSellerOrder: client.getSellerOrder,
  getShippingRateDetail: client.getShippingRateDetail,
  getDeliveryMethods: client.getDeliveryMethods,
  searchProducts: client.searchProducts,
  inspectProductPublishability: client.inspectProductPublishability,
  ensureGoldenResponsibleProducer: client.ensureGoldenResponsibleProducer,
  createDraftOffer: client.createDraftOffer,
  getSellerSettings: client.getSellerSettings,
  createGoldenShippingRate: client.createGoldenShippingRate,
  completeSeedOffer: client.completeSeedOffer,
  activateOffer: client.activateOffer,
  getPublicationTasks: client.getPublicationTasks,
};
