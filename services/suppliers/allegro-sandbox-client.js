/**
 * @komerce-arch
 * @role          allegro-sandbox-client
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        sandbox credentials, bounded read request, guarded seller draft seed/publication
 * @outputs       provider JSON, ephemeral access token
 * @depends       db.js, node:crypto
 * @used-by       services/suppliers/connectors/allegro-connector.js, services/suppliers/allegro-purchase-reconciliation.js, scripts/allegro-sandbox-check.js
 * @db-read       supplier_oauth_connections
 * @db-write      supplier_oauth_connections
 * @db-txn        owned
 * @doctrine      docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md, docs/doctrine/DOCTRINE_PROCUREMENT_FULFILLMENT.md
 * @impact-areas  catalog, supplier-import, purchasing, secrets
 */
'use strict';

const crypto = require('node:crypto');
const API = 'https://api.allegro.pl.allegrosandbox.pl';
const TOKEN = 'https://allegro.pl.allegrosandbox.pl/auth/oauth/token';
const KEY = 'allegro_sandbox';
const AAD = Buffer.from('komerce:supplier-oauth:allegro_sandbox:refresh');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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
    // Never expose provider bodies or fetch errors: they can echo credentials.
    if (!response.ok) throw new Error(`ALLEGRO_HTTP_${response.status}`);
    try { return await response.json(); } catch { throw new Error('ALLEGRO_INVALID_JSON'); }
  }

  async function accessToken(c) {
    if (cached && cached.expires > now() + 60000) return cached.token;
    if (!inFlight) {
      inFlight = (async () => {
        const db = dbImpl || require('../../db');
        const token = await db.withTransaction(async (tx) => {
          // Serializes refresh across replicas AND the first bootstrap (no row yet).
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
          // Legacy NOT NULL access columns hold empty sentinels, never an access token.
          // The rotated refresh token must commit before a bearer is released to callers.
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
    const c = configuration(env); // Gate is rechecked for every call, even with a cached token.
    if (!/^\/sale\/(offers|product-offers\/[0-9]{1,30})$/.test(path)) throw new Error('ALLEGRO_READ_PATH_NOT_ALLOWED');
    const url = new URL(path, API);
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

  async function searchProducts(phrase, { limit = 10 } = {}) {
    const c = seedConfiguration(env);
    const q = String(phrase || '').trim();
    if (q.length < 2 || q.length > 120) throw new Error('ALLEGRO_SANDBOX_SEED_QUERY_INVALID');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new Error('ALLEGRO_SANDBOX_SEED_LIMIT_INVALID');
    const url = new URL('/sale/products', API);
    // The live contract does not expose a generic `limit` query parameter here.
    // Keep our operator bound local rather than sending an unsupported parameter.
    url.search = new URLSearchParams({ phrase: q }).toString();
    const payload = await authorizedJson(c, url, { method: 'GET' });
    const products = Array.isArray(payload?.products) ? payload.products.slice(0, limit) : [];
    return { ...payload, products };
  }

  async function createDraftOffer({ productId, name, externalId, pricePln, stock = 10 }) {
    const c = seedConfiguration(env);
    const id = String(productId || '').trim();
    const title = String(name || '').trim();
    const external = String(externalId || '').trim();
    const price = Number(pricePln);
    if (!/^[A-Za-z0-9-]{1,80}$/.test(id)) throw new Error('ALLEGRO_SANDBOX_SEED_PRODUCT_ID_INVALID');
    if (title.length < 3 || title.length > 75) throw new Error('ALLEGRO_SANDBOX_SEED_NAME_INVALID');
    if (!/^komerce-sandbox-seed-[1-3]$/.test(external)) throw new Error('ALLEGRO_SANDBOX_SEED_EXTERNAL_ID_INVALID');
    if (!Number.isFinite(price) || price <= 0 || price > 1000000) throw new Error('ALLEGRO_SANDBOX_SEED_PRICE_INVALID');
    if (!Number.isSafeInteger(stock) || stock < 1 || stock > 1000) throw new Error('ALLEGRO_SANDBOX_SEED_STOCK_INVALID');
    // Deliberately mirror Allegro's minimal draft contract. Product-specific
    // parameters, delivery, payments and location must not be guessed by Komerce.
    const payload = {
      productSet: [{ product: { id } }],
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

  return { get, getSellerOrder, searchProducts, createDraftOffer, activateOffer, getPublicationTasks };
}

const client = createClient();
module.exports = {
  configuration,
  seedConfiguration,
  createClient,
  get: client.get,
  getSellerOrder: client.getSellerOrder,
  searchProducts: client.searchProducts,
  createDraftOffer: client.createDraftOffer,
  activateOffer: client.activateOffer,
  getPublicationTasks: client.getPublicationTasks,
};
