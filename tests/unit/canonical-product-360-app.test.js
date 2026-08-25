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
  const product360Mount = jest.fn().mockResolvedValue({ ok: true });
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
    KomerceCanonicalClient360: { mount: jest.fn() },
    KomerceCanonicalProduct360: { mount: product360Mount },
    KomerceDemoOrderFlow: { mount: jest.fn() },
    KomerceDashboardRenderer: {},
    KomerceCanonicalUI: {},
  };

  require('../../public/dashboards/canonical/js/app.js');
  return { api: global.window.KomerceCanonicalAdmin, root, product360Mount };
}

afterEach(() => {
  delete global.window;
  delete global.document;
});

test('surfaceForPath reconnaît Product 360 et pas le Catalogue Workspace legacy', () => {
  const env = loadApp('/admin/products/KPR-000123');

  expect(env.api.surfaceForPath('/admin/products/KPR-000123')).toBe(env.api.SURFACES.PRODUCT_360);
  expect(env.api.surfaceForPath('/admin/products')).toBe(env.api.SURFACES.PILOTAGE);
});

test('renderReady monte Product 360 sans sélecteur marché navigateur', async () => {
  const env = loadApp('/admin/products/KPR-000123');
  const user = { id: 'admin-1', role: 'admin' };
  const context = { actor: user, access: { mode: 'global', allowedMarkets: ['CM'], defaultMarket: null, capabilities: [] } };

  await env.api.renderReady(env.root, user, context);

  expect(env.product360Mount).toHaveBeenCalledWith(expect.objectContaining({
    root: env.root,
    user,
    pathname: '/admin/products/KPR-000123',
  }));
  expect(env.product360Mount.mock.calls[0][0]).not.toHaveProperty('requestedMarket');
});
