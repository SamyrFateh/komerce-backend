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
  if (!context.access.allowedMarkets.includes(selected)) throw new Error('market forbidden');
  return { mode: 'market', marketCode: selected, crossMarket: false };
}

function loadApp() {
  jest.resetModules();
  const workspaceMount = jest.fn().mockResolvedValue({ ok: true });
  const root = fakeNode('main');
  const document = {
    readyState: 'loading',
    addEventListener: jest.fn(),
    getElementById: jest.fn(() => root),
    createElement: jest.fn(tag => fakeNode(tag)),
  };
  global.document = document;
  global.window = {
    location: { pathname: '/admin/workspaces/operations', search: '', hash: '', replace: jest.fn() },
    fetch: jest.fn(),
    document,
    Intl,
    KomerceAdminContext: {
      validateAdminContext: value => value,
      resolveMarketView: jest.fn(resolveMarketView),
    },
    KomerceCanonicalOperationsWorkspace: { mount: workspaceMount },
    KomerceDashboardRenderer: {},
    KomerceCanonicalUI: {},
  };

  require('../../public/dashboards/canonical/js/app.js');
  return { api: global.window.KomerceCanonicalAdmin, root, workspaceMount, window: global.window };
}

afterEach(() => {
  delete global.window;
  delete global.document;
});

test('surfaceForPath reconnaît le Workspace stable et son alias de construction', () => {
  const env = loadApp();

  expect(env.api.surfaceForPath('/admin/workspaces/operations')).toBe(env.api.SURFACES.OPERATIONS_WORKSPACE);
  expect(env.api.surfaceForPath('/admin-next/workspaces/operations')).toBe(env.api.SURFACES.OPERATIONS_WORKSPACE);
});

test('central ne reçoit jamais Global dans un Workspace et démarre sur un marché explicite', async () => {
  const env = loadApp();
  const user = { id: 'hq-admin', role: 'admin' };
  const context = {
    actor: user,
    access: {
      mode: 'global',
      allowedMarkets: ['CM', 'CG'],
      defaultMarket: null,
      capabilities: ['dashboard.global.read', 'dashboard.market.read'],
    },
  };

  await env.api.renderOperationsWorkspaceShell(env.root, user, context);

  const bar = env.root.children[0];
  const surface = env.root.children[1];
  const select = bar.children[1].children[1];
  expect(select.children.map(option => option.value)).toEqual(['CM', 'CG']);
  expect(select.value).toBe('CM');
  expect(env.workspaceMount).toHaveBeenCalledWith(expect.objectContaining({
    root: surface,
    requestedMarket: 'CM',
  }));

  select.value = 'CG';
  await select._listeners.change();
  expect(env.workspaceMount).toHaveBeenLastCalledWith(expect.objectContaining({ requestedMarket: 'CG' }));
});

test('opérateur CM ne peut pas falsifier CG dans le sélecteur Workspace', async () => {
  const env = loadApp();
  const user = { id: 'operator-cm', role: 'admin' };
  const context = {
    actor: user,
    access: {
      mode: 'market',
      allowedMarkets: ['CM'],
      defaultMarket: 'CM',
      capabilities: ['dashboard.market.read'],
    },
  };
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

  await env.api.renderOperationsWorkspaceShell(env.root, user, context);
  const select = env.root.children[0].children[1].children[1];
  expect(select.children.map(option => option.value)).toEqual(['CM']);
  expect(env.workspaceMount).toHaveBeenCalledTimes(1);

  select.value = 'CG';
  await select._listeners.change();

  expect(env.workspaceMount).toHaveBeenCalledTimes(1);
  expect(select.value).toBe('CM');
  errorSpy.mockRestore();
});
