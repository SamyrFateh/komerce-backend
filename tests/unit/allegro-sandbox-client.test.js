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

test('seller seed search uses only supported provider params and bounds results locally', async () => {
  const s = setup();
  s.runtime.KOMERCE_ENV = 'staging';
  s.runtime.KOMERCE_ALLOW_ALLEGRO_SANDBOX_SEED = '1';
  s.fetchImpl.mockImplementation(async url => {
    if (url.includes('/auth/')) return ok(token());
    if (url.includes('/sale/products')) return ok({ products: [
      { id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' },
    ] });
    return ok({ offers: [] });
  });
  const found = await s.client.searchProducts('usb cable', { limit: 3 });
  expect(found.products.map(p => p.id)).toEqual(['p1', 'p2', 'p3']);
  const providerUrl = new URL(s.fetchImpl.mock.calls.find(([url]) => url.includes('/sale/products'))[0]);
  expect(providerUrl.searchParams.get('phrase')).toBe('usb cable');
  expect(providerUrl.searchParams.has('limit')).toBe(false);
});

test('seller draft creation stays sandbox-bound, minimal and token-encapsulated', async () => {
  const s = setup();
  s.runtime.KOMERCE_ENV = 'staging';
  s.runtime.KOMERCE_ALLOW_ALLEGRO_SANDBOX_SEED = '1';
  s.fetchImpl.mockImplementation(async (url, init) => {
    if (url.includes('/auth/')) return ok(token());
    if (url.endsWith('/sale/product-offers') && init.method === 'POST') return ok({ id: '987654321' });
    return ok({ offers: [] });
  });
  const created = await s.client.createDraftOffer({
    productId: 'abc-123', name: 'Komerce Sandbox USB Cable', externalId: 'komerce-sandbox-seed-1',
    pricePln: 29.9, stock: 12,
  });
  expect(created).toEqual({ id: '987654321' });
  expect(s.dbImpl.withTransaction).toHaveBeenCalledTimes(1);
  const providerCall = s.fetchImpl.mock.calls.find(([url]) => url.endsWith('/sale/product-offers'));
  const [url, init] = providerCall;
  expect(new URL(url).hostname).toBe('api.allegro.pl.allegrosandbox.pl');
  expect(init.headers.Authorization).toBe('Bearer access-1');
  expect(init.redirect).toBe('error');
  const payload = JSON.parse(init.body);
  expect(payload).toEqual({
    productSet: [{ product: { id: 'abc-123' } }],
    name: 'Komerce Sandbox USB Cable',
    external: { id: 'komerce-sandbox-seed-1' },
    sellingMode: { price: { amount: '29.90', currency: 'PLN' } },
    stock: { available: 12 },
    publication: { status: 'INACTIVE' },
  });
});

test('seller seed input validation fails before provider side effects', async () => {
  const s = setup();
  s.runtime.KOMERCE_ENV = 'staging';
  s.runtime.KOMERCE_ALLOW_ALLEGRO_SANDBOX_SEED = '1';
  await expect(s.client.searchProducts('x')).rejects.toThrow('QUERY_INVALID');
  await expect(s.client.searchProducts('valid', { limit: 21 })).rejects.toThrow('LIMIT_INVALID');
  const valid = { productId: 'abc-123', name: 'Valid name', externalId: 'komerce-sandbox-seed-1', pricePln: 10, stock: 1 };
  for (const args of [
    { ...valid, productId: '../bad' },
    { ...valid, name: 'x' },
    { ...valid, externalId: 'bad' },
    { ...valid, pricePln: 0 },
    { ...valid, stock: 0 },
  ]) {
    await expect(s.client.createDraftOffer(args)).rejects.toThrow('ALLEGRO_SANDBOX_SEED_');
  }
  expect(s.fetchImpl).not.toHaveBeenCalled();
});

test('seller publication activation is sandbox-only, explicit ACTIVATE and asynchronously inspectable', async () => {
  const s = setup();
  s.runtime.KOMERCE_ENV = 'staging';
  s.runtime.KOMERCE_ALLOW_ALLEGRO_SANDBOX_SEED = '1';
  const commandId = '123e4567-e89b-42d3-a456-426614174000';
  s.fetchImpl.mockImplementation(async (url, init) => {
    if (url.includes('/auth/')) return ok(token());
    if (url.includes(`/sale/offer-publication-commands/${commandId}/tasks`)) {
      return ok({ tasks: [{ offer: { id: '987654321' }, status: 'SUCCESS', errors: [] }] });
    }
    if (url.endsWith(`/sale/offer-publication-commands/${commandId}`) && init.method === 'PUT') {
      return ok({ id: commandId, completedAt: null, taskCount: { total: 0, success: 0, failed: 0 } });
    }
    return ok({});
  });

  const activated = await s.client.activateOffer('987654321', { commandId });
  expect(activated).toMatchObject({ offer_id: '987654321', command_id: commandId,
    provider: { id: commandId, completedAt: null } });
  const putCall = s.fetchImpl.mock.calls.find(([url, init]) => url.endsWith(`/sale/offer-publication-commands/${commandId}`) && init.method === 'PUT');
  expect(putCall).toBeTruthy();
  expect(new URL(putCall[0]).hostname).toBe('api.allegro.pl.allegrosandbox.pl');
  expect(putCall[1].headers['Content-Type']).toBe('application/vnd.allegro.public.v1+json');
  expect(JSON.parse(putCall[1].body)).toEqual({
    offerCriteria: [{ offers: [{ id: '987654321' }], type: 'CONTAINS_OFFERS' }],
    publication: { action: 'ACTIVATE' },
  });

  const tasks = await s.client.getPublicationTasks(commandId, { limit: 1, offset: 0 });
  expect(tasks.tasks[0]).toMatchObject({ offer: { id: '987654321' }, status: 'SUCCESS' });
  const taskCall = s.fetchImpl.mock.calls.find(([url, init]) => url.includes(`/sale/offer-publication-commands/${commandId}/tasks`) && init.method === 'GET');
  const taskUrl = new URL(taskCall[0]);
  expect(taskUrl.searchParams.get('limit')).toBe('1');
  expect(taskUrl.searchParams.get('offset')).toBe('0');
});

test('seller publication mutation validates exact offer, UUID and page before provider side effects', async () => {
  const s = setup();
  s.runtime.KOMERCE_ENV = 'staging';
  s.runtime.KOMERCE_ALLOW_ALLEGRO_SANDBOX_SEED = '1';
  const commandId = '123e4567-e89b-42d3-a456-426614174000';
  await expect(s.client.activateOffer('../bad', { commandId })).rejects.toThrow('PUBLICATION_OFFER_ID_INVALID');
  await expect(s.client.activateOffer('123', { commandId: 'not-a-uuid' })).rejects.toThrow('PUBLICATION_COMMAND_ID_INVALID');
  await expect(s.client.getPublicationTasks('not-a-uuid')).rejects.toThrow('PUBLICATION_COMMAND_ID_INVALID');
  await expect(s.client.getPublicationTasks(commandId, { limit: 1001 })).rejects.toThrow('PUBLICATION_TASK_PAGE_INVALID');
  expect(s.fetchImpl).not.toHaveBeenCalled();

  s.runtime.KOMERCE_ALLOW_ALLEGRO_SANDBOX_SEED = '0';
  await expect(s.client.activateOffer('123', { commandId })).rejects.toThrow('SEED_DISABLED');
  s.runtime.KOMERCE_ALLOW_ALLEGRO_SANDBOX_SEED = '1';
  s.runtime.KOMERCE_ENV = 'production';
  await expect(s.client.activateOffer('123', { commandId })).rejects.toThrow('STAGING_ONLY');
  expect(s.fetchImpl).not.toHaveBeenCalled();
});
