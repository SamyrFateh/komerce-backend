'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

function fakeNode(tagName = 'div') {
  return {
    tagName: String(tagName).toUpperCase(),
    id: '',
    className: '',
    textContent: '',
    href: '',
    value: '',
    selected: false,
    children: [],
    attributes: {},
    listeners: {},
    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
      return child;
    },
    prepend(child) {
      this.children.unshift(child);
      child.parentNode = this;
      return child;
    },
    insertBefore(child, before) {
      const index = this.children.indexOf(before);
      if (index < 0) return this.appendChild(child);
      this.children.splice(index, 0, child);
      child.parentNode = this;
      return child;
    },
    addEventListener(name, handler) {
      this.listeners[name] = handler;
    },
    dispatchEvent(event) {
      if (event && this.listeners[event.type]) this.listeners[event.type](event);
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
  };
}

function loadNavigation(pathname, surface, options = {}) {
  jest.resetModules();

  const body = fakeNode('body');
  const root = fakeNode('main');
  root.id = 'canonical-admin-root';
  body.appendChild(root);

  const document = {
    readyState: 'loading',
    body,
    activeElement: null,
    createElement: jest.fn(tagName => fakeNode(tagName)),
    addEventListener: jest.fn(),
    querySelector: jest.fn(() => null),
    getElementById: jest.fn(id => {
      if (id === 'canonical-admin-root') return root;
      return null;
    }),
  };

  global.window = {
    location: { pathname, search: '', href: `https://komerce.test${pathname}` },
    document,
    KomerceCanonicalAdmin: {
      surfaceForPath: jest.fn(() => surface),
      marketChoices: jest.fn(context => {
        const access = context && context.access;
        if (!access) return [];
        const rows = access.mode === 'global' ? [{ value: '', marketCode: null, label: 'Global · Tous les marchés' }] : [];
        access.allowedMarkets.forEach(code => rows.push({ value: code, marketCode: code, label: code }));
        return rows;
      }),
    },
    ...(options.window || {}),
  };
  global.document = document;

  require('../../public/dashboards/canonical/js/navigation.js');

  return {
    api: global.window.KomerceCanonicalNavigation,
    document,
    body,
    root,
  };
}

afterEach(() => {
  delete global.window;
  delete global.document;
});

describe('canonical admin navigation — mock contract', () => {
  test('expose exactement les six onglets du mock approuvé dans le bon ordre', () => {
    const env = loadNavigation('/admin/pilotage', 'pilotage');

    expect(env.api.PRIMARY_NAV.map(item => item.label)).toEqual([
      'Dashboard',
      'Atelier économique',
      'Catalogue',
      'Commandes',
      'Marchés',
      'Paramètres',
    ]);
  });

  test('Atelier économique est un onglet primaire actif, sans bouton Retour parasite', () => {
    const env = loadNavigation('/admin/workspaces/pricing', 'pricing-workspace');
    const header = env.api.mount({
      document: env.document,
      pathname: '/admin/workspaces/pricing',
      surface: 'pricing-workspace',
      user: { role: 'admin' },
    });

    const inner = header.children[0];
    const identity = inner.children[0];
    const primary = inner.children[1];
    const pricing = primary.children.find(link => link.attributes['data-dashboard'] === 'pricing');

    expect(identity.children).toHaveLength(1);
    expect(identity.children[0].children[0].textContent).toBe('KOMERCE');
    expect(pricing.href).toBe('/admin/workspaces/pricing');
    expect(pricing.attributes['aria-current']).toBe('page');
  });

  test('les drill-downs gardent un Retour sans réintroduire les anciens onglets techniques', () => {
    const env = loadNavigation('/admin/orders/ORD-001', 'order-360');
    const header = env.api.mount({
      document: env.document,
      pathname: '/admin/orders/ORD-001',
      surface: 'order-360',
    });

    const inner = header.children[0];
    const identity = inner.children[0];
    const primary = inner.children[1];
    const orders = primary.children.find(link => link.attributes['data-dashboard'] === 'orders');

    expect(identity.children[1].textContent).toBe('← Retour');
    expect(identity.children[1].href).toBe('/admin/commerce');
    expect(orders.attributes['aria-current']).toBe('page');
    expect(primary.children.map(link => link.textContent)).not.toContain('Opérations');
    expect(primary.children.map(link => link.textContent)).not.toContain('Finance');
  });

  test('Marchés pointe vers la gestion des accès pour admin et vers autonomie marché pour market_operator', () => {
    const adminEnv = loadNavigation('/dashboards/canonical/access.html', 'market-access');
    const adminHeader = adminEnv.api.mount({
      document: adminEnv.document,
      pathname: '/dashboards/canonical/access.html',
      surface: 'market-access',
      user: { role: 'admin' },
    });
    const adminMarkets = adminHeader.children[0].children[1].children.find(link => link.attributes['data-dashboard'] === 'markets');
    expect(adminMarkets.href).toBe('/dashboards/canonical/access.html');
    expect(adminMarkets.attributes['aria-current']).toBe('page');

    const operatorEnv = loadNavigation('/admin/pilotage', 'pilotage');
    const operatorHeader = operatorEnv.api.mount({
      document: operatorEnv.document,
      pathname: '/admin/pilotage',
      surface: 'pilotage',
      user: { role: 'market_operator' },
    });
    const operatorMarkets = operatorHeader.children[0].children[1].children.find(link => link.attributes['data-dashboard'] === 'markets');
    expect(operatorMarkets.href).toBe('/dashboards/canonical/market-autonomy.html');
  });

  test('le sélecteur Market ID est intégré à droite quand le contexte serveur est disponible', () => {
    const env = loadNavigation('/admin/workspaces/pricing', 'pricing-workspace');
    const header = env.api.mount({
      document: env.document,
      pathname: '/admin/workspaces/pricing',
      surface: 'pricing-workspace',
      user: { role: 'market_operator' },
      adminContext: {
        access: {
          mode: 'market',
          defaultMarket: 'CM',
          allowedMarkets: ['CM'],
        },
      },
    });

    const utilities = header.children[0].children[2];
    const marketControl = utilities.children[0];
    const select = marketControl.children[0];

    expect(select.className).toBe('kmc-admin-market-select');
    expect(select.value).toBe('CM');
    expect(select.children.map(option => option.textContent)).toEqual(['CM']);
    expect(utilities.children[1].textContent).toBe('Responsable pays');
  });

  test('Dashboard reste actif pour les surfaces techniques non exposées dans le mock', () => {
    const env = loadNavigation('/admin/finance', 'finance');
    const header = env.api.mount({ document: env.document, pathname: '/admin/finance', surface: 'finance' });
    const dashboard = header.children[0].children[1].children.find(link => link.attributes['data-dashboard'] === 'dashboard');
    expect(dashboard.attributes['aria-current']).toBe('page');
  });
});
