'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

function makeRuntime({ controller = {} } = {}) {
  let onMessage;
  const registrations = [{ update: jest.fn() }, { update: jest.fn() }];
  const serviceWorker = {
    controller,
    getRegistrations: jest.fn().mockResolvedValue(registrations),
    addEventListener: jest.fn((type, listener) => {
      if (type === 'message') onMessage = listener;
    }),
  };
  const cacheStorage = {
    keys: jest.fn().mockResolvedValue([
      'komerce-v340',
      'komerce-v341',
      'third-party-cache',
    ]),
    delete: jest.fn().mockResolvedValue(true),
  };
  const storage = {
    getItem: jest.fn().mockReturnValue(null),
    setItem: jest.fn(),
  };

  return {
    serviceWorker,
    cacheStorage,
    storage,
    registrations,
    message: (data) => onMessage({ data }),
  };
}

beforeEach(() => {
  jest.resetModules();
  delete navigator.serviceWorker;
});

test('reste inerte sans API service worker', () => {
  const { setupServiceWorkerRefresh } = require('../../js/b-service-worker-refresh.js');
  expect(setupServiceWorkerRefresh({ serviceWorker: null })).toBe(false);
});

test('fonctionne aussi quand CacheStorage est indisponible', () => {
  const { setupServiceWorkerRefresh } = require('../../js/b-service-worker-refresh.js');
  const runtime = makeRuntime();
  expect(setupServiceWorkerRefresh({
    ...runtime,
    cacheStorage: null,
    reload: jest.fn(),
  })).toBe(true);
  expect(runtime.cacheStorage.keys).not.toHaveBeenCalled();
});

test('actualise les registrations et purge uniquement les anciens caches Komerce', async () => {
  const { setupServiceWorkerRefresh } = require('../../js/b-service-worker-refresh.js');
  const runtime = makeRuntime();

  expect(setupServiceWorkerRefresh(runtime)).toBe(true);
  await Promise.resolve();

  runtime.registrations.forEach((registration) => {
    expect(registration.update).toHaveBeenCalledTimes(1);
  });
  expect(runtime.cacheStorage.delete).toHaveBeenCalledTimes(1);
  expect(runtime.cacheStorage.delete).toHaveBeenCalledWith('komerce-v340');
});

test('ignore les messages anciens, sans contrôleur ou déjà acquittés', () => {
  const { setupServiceWorkerRefresh } = require('../../js/b-service-worker-refresh.js');
  const runtime = makeRuntime({ controller: null });
  const reload = jest.fn();
  setupServiceWorkerRefresh({ ...runtime, reload });

  runtime.message({ type: 'sw-updated', version: 'v340' });
  runtime.message({ type: 'sw-updated', version: 'v341' });
  runtime.serviceWorker.controller = {};
  runtime.storage.getItem.mockReturnValue('1');
  runtime.message({ type: 'sw-updated', version: 'v341' });

  expect(reload).not.toHaveBeenCalled();
});

test('acquitte v341 puis recharge exactement une fois', () => {
  const { setupServiceWorkerRefresh } = require('../../js/b-service-worker-refresh.js');
  const runtime = makeRuntime();
  const reload = jest.fn();
  const logger = { log: jest.fn() };
  setupServiceWorkerRefresh({ ...runtime, reload, logger });

  runtime.message({ type: 'sw-updated', version: 'v341' });

  expect(runtime.storage.setItem).toHaveBeenCalledWith('kmrc_sw_reload_v341', '1');
  expect(logger.log).toHaveBeenCalledWith(
    '[SW] Nouvelle version v341 → rechargement unique'
  );
  expect(reload).toHaveBeenCalledTimes(1);
});

test('le bootstrap navigateur utilise le service worker disponible', () => {
  const runtime = makeRuntime();
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: runtime.serviceWorker,
  });
  Object.defineProperty(window, 'caches', {
    configurable: true,
    value: runtime.cacheStorage,
  });

  require('../../js/b-service-worker-refresh.js');

  expect(runtime.serviceWorker.getRegistrations).toHaveBeenCalledTimes(1);
  expect(runtime.serviceWorker.addEventListener).toHaveBeenCalledWith(
    'message',
    expect.any(Function)
  );
});
