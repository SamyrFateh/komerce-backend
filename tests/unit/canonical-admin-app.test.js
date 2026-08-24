'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

function loadCanonicalApp() {
  jest.resetModules();

  const replace = jest.fn();
  const fetch = jest.fn();
  const validateAdminContext = jest.fn(raw => raw);
  const pilotageMount = jest.fn().mockResolvedValue({ ok: true });
  const demoMount = jest.fn().mockResolvedValue({ ok: true });
  const document = {
    readyState: 'loading',
    addEventListener: jest.fn(),
    getElementById: jest.fn(() => ({ id: 'canonical-admin-root' })),
  };

  global.document = document;
  global.window = {
    location: {
      pathname: '/admin-next',
      search: '',
      hash: '',
      replace,
    },
    fetch,
    document,
    KomerceAdminContext: { validateAdminContext },
    KomerceCanonicalPilotage: { mount: pilotageMount },
    KomerceDemoOrderFlow: { mount: demoMount },
    KomerceDashboardRenderer: { createRenderer: jest.fn() },
    KomerceCanonicalUI: {},
  };

  require('../../public/dashboards/canonical/js/app.js');

  return {
    api: global.window.KomerceCanonicalAdmin,
    window: global.window,
    document,
    fetch,
    replace,
    validateAdminContext,
    pilotageMount,
    demoMount,
  };
}

afterEach(() => {
  delete global.window;
  delete global.document;
});

describe('canonical admin app — server AdminContext bootstrap', () => {
  test('requireAdminContext charge la projection serveur puis la valide', async () => {
    const env = loadCanonicalApp();
    const raw = {
      actor: { id: 'operator-cm', role: 'admin' },
      access: {
        mode: 'market',
        allowedMarkets: ['CM'],
        defaultMarket: 'CM',
        capabilities: ['pilotage.read', 'dashboard.market.read'],
      },
    };
    env.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue(raw),
    });

    const context = await env.api.requireAdminContext();

    expect(env.fetch).toHaveBeenCalledWith('/api/admin/dashboard/context', expect.objectContaining({
      method: 'GET',
      credentials: 'include',
    }));
    expect(env.validateAdminContext).toHaveBeenCalledWith(raw);
    expect(context).toBe(raw);
  });

  test('403 context reste interdit même si une session existe', async () => {
    const env = loadCanonicalApp();
    env.fetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: jest.fn().mockResolvedValue({ code: 'dashboard_access_denied' }),
    });

    await expect(env.api.requireAdminContext()).rejects.toThrow('forbidden');
    expect(env.replace).toHaveBeenCalledWith('/');
    expect(env.validateAdminContext).not.toHaveBeenCalled();
  });

  test('renderPilotage transmet le contexte validé au module Pilotage', async () => {
    const env = loadCanonicalApp();
    const user = { id: 'operator-cm', role: 'admin' };
    const adminContext = {
      actor: user,
      access: { mode: 'market', allowedMarkets: ['CM'], defaultMarket: 'CM', capabilities: ['pilotage.read'] },
    };
    const root = {};

    await env.api.renderPilotage(root, user, adminContext);

    expect(env.pilotageMount).toHaveBeenCalledWith(expect.objectContaining({
      root,
      user,
      adminContext,
      contextContract: env.window.KomerceAdminContext,
    }));
  });
});
