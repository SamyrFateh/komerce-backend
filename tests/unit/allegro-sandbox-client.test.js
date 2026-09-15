'use strict';
jest.mock('../../db', () => ({ withTransaction: jest.fn() }));
const { createClient, configuration, seedConfiguration } = require('../../services/suppliers/allegro-sandbox-client');
const env = () => ({ KOMERCE_ALLOW_ALLEGRO_SANDBOX: '1', ALLEGRO_SANDBOX_CLIENT_ID: 'app',
  ALLEGRO_SANDBOX_CLIENT_SECRET: 'secret', ALLEGRO_SANDBOX_USER_AGENT: 'KomerceTest/1',
  ALLEGRO_SANDBOX_TOKEN_ENCRYPTION_KEY: 'ab'.repeat(32), ALLEGRO_SANDBOX_REFRESH_TOKEN: 'bootstrap' });
const token = (suffix = '1') => ({ access_token: `access-${suffix}`, refresh_token: `refresh-${suffix}`, expires_in: 3600, token_type: 'bearer' });
const ok = data => ({ ok: true, json: async () => data });
function setup() {
  let row;
  let time = 0;
  const queries = [];
  const tx = { query: jest.fn(async (sql, params) => {
    queries.push([sql, params]);
    if (sql.startsWith('SELECT refresh')) return { rows: row ? [row] : [] };
    if (sql.startsWith('INSERT')) row = { refresh_token_ciphertext: params[1], refresh_token_iv: params[2], refresh_token_tag: params[3] };
    return { rows: [] };
  }) };
  const dbImpl = { withTransaction: jest.fn(fn => fn(tx)) };
  const fetchImpl = jest.fn(async url => url.includes('/auth/') ? ok(token()) : ok({ offers: [] }));
  const runtime = env();
  const opts = { env: runtime, dbImpl, fetchImpl, now: () => time };
  return { client: createClient(opts), opts, runtime, tx, queries, dbImpl, fetchImpl,
    advance: () => { time += 3600000; }, row: () => row };
}
test('disabled/missing/malformed config fails before any side effect', async () => {
  expect(() => configuration({})).toThrow('DISABLED');
  for (const key of ['CLIENT_ID', 'CLIENT_SECRET', 'USER_AGENT', 'TOKEN_ENCRYPTION_KEY']) {
    expect(() => configuration({ ...env(), [`ALLEGRO_SANDBOX_${key}`]: ' ' })).toThrow(`${key} requis`);
  }
  expect(() => configuration({ ...env(), ALLEGRO_SANDBOX_TOKEN_ENCRYPTION_KEY: 'abc' })).toThrow('32 octets');
  const s = setup();
  for (const path of ['https://evil.test', '//evil.test', '/order/checkout-forms', '/sale/product-offers/../offers', '/sale/product-offers/abc']) {
    await expect(s.client.get(path)).rejects.toThrow('PATH_NOT_ALLOWED');
  }
  expect(s.fetchImpl).not.toHaveBeenCalled();
});
test('sandbox only, encrypted refresh commit, concurrent single flight and ephemeral bearer', async () => {
  const s = setup();
  await Promise.all([s.client.get('/sale/offers', { limit: 1 }), s.client.get('/sale/product-offers/123')]);
  expect(s.dbImpl.withTransaction).toHaveBeenCalledTimes(1);
  expect(s.queries[0][0]).toContain('pg_advisory_xact_lock');
  expect(JSON.stringify(s.queries)).not.toMatch(/access-1|refresh-1|bootstrap/);
  expect(s.row().refresh_token_ciphertext).toBeTruthy();
  for (const [url, init] of s.fetchImpl.mock.calls) {
    expect(new URL(url).hostname).toMatch(/\.allegrosandbox\.pl$/);
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeDefined();
    expect(init.headers['User-Agent']).toBe('KomerceTest/1');
  }
  await s.client.get('/sale/offers');
  expect(s.dbImpl.withTransaction).toHaveBeenCalledTimes(1);
  s.runtime.KOMERCE_ALLOW_ALLEGRO_SANDBOX = '0';
  await expect(s.client.get('/sale/offers')).rejects.toThrow('DISABLED');
});
test('restart uses persisted rotated refresh rather than stale environment bootstrap', async () => {
  const s = setup();
  await s.client.get('/sale/offers');
  const restarted = createClient(s.opts);
  await restarted.get('/sale/offers');
  const posts = s.fetchImpl.mock.calls.filter(([u]) => u.includes('/auth/'));
  expect(new URLSearchParams(posts[1][1].body).get('refresh_token')).toBe('refresh-1');
  s.advance();
  await s.client.get('/sale/offers');
  expect(s.dbImpl.withTransaction).toHaveBeenCalledTimes(3);
});
test('no bearer released on failed persistence/commit; no fallback after decryption failure', async () => {
  const s = setup();
  s.dbImpl.withTransaction.mockImplementationOnce(async fn => { await fn(s.tx); throw new Error('commit failed'); });
  await expect(s.client.get('/sale/offers')).rejects.toThrow('commit failed');
  expect(s.fetchImpl).toHaveBeenCalledTimes(1);
  s.runtime.ALLEGRO_SANDBOX_TOKEN_ENCRYPTION_KEY = 'cd'.repeat(32);
  await expect(s.client.get('/sale/offers')).rejects.toThrow('UNREADABLE');
  expect(s.fetchImpl).toHaveBeenCalledTimes(1);
});
test('bootstrap absent fails before provider request', async () => {
  const s = setup(); delete s.runtime.ALLEGRO_SANDBOX_REFRESH_TOKEN;
  await expect(s.client.get('/sale/offers')).rejects.toThrow('TOKEN_REQUIRED');
  expect(s.fetchImpl).not.toHaveBeenCalled();
});
test.each([null, {}, { ...token(), access_token: '' }, { ...token(), refresh_token: '' },
  { ...token(), expires_in: '3600' }, { ...token(), expires_in: 30 }, { ...token(), token_type: 'basic' }])('invalid token response never persists: %j', async payload => {
  const s = setup(); s.fetchImpl.mockResolvedValueOnce(ok(payload));
  await expect(s.client.get('/sale/offers')).rejects.toThrow('INVALID_TOKEN_RESPONSE');
  expect(s.row()).toBeUndefined();
});
test('transport/body failures sanitized and 401 invalidates cache without replaying requests', async () => {
  const s = setup();
  s.fetchImpl.mockRejectedValueOnce(new Error('SECRET echoed'));
  await expect(s.client.get('/sale/offers')).rejects.toThrow('ALLEGRO_TRANSPORT_UNAVAILABLE');
  s.fetchImpl.mockResolvedValueOnce({ ok: true, json: async () => { throw new Error('SECRET'); } });
  await expect(s.client.get('/sale/offers')).rejects.toThrow('ALLEGRO_INVALID_JSON');
  await s.client.get('/sale/offers');
  s.fetchImpl.mockResolvedValueOnce({ ok: false, status: 401 });
  await expect(s.client.get('/sale/offers')).rejects.toThrow('ALLEGRO_HTTP_401');
  await s.client.get('/sale/offers');
  s.fetchImpl.mockResolvedValueOnce({ ok: false, status: 429 });
  await expect(s.client.get('/sale/offers')).rejects.toThrow('ALLEGRO_HTTP_429');
});
test('default db, environment and clock are usable through the same boundary', async () => {
  const previous = process.env; const oldFetch = globalThis.fetch;
  process.env = { ...process.env, ...env() };
  globalThis.fetch = jest.fn().mockResolvedValueOnce(ok(token())).mockResolvedValue(ok({ offers: [] }));
  require('../../db').withTransaction.mockImplementation(fn => fn({ query: async () => ({ rows: [] }) }));
  try { await createClient().get('/sale/offers'); } finally { process.env = previous; globalThis.fetch = oldFetch; }
});

