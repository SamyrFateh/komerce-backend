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
  const pricingMount = jest.fn(({ root, requestedMarket }) => {
    const marker = fakeNode('div');
    marker.textContent = requestedMarket || 'global';
    root.appendChild(marker);
    return Promise.resolve({ ok: true });
  });
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
    // Le vrai navigateur expose Intl.DisplayNames (confirmé en staging : les
    // libellés de marché affichent bien "KM · Comores", pas juste "KM"). Le
    // stub doit s'aligner sur ce comportement réel plutôt que de le masquer.
    Intl: global.Intl,
    KomerceAdminContext: {
      validateAdminContext,
      resolveMarketView: resolveMarketViewMock,
    },
    KomerceCanonicalPilotage: { mount: pilotageMount },
    KomerceCanonicalPricingWorkspace: { mount: pricingMount },
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
    pricingMount,
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

  test('requireSession accepte une identité client seulement si le contexte serveur la projette market_operator', async () => {
    const env = loadCanonicalApp();
    env.fetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ id: 'client-1', role: 'client', email: 'member@example.com' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          actor: { id: 'client-1', role: 'market_operator' },
          access: { mode: 'market', allowedMarkets: ['CM'], defaultMarket: 'CM' },
        }),
      });

    await expect(env.api.requireSession()).resolves.toMatchObject({
      id: 'client-1',
      role: 'market_operator',
      persisted_role: 'client',
      role_source: 'market_delegation_context',
    });
    expect(env.replace).not.toHaveBeenCalled();
    expect(env.fetch).toHaveBeenNthCalledWith(2, '/api/admin/dashboard/context', expect.objectContaining({
      method: 'GET',
      credentials: 'include',
    }));
  });

  test('requireSession refuse toujours une identité sans contexte market_operator prouvé', async () => {
    const env = loadCanonicalApp();
    env.fetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ id: 'client-2', role: 'client' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: jest.fn().mockResolvedValue({ code: 'dashboard_access_denied' }),
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
  test('regionFlagEmoji convertit un code ISO alpha-2 en emoji drapeau via Regional Indicator Symbols', () => {
    const env = loadCanonicalApp();
    expect(env.api.regionFlagEmoji('CM')).toBe('🇨🇲');
    expect(env.api.regionFlagEmoji('cm')).toBe('🇨🇲');
    expect(env.api.regionFlagEmoji('KM')).toBe('🇰🇲');
    expect(env.api.regionFlagEmoji('FR')).toBe('🇫🇷');
    expect(env.api.regionFlagEmoji('')).toBe('');
    expect(env.api.regionFlagEmoji(null)).toBe('');
    expect(env.api.regionFlagEmoji('XYZ')).toBe('');
  });

  test('marketChoices préfixe chaque marché de son drapeau, jamais l’option Global', () => {
    const env = loadCanonicalApp();
    const adminContext = {
      access: { mode: 'global', allowedMarkets: ['KM', 'CM', 'CG'], defaultMarket: null, capabilities: [] },
    };
    const choices = env.api.marketChoices(adminContext);
    expect(choices[0]).toMatchObject({ value: '', label: 'Global · Tous les marchés' });
    expect(choices[1].label).toBe('🇰🇲 KM · Comores');
    expect(choices[2].label).toBe('🇨🇲 CM · Cameroun');
    expect(choices[3].label).toBe('🇨🇬 CG · Congo-Brazzaville');
  });

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

  test('Pricing change de Market par swap atomique sans exposer le rendu intermédiaire', async () => {
    const env = loadCanonicalApp();
    const user = { id: 'hq-admin', role: 'admin' };
    const adminContext = {
      actor: user,
      access: {
        mode: 'global',
        allowedMarkets: ['CM', 'CG'],
        defaultMarket: 'CM',
        capabilities: ['dashboard.market.read'],
      },
    };

    await env.api.renderPricingWorkspaceShell(env.root, user, adminContext);
    const bar = env.root.children[0];
    const surface = env.root.children[1];
    const select = bar.children[1].children[1];
    expect(surface.children[0].textContent).toBe('CM');

    let finishSecondRender;
    env.pricingMount.mockImplementationOnce(({ root, requestedMarket }) => new Promise(resolve => {
      finishSecondRender = () => {
        const marker = fakeNode('div');
        marker.textContent = requestedMarket;
        root.appendChild(marker);
        resolve({ ok: true });
      };
    }));

    select.value = 'CG';
    const changePromise = select._listeners.change();
    expect(surface.children[0].textContent).toBe('CM');
    finishSecondRender();
    await changePromise;

    expect(surface.children).toHaveLength(1);
    const stage = surface.children[0];
    expect(stage.className).toBe('kmc-market-surface-stage');
    expect(stage.children[0].textContent).toBe('CG');
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

describe('canonical admin app — defaultLandingSurface (docs/admin-nav-capability-map.md §9)', () => {
  test('chaque rôle opérationnel atterrit directement sur son workspace réel, pas sur Dashboard', () => {
    const env = loadCanonicalApp();
    expect(env.api.defaultLandingSurface({ role: 'admin' })).toBe('/admin/pilotage');
    expect(env.api.defaultLandingSurface({ role: 'market_operator' })).toBe('/admin/pilotage');
    expect(env.api.defaultLandingSurface({ role: 'finance' })).toBe('/admin/workspaces/accounting');
    expect(env.api.defaultLandingSurface({ role: 'sourcing' })).toBe('/admin/workspaces/sourcing');
    expect(env.api.defaultLandingSurface({ role: 'agent_hub' })).toBe('/admin/workspaces/operations');
    expect(env.api.defaultLandingSurface({ role: 'agent_relais' })).toBe('/admin/workspaces/operations');
    expect(env.api.defaultLandingSurface({ role: 'agent_transitaire' })).toBe('/admin/workspaces/shipping-customs');
    expect(env.api.defaultLandingSurface({ role: 'support' })).toBe('/admin/pilotage');
  });

  test('rôle inconnu ou utilisateur absent retombe sur /admin/pilotage', () => {
    const env = loadCanonicalApp();
    expect(env.api.defaultLandingSurface({ role: 'bogus' })).toBe('/admin/pilotage');
    expect(env.api.defaultLandingSurface(null)).toBe('/admin/pilotage');
  });

  test.each([
    ['admin', '/admin/pilotage'],
    ['market_operator', '/admin/pilotage'],
    ['finance', '/admin/workspaces/accounting'],
    ['sourcing', '/admin/workspaces/sourcing'],
    ['agent_hub', '/admin/workspaces/operations'],
    ['agent_relais', '/admin/workspaces/operations'],
    ['agent_transitaire', '/admin/workspaces/shipping-customs'],
  ])('/admin redirige %s vers sa landing avant de charger AdminContext', async (role, landing) => {
    const env = loadCanonicalApp();
    const user = { id: `${role}-1`, role };
    env.window.location.pathname = '/admin';
    env.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue(user),
    });

    await expect(env.api.boot()).resolves.toEqual(user);

    expect(env.replace).toHaveBeenCalledWith(landing);
    expect(env.fetch).toHaveBeenCalledTimes(1);
    expect(env.fetch).toHaveBeenCalledWith('/api/auth/me', expect.objectContaining({
      method: 'GET',
      credentials: 'include',
    }));
    expect(env.validateAdminContext).not.toHaveBeenCalled();
  });
});