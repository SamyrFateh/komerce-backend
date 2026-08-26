'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

function fakeNode(tagName = 'div') {
  const listeners = {};
  return {
    tagName: String(tagName).toUpperCase(),
    className: '',
    textContent: '',
    value: '',
    disabled: false,
    children: [],
    attributes: {},
    dataset: {},
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    replaceChildren(...children) {
      this.children = children;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    addEventListener(type, handler) {
      listeners[type] = handler;
    },
    _listeners: listeners,
  };
}

function resolveMarketView(context, requestedMarket) {
  const selected = requestedMarket === undefined
    ? context.access.defaultMarket
    : requestedMarket;

  if (selected === null) {
    if (context.access.mode !== 'global') throw new Error('global forbidden');
    return { mode: 'global', marketCode: null, crossMarket: true };
  }

  if (!context.access.allowedMarkets.includes(selected)) {
    throw new Error('market forbidden');
  }
  return { mode: 'market', marketCode: selected, crossMarket: false };
}

function loadCanonicalApp() {
  jest.resetModules();

  const replace = jest.fn();
  const fetch = jest.fn();
  const validateAdminContext = jest.fn(raw => raw);
  const resolveMarketViewMock = jest.fn(resolveMarketView);
  const pilotageMount = jest.fn().mockResolvedValue({ ok: true });
  const demoMount = jest.fn().mockResolvedValue({ ok: true });
  const root = fakeNode('main');
  root.id = 'canonical-admin-root';
  const document = {
    readyState: 'loading',
    addEventListener: jest.fn(),
    getElementById: jest.fn(() => root),
    createElement: jest.fn(tagName => fakeNode(tagName)),
  };

  global.document = document;
  global.window = {
    location: {
      pathname: '/admin/pilotage',
      search: '',
      hash: '',
      replace,
    },
    fetch,
    document,
    KomerceAdminContext: {
      validateAdminContext,
      resolveMarketView: resolveMarketViewMock,
    },
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
    root,
    fetch,
    replace,
    validateAdminContext,
    resolveMarketViewMock,
    pilotageMount,
    demoMount,
  };
}

afterEach(() => {
  delete global.window;
  delete global.document;
});

describe('canonical admin app — server AdminContext bootstrap', () => {
  test.each(['agent_hub', 'agent_relais'])('requireSession accepte le rôle opérationnel réel %s', async role => {
    const env = loadCanonicalApp();
    const user = { id: `${role}-1`, role };
    env.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue(user),
    });

    await expect(env.api.requireSession()).resolves.toEqual(user);
    expect(env.replace).not.toHaveBeenCalled();
  });

  test('requireSession refuse un client sur le runtime Canonical admin', async () => {
    const env = loadCanonicalApp();
    env.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ id: 'client-1', role: 'client' }),
    });

    await expect(env.api.requireSession()).rejects.toThrow('forbidden');
    expect(env.replace).toHaveBeenCalledWith('/');
  });

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

  test('surfaceForPath reconnaît les URLs stables et les aliases de construction', () => {
    const env = loadCanonicalApp();

    expect(env.api.surfaceForPath('/admin')).toBe(env.api.SURFACES.PILOTAGE);
    expect(env.api.surfaceForPath('/admin/pilotage')).toBe(env.api.SURFACES.PILOTAGE);
    expect(env.api.surfaceForPath('/admin/commerce')).toBe(env.api.SURFACES.COMMERCE);
    expect(env.api.surfaceForPath('/admin/operations')).toBe(env.api.SURFACES.OPERATIONS);
    expect(env.api.surfaceForPath('/admin/finance')).toBe(env.api.SURFACES.FINANCE);
    expect(env.api.surfaceForPath('/admin/demo')).toBe(env.api.SURFACES.DEMO);
    expect(env.api.surfaceForPath('/admin-next/commerce')).toBe(env.api.SURFACES.COMMERCE);
    expect(env.api.surfaceForPath('/admin-next/operations')).toBe(env.api.SURFACES.OPERATIONS);
    expect(env.api.surfaceForPath('/admin-next/finance')).toBe(env.api.SURFACES.FINANCE);
    expect(env.api.surfaceForPath('/admin-next/demo')).toBe(env.api.SURFACES.DEMO);
  });

  test('renderPilotage transmet le contexte et le marché demandé au module Pilotage', async () => {
    const env = loadCanonicalApp();
    const user = { id: 'operator-cm', role: 'admin' };
    const adminContext = {
      actor: user,
      access: { mode: 'market', allowedMarkets: ['CM'], defaultMarket: 'CM', capabilities: ['pilotage.read'] },
    };
    const root = {};

    await env.api.renderPilotage(root, user, adminContext, 'CM');

    expect(env.pilotageMount).toHaveBeenCalledWith(expect.objectContaining({
      root,
      user,
      adminContext,
      requestedMarket: 'CM',
      contextContract: env.window.KomerceAdminContext,
    }));
  });
});

describe('canonical admin app — market selector', () => {
  test('central voit Global + marchés autorisés et recharge Pilotage sur CM', async () => {
    const env = loadCanonicalApp();
    const user = { id: 'hq-admin', role: 'admin' };
    const adminContext = {
      actor: user,
      access: {
        mode: 'global',
        allowedMarkets: ['KM', 'CM', 'CG'],
        defaultMarket: null,
        capabilities: ['pilotage.read', 'dashboard.global.read', 'dashboard.market.read'],
      },
    };

    await env.api.renderPilotageShell(env.root, user, adminContext);

    expect(env.root.className).toBe('kmc-admin-shell');
    expect(env.root.children).toHaveLength(2);
    const bar = env.root.children[0];
    const surface = env.root.children[1];
    const select = bar.children[1].children[1];

    expect(select.children.map(option => option.value)).toEqual(['', 'KM', 'CM', 'CG']);
    expect(select.value).toBe('');
    expect(env.pilotageMount).toHaveBeenNthCalledWith(1, expect.objectContaining({
      root: surface,
      requestedMarket: null,
    }));

    select.value = 'CM';
    await select._listeners.change();

    expect(env.pilotageMount).toHaveBeenNthCalledWith(2, expect.objectContaining({
      root: surface,
      requestedMarket: 'CM',
    }));
    expect(select.disabled).toBe(false);
  });

  test('opérateur pays ne reçoit jamais Global et un DOM falsifié CG est rejeté avant Pilotage', async () => {
    const env = loadCanonicalApp();
    const user = { id: 'operator-cm', role: 'admin' };
    const adminContext = {
      actor: user,
      access: {
        mode: 'market',
        allowedMarkets: ['CM'],
        defaultMarket: 'CM',
        capabilities: ['pilotage.read', 'dashboard.market.read'],
      },
    };
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await env.api.renderPilotageShell(env.root, user, adminContext);

    const select = env.root.children[0].children[1].children[1];
    expect(select.children.map(option => option.value)).toEqual(['CM']);
    expect(select.value).toBe('CM');
    expect(env.pilotageMount).toHaveBeenCalledTimes(1);
    expect(env.pilotageMount).toHaveBeenLastCalledWith(expect.objectContaining({ requestedMarket: 'CM' }));

    select.value = 'CG';
    await select._listeners.change();

    expect(env.resolveMarketViewMock).toHaveBeenLastCalledWith(adminContext, 'CG');
    expect(env.pilotageMount).toHaveBeenCalledTimes(1);
    expect(select.value).toBe('CM');

    errorSpy.mockRestore();
  });
});