test('seller sandbox seed has an independent staging-only kill switch', () => {
  const seedEnv = { ...env(), KOMERCE_ENV: 'staging', KOMERCE_ALLOW_ALLEGRO_SANDBOX_SEED: '1' };
  expect(() => seedConfiguration(seedEnv)).not.toThrow();
  expect(() => seedConfiguration({ ...seedEnv, KOMERCE_ALLOW_ALLEGRO_SANDBOX_SEED: '0' })).toThrow('SEED_DISABLED');
  expect(() => seedConfiguration({ ...seedEnv, KOMERCE_ENV: 'production' })).toThrow('STAGING_ONLY');
  expect(() => seedConfiguration({ ...seedEnv, KOMERCE_ENV: '', NODE_ENV: 'production' })).toThrow('STAGING_ONLY');
});

test('seller seed search and draft creation remain sandbox-bound and token-encapsulated', async () => {
  const s = setup();
  s.runtime.KOMERCE_ENV = 'staging';
  s.runtime.KOMERCE_ALLOW_ALLEGRO_SANDBOX_SEED = '1';
  s.fetchImpl.mockImplementation(async (url, init) => {
    if (url.includes('/auth/')) return ok(token());
    if (url.includes('/sale/products')) return ok({ products: [{ id: 'abc-123', name: 'USB Cable' }] });
    if (url.endsWith('/sale/product-offers') && init.method === 'POST') return ok({ id: '987654321' });
    return ok({ offers: [] });
  });
  const found = await s.client.searchProducts('usb cable', { limit: 3 });
  expect(found.products[0].id).toBe('abc-123');
  const created = await s.client.createDraftOffer({
    productId: 'abc-123', name: 'Komerce Sandbox USB Cable', pricePln: 29.9, stock: 12,
  });
  expect(created).toEqual({ id: '987654321' });
  expect(s.dbImpl.withTransaction).toHaveBeenCalledTimes(1);
  const providerCalls = s.fetchImpl.mock.calls.filter(([url]) => !url.includes('/auth/'));
  expect(providerCalls).toHaveLength(2);
  for (const [url, init] of providerCalls) {
    expect(new URL(url).hostname).toBe('api.allegro.pl.allegrosandbox.pl');
    expect(init.headers.Authorization).toBe('Bearer access-1');
    expect(init.redirect).toBe('error');
  }
  const payload = JSON.parse(providerCalls[1][1].body);
  expect(payload.productSet).toEqual([{ product: { id: 'abc-123' } }]);
  expect(payload.publication).toEqual({ status: 'INACTIVE' });
  expect(payload.sellingMode).toEqual({ format: 'BUY_NOW', price: { amount: '29.90', currency: 'PLN' } });
  expect(payload.stock).toEqual({ available: 12 });
});

test('seller seed input validation fails before provider side effects', async () => {
  const s = setup();
  s.runtime.KOMERCE_ENV = 'staging';
  s.runtime.KOMERCE_ALLOW_ALLEGRO_SANDBOX_SEED = '1';
  await expect(s.client.searchProducts('x')).rejects.toThrow('QUERY_INVALID');
  await expect(s.client.searchProducts('valid', { limit: 21 })).rejects.toThrow('LIMIT_INVALID');
  for (const args of [
    { productId: '../bad', name: 'Valid name', pricePln: 10, stock: 1 },
    { productId: 'abc-123', name: 'x', pricePln: 10, stock: 1 },
    { productId: 'abc-123', name: 'Valid name', pricePln: 0, stock: 1 },
    { productId: 'abc-123', name: 'Valid name', pricePln: 10, stock: 0 },
  ]) {
    await expect(s.client.createDraftOffer(args)).rejects.toThrow('ALLEGRO_SANDBOX_SEED_');
  }
  expect(s.fetchImpl).not.toHaveBeenCalled();
});
