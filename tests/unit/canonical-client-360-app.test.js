'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

function fakeNode() {
  return {
    className: '',
    children: [],
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    setAttribute: jest.fn(),
    addEventListener: jest.fn(),
  };
}

function loadApp(pathname) {
  jest.resetModules();
  const root = fakeNode();
  const client360Mount = jest.fn().mockResolvedValue({ ok: true });
  const document = {
    readyState: 'loading',
    addEventListener: jest.fn(),
    getElementById: jest.fn(() => root),
    createElement: jest.fn(() => fakeNode()),
  };

  global.document = document;
  global.window = {
    location: { pathname, search: '', hash: '', replace: jest.fn() },
    fetch: jest.fn(),
    document,
    KomerceAdminContext: {
      validateAdminContext: value => value,
      resolveMarketView: () => ({ mode: 'global', marketCode: null }),
    },
    KomerceCanonicalPilotage: { mount: jest.fn() },
    KomerceCanonicalCommerce: { mount: jest.fn() },
    KomerceCanonicalOperations: { mount: jest.fn() },
    KomerceCanonicalFinance: { mount: jest.fn() },
    KomerceCanonicalOrder360: { mount: jest.fn() },
    KomerceCanonicalClient360: { mount: client360Mount },
    KomerceDemoOrderFlow: { mount: jest.fn() },
    KomerceDashboardRenderer: {},
    KomerceCanonicalUI: {},
  };

  require('../../public/dashboards/canonical/js/app.js');
  return { api: global.window.KomerceCanonicalAdmin, root, client360Mount };
}

afterEach(() => {
  delete global.window;
  delete global.document;
});

test('surfaceForPath distingue Client Index du détail Client 360', () => {
  const env = loadApp('/admin/clients/%2B2691234567');
  expect(env.api.surfaceForPath('/admin/clients/%2B2691234567')).toBe(env.api.SURFACES.CLIENT_360);
  expect(env.api.surfaceForPath('/admin/clients')).toBe(env.api.SURFACES.CLIENT_INDEX);
  expect(env.api.surfaceForPath('/admin-next/clients')).toBe(env.api.SURFACES.CLIENT_INDEX);
});

test('renderReady monte Client 360 sans sélecteur marché navigateur', async () => {
  const env = loadApp('/admin/clients/%2B2691234567');
  const user = { id: 'admin-1', role: 'admin' };
  const context = { actor: user, access: { mode: 'global', allowedMarkets: ['KM'], defaultMarket: null, capabilities: [] } };

  await env.api.renderReady(env.root, user, context);

  expect(env.client360Mount).toHaveBeenCalledWith(expect.objectContaining({
    root: env.root,
    user,
    pathname: '/admin/clients/%2B2691234567',
  }));
});
