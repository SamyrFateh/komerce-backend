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
      marketChoices: jest.fn((context, opts = {}) => {
        const access = context && context.access;
        if (!access) return [];
        const rows = access.mode === 'global' && !opts.requireMarket ? [{ value: '', marketCode: null, label: 'Global · Tous les marchés' }] : [];
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
  test('les 6 premiers onglets restent exactement le mock approuvé, dans l’ordre — les workspaces opérationnels viennent après', () => {
    const env = loadNavigation('/admin/pilotage', 'pilotage');

    expect(env.api.PRIMARY_NAV.slice(0, 6).map(item => item.label)).toEqual([
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
      user: { role: 'admin' },
    });

    const inner = header.children[0];
    const identity = inner.children[0];
    const primary = inner.children[1];
    const orders = primary.children.find(link => link.attributes['data-dashboard'] === 'orders');

    expect(identity.children[1].textContent).toBe('← Retour');
    expect(identity.children[1].href).toBe('/admin/commerce');
    expect(orders.attributes['aria-current']).toBe('page');
    // « Opérations » est désormais un onglet légitime (le workspace
    // operations-workspace) — seul « Finance », jamais promu en onglet
    // primaire (le tab s'appelle « Comptabilité »), doit rester absent.
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

  test('Atelier économique n’affiche jamais Global quand la surface exige un Market ID', () => {
    const env = loadNavigation('/admin/workspaces/pricing', 'pricing-workspace');
    const header = env.api.mount({
      document: env.document,
      pathname: '/admin/workspaces/pricing',
      surface: 'pricing-workspace',
      user: { role: 'admin' },
      adminContext: {
        access: {
          mode: 'global',
          defaultMarket: 'CM',
          allowedMarkets: ['CM', 'CG'],
        },
      },
    });
    const select = header.children[0].children[2].children[0].children[0];
    expect(select.value).toBe('CM');
    expect(select.children.map(option => option.value)).toEqual(['CM', 'CG']);
    expect(select.children.map(option => option.textContent)).not.toContain('Global · Tous les marchés');
  });

  test('Déconnexion appelle le endpoint auth puis revient au login', async () => {
    const replace = jest.fn();
    const fetch = jest.fn().mockResolvedValue({ ok: true });
    const env = loadNavigation('/admin/pilotage', 'pilotage', {
      window: {
        fetch,
        location: { pathname: '/admin/pilotage', search: '', href: 'https://komerce.test/admin/pilotage', replace },
      },
    });
    const header = env.api.mount({
      document: env.document,
      pathname: '/admin/pilotage',
      surface: 'pilotage',
      user: { role: 'admin' },
    });
    const utilities = header.children[0].children[2];
    const logout = utilities.children.find(node => node.className === 'kmc-admin-logout');

    expect(logout).toBeDefined();
    expect(logout.textContent).toBe('Déconnexion');
    await logout.listeners.click();
    expect(fetch).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    }));
    expect(replace).toHaveBeenCalledWith('/login.html');
  });

  test('Dashboard reste actif pour les surfaces techniques non exposées dans le mock', () => {
    const env = loadNavigation('/admin/finance', 'finance');
    const header = env.api.mount({ document: env.document, pathname: '/admin/finance', surface: 'finance' });
    const dashboard = header.children[0].children[1].children.find(link => link.attributes['data-dashboard'] === 'dashboard');
    expect(dashboard.attributes['aria-current']).toBe('page');
  });
});

