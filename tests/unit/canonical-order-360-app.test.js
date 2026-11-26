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
  const order360Mount = jest.fn().mockResolvedValue({ ok: true });
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
    KomerceCanonicalOrder360: { mount: order360Mount },
    KomerceDemoOrderFlow: { mount: jest.fn() },
    KomerceDashboardRenderer: {},
    KomerceCanonicalUI: {},
  };

  require('../../public/dashboards/canonical/js/app.js');
  return { api: global.window.KomerceCanonicalAdmin, root, order360Mount };
}

afterEach(() => {
  delete global.window;
  delete global.document;
});

test('surfaceForPath reconnaît une Entity Order 360 et pas orders-logistics legacy', () => {
  const env = loadApp('/admin/orders/CMD-CM-001');
  expect(env.api.surfaceForPath('/admin/orders/CMD-CM-001')).toBe(env.api.SURFACES.ORDER_360);
  expect(env.api.surfaceForPath('/admin/orders-logistics')).toBe(env.api.SURFACES.PILOTAGE);
});

test('renderReady monte Order 360 sans sélecteur marché client', async () => {
  const env = loadApp('/admin/orders/CMD-CM-001');
  const user = { id: 'admin-1', role: 'admin' };
  const context = { actor: user, access: { mode: 'global', allowedMarkets: ['CM'], defaultMarket: null, capabilities: [] } };

  await env.api.renderReady(env.root, user, context);

  expect(env.order360Mount).toHaveBeenCalledWith(expect.objectContaining({
    root: env.root,
    user,
    pathname: '/admin/orders/CMD-CM-001',
  }));
});

test('CANON-MARKET : Order 360 partage le même module pour le responsable marché', async () => {
  const env=loadApp('/admin/orders/CMD-CM-001');
  const user={id:'market-1',role:'market_operator'};
  await env.api.renderReady(env.root,user,{actor:user,access:{mode:'market',allowedMarkets:['CM'],defaultMarket:'CM'}});
  expect(env.order360Mount).toHaveBeenCalledWith(expect.objectContaining({root:env.root,user,pathname:'/admin/orders/CMD-CM-001'}));
});

test('legacy autonomy anchors and granular delegate route to the canonical destination',()=>{
  const {api}=loadApp('/admin/workspaces/pricing');
  const user={role:'market_operator'},ctx={access:{mode:'market',allowedMarkets:['ZZ'],defaultMarket:'ZZ',delegatedCapabilities:{ZZ:['network.read']}}};
  expect(api.legacyMarketAutonomyTarget(user,ctx,'?market=ZZ&legacy_market_autonomy=1','')).toBe('/admin/providers?market=ZZ');
  expect(api.legacyMarketAutonomyTarget(user,ctx,'?market=ZZ&legacy_market_autonomy=1','#market-team')).toBe('/admin/users?market=ZZ#market-team');
  expect(api.legacyMarketAutonomyTarget(user,ctx,'?market=CG&legacy_market_autonomy=1','')).toBe('/admin/workspaces/pricing?market=CG');
  expect(api.legacyMarketAutonomyTarget(user,ctx,'?market=ZZ','')).toBeNull();
});
