'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

function response({
  ok = true,
  type = 'basic',
  contentType = 'application/javascript',
} = {}) {
  return {
    ok,
    type,
    headers: { get: jest.fn(() => contentType) },
    clone: jest.fn(() => ({ cloned: true })),
  };
}

function request({
  method = 'GET',
  url = 'https://komerce.co/boutique/js/main.js',
  destination = 'script',
} = {}) {
  return { method, url, destination };
}

function fetchEvent(overrides) {
  let pending;
  const event = {
    request: request(overrides),
    respondWith: jest.fn((value) => { pending = value; }),
  };
  return { event, result: () => pending };
}

beforeEach(() => {
  jest.resetModules();

  const handlers = {};
  const clients = [{ postMessage: jest.fn() }, { postMessage: jest.fn() }];
  const cache = { put: jest.fn().mockResolvedValue(undefined) };

  global.self = {
    location: { origin: 'https://komerce.co' },
    skipWaiting: jest.fn(),
    addEventListener: jest.fn((type, listener) => { handlers[type] = listener; }),
    clients: {
      claim: jest.fn().mockResolvedValue(undefined),
      matchAll: jest.fn().mockResolvedValue(clients),
    },
  };
  global.caches = {
    keys: jest.fn().mockResolvedValue([
      'komerce-v340',
      'komerce-v341',
      'unrelated-cache',
    ]),
    delete: jest.fn().mockResolvedValue(true),
    open: jest.fn().mockResolvedValue(cache),
    match: jest.fn().mockResolvedValue(null),
  };
  global.fetch = jest.fn();
  global.__swTest = { handlers, clients, cache };

  require('../../public/sw.js');
});

afterEach(() => {
  delete global.self;
  delete global.caches;
  delete global.fetch;
  delete global.__swTest;
});

test('installe immédiatement le nouveau worker', () => {
  global.__swTest.handlers.install();
  expect(self.skipWaiting).toHaveBeenCalledTimes(1);
});

test('active v341, purge v340 et réveille aussi les anciens listeners', async () => {
  let activation;
  global.__swTest.handlers.activate({ waitUntil: (promise) => { activation = promise; } });
  await activation;

  expect(caches.delete).toHaveBeenCalledTimes(1);
  expect(caches.delete).toHaveBeenCalledWith('komerce-v340');
  expect(self.clients.claim).toHaveBeenCalledTimes(1);
  expect(self.clients.matchAll).toHaveBeenCalledWith({
    type: 'window',
    includeUncontrolled: true,
  });
  global.__swTest.clients.forEach((client) => {
    expect(client.postMessage.mock.calls).toEqual([
      [{ type: 'sw-updated', version: 'v340' }],
      [{ type: 'sw-updated', version: 'v341' }],
    ]);
  });
});

test('ignore les requêtes non GET, API et externes', () => {
  const post = fetchEvent({ method: 'POST' });
  const api = fetchEvent({ url: 'https://komerce.co/api/products' });
  const external = fetchEvent({ url: 'https://cdn.example.com/app.js' });

  global.__swTest.handlers.fetch(post.event);
  global.__swTest.handlers.fetch(api.event);
  global.__swTest.handlers.fetch(external.event);

  expect(post.event.respondWith).not.toHaveBeenCalled();
  expect(api.event.respondWith).not.toHaveBeenCalled();
  expect(external.event.respondWith).not.toHaveBeenCalled();
});

test('met en cache un script sain après la réponse réseau', async () => {
  const networkResponse = response();
  fetch.mockResolvedValue(networkResponse);
  const current = fetchEvent();

  global.__swTest.handlers.fetch(current.event);
  await expect(current.result()).resolves.toBe(networkResponse);
  await Promise.resolve();

  expect(caches.open).toHaveBeenCalledWith('komerce-v341');
  expect(networkResponse.clone).toHaveBeenCalledTimes(1);
  expect(global.__swTest.cache.put).toHaveBeenCalledWith(
    current.event.request,
    { cloned: true }
  );
});

test.each([
  ['réponse absente', null],
  ['statut en erreur', response({ ok: false })],
  ['réponse cross-origin', response({ type: 'cors' })],
  ['HTML à la place du JS', response({ contentType: 'text/html' })],
  ['HTML à la place du CSS', response({ contentType: 'text/html' })],
])('ne met jamais en cache une %s', async (label, networkResponse) => {
  fetch.mockResolvedValue(networkResponse);
  const current = fetchEvent(
    label.includes('CSS')
      ? { url: 'https://komerce.co/boutique/css/base.css', destination: 'style' }
      : undefined
  );

  global.__swTest.handlers.fetch(current.event);
  await current.result();
  expect(caches.open).not.toHaveBeenCalled();
});

test('met en cache les autres ressources basic et accepte les types vides', async () => {
  const networkResponse = response({ contentType: '' });
  fetch.mockResolvedValue(networkResponse);
  const current = fetchEvent({
    url: 'https://komerce.co/boutique/image.webp',
    destination: 'image',
  });

  global.__swTest.handlers.fetch(current.event);
  await current.result();
  await Promise.resolve();
  expect(caches.open).toHaveBeenCalledWith('komerce-v341');
});

test('ignore une panne d’écriture cache sans casser la réponse réseau', async () => {
  const networkResponse = response();
  caches.open.mockRejectedValue(new Error('cache indisponible'));
  fetch.mockResolvedValue(networkResponse);
  const current = fetchEvent();

  global.__swTest.handlers.fetch(current.event);
  await expect(current.result()).resolves.toBe(networkResponse);
  await Promise.resolve();
});

test('sert le cache hors ligne puis un 503 quand il est vide', async () => {
  const cached = { cached: true };
  fetch.mockRejectedValue(new Error('offline'));
  caches.match.mockResolvedValueOnce(cached).mockResolvedValueOnce(null);

  const hit = fetchEvent();
  global.__swTest.handlers.fetch(hit.event);
  await expect(hit.result()).resolves.toBe(cached);

  const miss = fetchEvent();
  global.__swTest.handlers.fetch(miss.event);
  const fallback = await miss.result();
  expect(fallback).toBeInstanceOf(Response);
  expect(fallback.status).toBe(503);
  await expect(fallback.text()).resolves.toBe('Hors ligne');
});