describe('canonical admin navigation — filtrage par rôle (docs/admin-nav-capability-map.md)', () => {
  test('admin voit les 10 onglets — les 6 du mock + les 4 workspaces opérationnels', () => {
    const env = loadNavigation('/admin/pilotage', 'pilotage');
    const header = env.api.mount({
      document: env.document,
      pathname: '/admin/pilotage',
      surface: 'pilotage',
      user: { role: 'admin' },
    });
    const primary = header.children[0].children[1];
    const ids = primary.children.map(link => link.attributes['data-dashboard']);
    expect(ids).toEqual([
      'dashboard', 'pricing', 'catalog', 'orders', 'markets', 'settings',
      'operations-workspace', 'shipping-customs-workspace', 'sourcing-workspace', 'accounting-workspace',
    ]);
  });

  test('market_operator voit 5 onglets — pas Catalogue ni Paramètres (admin only côté serveur)', () => {
    const env = loadNavigation('/admin/pilotage', 'pilotage');
    const header = env.api.mount({
      document: env.document,
      pathname: '/admin/pilotage',
      surface: 'pilotage',
      user: { role: 'market_operator' },
    });
    const primary = header.children[0].children[1];
    const ids = primary.children.map(link => link.attributes['data-dashboard']);
    expect(ids).toEqual(['dashboard', 'pricing', 'orders', 'markets', 'operations-workspace']);
    expect(ids).not.toContain('catalog');
    expect(ids).not.toContain('settings');
  });

  test.each([
    ['finance', ['dashboard', 'accounting-workspace']],
    ['sourcing', ['dashboard', 'sourcing-workspace']],
    ['agent_hub', ['dashboard', 'operations-workspace', 'shipping-customs-workspace']],
    ['agent_relais', ['dashboard', 'operations-workspace', 'accounting-workspace']],
    ['agent_transitaire', ['dashboard', 'shipping-customs-workspace']],
  ])(
    '%s voit Dashboard + son ou ses workspace(s) réel(s) — jamais un onglet qui 403',
    (role, expected) => {
      const env = loadNavigation('/admin/pilotage', 'pilotage');
      const header = env.api.mount({
        document: env.document,
        pathname: '/admin/pilotage',
        surface: 'pilotage',
        user: { role },
      });
      const primary = header.children[0].children[1];
      const ids = primary.children.map(link => link.attributes['data-dashboard']);
      expect(ids).toEqual(expected);
    }
  );

  test('support ne voit que Dashboard — aucun workspace Canonical dédié n’existe encore pour ce rôle', () => {
    const env = loadNavigation('/admin/pilotage', 'pilotage');
    const header = env.api.mount({
      document: env.document,
      pathname: '/admin/pilotage',
      surface: 'pilotage',
      user: { role: 'support' },
    });
    const primary = header.children[0].children[1];
    const ids = primary.children.map(link => link.attributes['data-dashboard']);
    expect(ids).toEqual(['dashboard']);
  });

  test('rôle inconnu voit uniquement Dashboard (défense en profondeur)', () => {
    const env = loadNavigation('/admin/pilotage', 'pilotage');
    const header = env.api.mount({
      document: env.document,
      pathname: '/admin/pilotage',
      surface: 'pilotage',
      user: { role: 'inconnu' },
    });
    const primary = header.children[0].children[1];
    const ids = primary.children.map(link => link.attributes['data-dashboard']);
    expect(ids).toEqual(['dashboard']);
  });

  test('visibleNavigationFor est exposée et cohérente avec le rendu de mount()', () => {
    const env = loadNavigation('/admin/pilotage', 'pilotage');
    const tabs = env.api.visibleNavigationFor({ role: 'market_operator' }, null);
    expect(tabs.map(t => t.id)).toEqual(['dashboard', 'pricing', 'orders', 'markets', 'operations-workspace']);
  });

  test('chaque rôle connu voit au moins Dashboard, toujours en premier', () => {
    const env = loadNavigation('/admin/pilotage', 'pilotage');
    const allRoles = ['admin', 'market_operator', 'finance', 'sourcing', 'agent_hub', 'agent_relais', 'agent_transitaire', 'support'];
    allRoles.forEach(role => {
      const tabs = env.api.visibleNavigationFor({ role }, null);
      expect(tabs.length).toBeGreaterThanOrEqual(1);
      expect(tabs[0].id).toBe('dashboard');
    });
  });

  test('operations-workspace / shipping-customs-workspace / accounting-workspace n’affichent plus de Retour redondant', () => {
    const env = loadNavigation('/admin/workspaces/operations', 'operations-workspace');
    ['operations-workspace', 'shipping-customs-workspace', 'accounting-workspace'].forEach(surface => {
      const header = env.api.mount({
        document: env.document,
        pathname: `/admin/workspaces/${surface}`,
        surface,
        user: { role: 'admin' },
      });
      const back = header.children[0].children[0].children.find(node => node.className === 'kmc-admin-back');
      expect(back).toBeUndefined();
    });
  });
});
