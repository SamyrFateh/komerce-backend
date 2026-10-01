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

function mountFor(env, pathname, surface, user, extra = {}) {
  return env.api.mount({
    document: env.document,
    pathname,
    surface,
    user,
    ...extra,
  });
}

function primaryLinksOf(header) {
  const inner = header.children[0];
  const primary = inner.children[1];
  if (!String(primary.className || '').includes('is-capability-map')) return primary.children;
  const links = [];
  primary.children.forEach(group => {
    (group.children || []).forEach(node => {
      if (node && node.attributes && node.attributes['data-dashboard']) links.push(node);
    });
  });
  return links;
}

function findPrimaryLink(header, id) {
  return primaryLinksOf(header).find(link => link.attributes['data-dashboard'] === id);
}

function primaryIdsOf(header) {
  return primaryLinksOf(header).map(link => link.attributes['data-dashboard']);
}

function utilitiesOf(header) {
  return header.children[0].children[2];
}

function secondaryNav(header) {
  // header.children[0] = inner row (identity/primary/utilities) ; header.children[1] = N2, s'il existe.
  return header.children[1];
}

afterEach(() => {
  delete global.window;
  delete global.document;
});

describe('canonical admin navigation — contrat N1 du mock (doctrine V2 §2)', () => {
  test('admin voit exactement les 8 domaines N1, dans l’ordre canonique (Live après Opérations) — Paramètres n’est plus dans le N1', () => {
    const env = loadNavigation('/admin/pilotage', 'pilotage');
    const header = mountFor(env, '/admin/pilotage', 'pilotage', { role: 'admin' });

    expect(env.api.visibleDomainsFor({ role: 'admin' }).map(domain => domain.id)).toEqual([
      'dashboard', 'pricing', 'catalog', 'orders', 'markets', 'operations', 'live', 'finance',
    ]);
    expect(header.children[0].children[1].className).toContain('is-capability-map');
  });

  test('admin voit les 4 dashboards maîtres regroupés en tête de la sidebar', () => {
    const env = loadNavigation('/admin/pilotage', 'pilotage');
    const header = mountFor(env, '/admin/pilotage', 'pilotage', { role: 'admin' });
    const primary = header.children[0].children[1];
    const dashboardsGroup = primary.children[0];

    expect(dashboardsGroup.children[0].textContent).toBe('Dashboards');
    expect(dashboardsGroup.children.slice(1).map(link => link.textContent)).toEqual([
      'Pilotage', 'Commerce', 'Opérations', 'Finance',
    ]);
    expect(dashboardsGroup.children.slice(1).map(link => link.href)).toEqual([
      '/admin/pilotage', '/admin/commerce', '/admin/operations', '/admin/finance',
    ]);
    expect(dashboardsGroup.children[1].attributes['aria-current']).toBe('page');
  });

  test('Paramètres apparaît dans la zone utilitaire pour admin uniquement', () => {
    const adminEnv = loadNavigation('/admin/pilotage', 'pilotage');
    const adminHeader = mountFor(adminEnv, '/admin/pilotage', 'pilotage', { role: 'admin' });
    const adminUtilities = utilitiesOf(adminHeader);
    const adminSettings = adminUtilities.children.find(node => node.attributes['data-dashboard'] === 'settings');
    expect(adminSettings).toBeDefined();
    expect(adminSettings.href).toBe('/admin/settings');

    const operatorEnv = loadNavigation('/admin/pilotage', 'pilotage');
    const operatorHeader = mountFor(operatorEnv, '/admin/pilotage', 'pilotage', { role: 'market_operator' });
    const operatorUtilities = utilitiesOf(operatorHeader);
    expect(operatorUtilities.children.find(node => node.attributes['data-dashboard'] === 'settings')).toBeUndefined();
  });

  test('Paramètres est marqué actif quand on est sur /admin/settings', () => {
    const env = loadNavigation('/admin/settings', 'settings');
    const header = mountFor(env, '/admin/settings', 'settings', { role: 'admin' });
    const settings = utilitiesOf(header).children.find(node => node.attributes['data-dashboard'] === 'settings');
    expect(settings.attributes['aria-current']).toBe('page');
  });

  test('Atelier économique est un domaine direct actif, sans bouton Retour parasite', () => {
    const env = loadNavigation('/admin/workspaces/pricing', 'pricing-workspace');
    const header = mountFor(env, '/admin/workspaces/pricing', 'pricing-workspace', { role: 'admin' });

    const inner = header.children[0];
    const identity = inner.children[0];
    const primary = inner.children[1];
    const pricing = findPrimaryLink(header, 'pricing-workspace');

    expect(identity.children).toHaveLength(1);
    expect(identity.children[0].children[0].textContent).toBe('KOMERCE');
    expect(pricing.href).toBe('/admin/workspaces/pricing');
    expect(pricing.attributes['aria-current']).toBe('page');
  });

  test('les drill-downs gardent un Retour sans réintroduire les anciens onglets techniques', () => {
    const env = loadNavigation('/admin/orders/ORD-001', 'order-360');
    const header = mountFor(env, '/admin/orders/ORD-001', 'order-360', { role: 'admin' });

    const inner = header.children[0];
    const identity = inner.children[0];
    const primary = inner.children[1];
    const orders = findPrimaryLink(header, 'orders-overview');

    expect(identity.children[1].textContent).toBe('← Retour au commerce');
    expect(identity.children[1].href).toBe('/admin/commerce');
    expect(orders.attributes['aria-current']).toBeUndefined();
    expect(env.api.activePrimarySurface('order-360')).toBe('orders');
    // Order-360 reste un vrai drill-down Entity 360, pas un domaine N1 promu :
    // seuls les domaines canoniques (7 du mock + Live opérationnel) apparaissent, dans l'ordre.
    expect(env.api.visibleDomainsFor({ role: 'admin' }).map(domain => domain.label)).toEqual([
      'Dashboard', 'Atelier économique', 'Catalogue', 'Commandes', 'Marchés', 'Opérations', 'Live', 'Finance',
    ]);
  });

  test('un drill-down respecte le parent métier explicite return_to plutôt que son fallback générique', () => {
    const env = loadNavigation('/admin/products/P-1', 'product-360', {
      window: {
        location: {
          pathname: '/admin/products/P-1',
          search: '?return_to=%2Fadmin%2Fimport-runtime%3Frun%3DKIR-000004%26view%3Dcatalogue&return_label=Retour+au+lot',
          href: 'https://komerce.test/admin/products/P-1',
        },
      },
    });
    const header = mountFor(env, '/admin/products/P-1', 'product-360', { role: 'admin' });
    const back = header.children[0].children[0].children[1];

    expect(back.textContent).toBe('← Retour au lot');
    expect(back.href).toBe('/admin/import-runtime?run=KIR-000004&view=catalogue');
    expect(back.attributes['data-back-context']).toBe('contextual');
  });

  test('return_to externe ou ambigu est refusé et retombe sur le parent canonique', () => {
    const env = loadNavigation('/admin/products/P-1', 'product-360', {
      window: {
        location: {
          pathname: '/admin/products/P-1',
          search: '?return_to=https%3A%2F%2Fevil.example%2Fphish&return_label=Retour',
          href: 'https://komerce.test/admin/products/P-1',
        },
      },
    });
    const header = mountFor(env, '/admin/products/P-1', 'product-360', { role: 'admin' });
    const back = header.children[0].children[0].children[1];

    expect(back.textContent).toBe('← Retour au catalogue');
    expect(back.href).toBe('/admin/workspaces/catalog');
    expect(back.attributes['data-back-context']).toBe('canonical');
  });

  test('Marchés pointe vers la gestion des accès pour admin et vers autonomie marché pour market_operator', () => {
    const adminEnv = loadNavigation('/dashboards/canonical/access.html', 'market-access');
    const adminHeader = mountFor(adminEnv, '/dashboards/canonical/access.html', 'market-access', { role: 'admin' });
    const adminMarkets = findPrimaryLink(adminHeader, 'markets');
    expect(adminMarkets.href).toBe('/dashboards/canonical/access.html');
    expect(adminMarkets.attributes['aria-current']).toBe('page');

    const operatorEnv = loadNavigation('/admin/pilotage', 'pilotage');
    const operatorHeader = mountFor(operatorEnv, '/admin/pilotage', 'pilotage', { role: 'market_operator' });
    const operatorMarkets = operatorHeader.children[0].children[1].children.find(link => link.attributes['data-dashboard'] === 'markets');
    expect(operatorMarkets.href).toBe('/dashboards/canonical/market-autonomy.html');
  });

  test('Catalogue reste global pour admin et devient Catalogue pays pour market_operator', () => {
    const adminEnv = loadNavigation('/admin/pilotage', 'pilotage');
    const adminHeader = mountFor(adminEnv, '/admin/pilotage', 'pilotage', { role: 'admin' });
    const adminCatalog = findPrimaryLink(adminHeader, 'catalog');
    expect(adminCatalog.href).toBe('/admin/workspaces/catalog');

    const operatorEnv = loadNavigation('/dashboards/canonical/market-catalog.html', 'market-catalog');
    const operatorHeader = mountFor(operatorEnv, '/dashboards/canonical/market-catalog.html', 'market-catalog', { role: 'market_operator' });
    const operatorCatalog = operatorHeader.children[0].children[1].children.find(link => link.attributes['data-dashboard'] === 'catalog');
    expect(operatorCatalog.href).toBe('/dashboards/canonical/market-catalog.html');
    expect(operatorCatalog.attributes['aria-current']).toBe('page');
  });

  test('Dashboard reste actif pour les surfaces techniques non exposées dans le mock', () => {
    const env = loadNavigation('/admin/demo', 'demo');
    const header = env.api.mount({ document: env.document, pathname: '/admin/demo', surface: 'demo' });
    const dashboard = header.children[0].children[1].children.find(link => link.attributes['data-dashboard'] === 'dashboard');
    expect(dashboard.attributes['aria-current']).toBe('page');
  });
});

describe('canonical admin navigation — N2 domaine Opérations (doctrine V2 §4)', () => {
  test('admin voit les 3 espaces Opérations dans l’ordre canonique, Expéditions & Douane actif (Sourcing live est dans Live)', () => {
    const env = loadNavigation('/admin/workspaces/shipping-customs', 'shipping-customs-workspace');
    const header = mountFor(env, '/admin/workspaces/shipping-customs', 'shipping-customs-workspace', { role: 'admin' });

    const shippingCustoms = findPrimaryLink(header, 'shipping-customs-workspace');
    expect(shippingCustoms.attributes['aria-current']).toBe('page');

    const n2 = secondaryNav(header);
    expect(n2.className).toBe('kmc-admin-secondary-nav');
    const ids = n2.children.map(link => link.attributes['data-dashboard']);
    expect(ids).toEqual(['operations-overview', 'operations-workspace', 'shipping-customs-workspace']);

    const active = n2.children.find(link => link.attributes['data-dashboard'] === 'shipping-customs-workspace');
    expect(active.attributes['aria-current']).toBe('page');
    expect(active.href).toBe('/admin/workspaces/shipping-customs');
  });

  test('market_operator voit Vue d’ensemble, Hub/Relais, Expéditions & Douane — jamais Sourcing', () => {
    const env = loadNavigation('/admin/operations', 'operations');
    const header = mountFor(env, '/admin/operations', 'operations', { role: 'market_operator' });

    const n2 = secondaryNav(header);
    const ids = n2.children.map(link => link.attributes['data-dashboard']);
    expect(ids).toEqual(['operations-overview', 'operations-workspace', 'shipping-customs-workspace']);
    expect(ids).not.toContain('sourcing-workspace');

    const overview = n2.children.find(link => link.attributes['data-dashboard'] === 'operations-overview');
    expect(overview.attributes['aria-current']).toBe('page');
  });

  test('agent_hub voit Hub/Relais + Expéditions & Douane, pas de Vue d’ensemble (guard admin/market_operator only)', () => {
    const env = loadNavigation('/admin/workspaces/operations', 'operations-workspace');
    const header = mountFor(env, '/admin/workspaces/operations', 'operations-workspace', { role: 'agent_hub' });

    const n2 = secondaryNav(header);
    const ids = n2.children.map(link => link.attributes['data-dashboard']);
    expect(ids).toEqual(['operations-workspace', 'shipping-customs-workspace']);

    const active = n2.children.find(link => link.attributes['data-dashboard'] === 'operations-workspace');
    expect(active.attributes['aria-current']).toBe('page');
  });

  test('agent_relais n’a qu’un seul espace Opérations visible (Hub/Relais) — aucune ligne N2 rendue', () => {
    const env = loadNavigation('/admin/workspaces/operations', 'operations-workspace');
    const header = mountFor(env, '/admin/workspaces/operations', 'operations-workspace', { role: 'agent_relais' });
    expect(secondaryNav(header)).toBeUndefined();

    const operations = header.children[0].children[1].children.find(link => link.attributes['data-dashboard'] === 'operations');
    expect(operations.href).toBe('/admin/workspaces/operations');
    expect(operations.attributes['aria-current']).toBe('page');
  });

  test('agent_transitaire n’a qu’Expéditions & Douane — aucune ligne N2, le domaine mène directement dessus', () => {
    const env = loadNavigation('/admin/pilotage', 'pilotage');
    const header = mountFor(env, '/admin/pilotage', 'pilotage', { role: 'agent_transitaire' });
    expect(secondaryNav(header)).toBeUndefined();

    const operations = header.children[0].children[1].children.find(link => link.attributes['data-dashboard'] === 'operations');
    expect(operations.href).toBe('/admin/workspaces/shipping-customs');
  });

  test('le rôle sourcing atterrit directement sur le domaine Live (cockpit), sans passer par Opérations', () => {
    const env = loadNavigation('/admin/pilotage', 'pilotage');
    const header = mountFor(env, '/admin/pilotage', 'pilotage', { role: 'sourcing' });
    expect(secondaryNav(header)).toBeUndefined();

    const live = header.children[0].children[1].children.find(link => link.attributes['data-dashboard'] === 'live');
    expect(live.href).toBe('/admin/import-runtime');
    expect(header.children[0].children[1].children.find(link => link.attributes['data-dashboard'] === 'operations')).toBeUndefined();
  });
});

describe('canonical admin navigation — N2 domaine Finance (doctrine V2 §4)', () => {
  test('admin et market_operator voient Vue d’ensemble + Comptabilité', () => {
    ['admin', 'market_operator'].forEach(role => {
      const env = loadNavigation('/admin/workspaces/accounting', 'accounting-workspace');
      const header = mountFor(env, '/admin/workspaces/accounting', 'accounting-workspace', { role });
      const n2 = secondaryNav(header);
      const ids = n2.children.map(link => link.attributes['data-dashboard']);
      expect(ids).toEqual(['finance-overview', 'accounting-workspace']);
      expect(n2.children.find(link => link.attributes['data-dashboard'] === 'accounting-workspace').attributes['aria-current']).toBe('page');
    });
  });

  test('finance et agent_relais n’ont que Comptabilité — le domaine Finance y mène directement, sans N2', () => {
    ['finance', 'agent_relais'].forEach(role => {
      const env = loadNavigation('/admin/pilotage', 'pilotage');
      const header = mountFor(env, '/admin/pilotage', 'pilotage', { role });
      expect(secondaryNav(header)).toBeUndefined();
      const finance = header.children[0].children[1].children.find(link => link.attributes['data-dashboard'] === 'finance');
      expect(finance.href).toBe('/admin/workspaces/accounting');
    });
  });
});

describe('canonical admin navigation — filtrage par rôle des domaines N1 (docs/admin-nav-capability-map.md + doctrine V2)', () => {
  test.each([
    ['admin', ['dashboard', 'pricing', 'catalog', 'orders', 'markets', 'operations', 'live', 'finance']],
    ['market_operator', ['dashboard', 'pricing', 'catalog', 'orders', 'markets', 'operations', 'finance']],
    ['finance', ['dashboard', 'finance']],
    ['sourcing', ['dashboard', 'live']],
    ['agent_hub', ['dashboard', 'operations', 'live']],
    ['agent_relais', ['dashboard', 'operations', 'live', 'finance']],
    ['agent_transitaire', ['dashboard', 'operations']],
    ['support', ['dashboard']],
    ['inconnu', ['dashboard']],
  ])('%s voit exactement ses domaines N1 — jamais un domaine qui 403', (role, expected) => {
    const env = loadNavigation('/admin/pilotage', 'pilotage');
    const header = mountFor(env, '/admin/pilotage', 'pilotage', { role });
    const renderedOrCanonical = role === 'admin'
      ? env.api.visibleDomainsFor({ role }).map(domain => domain.id)
      : primaryIdsOf(header);
    expect(renderedOrCanonical).toEqual(expected);
  });

  test('chaque rôle connu voit au moins Dashboard, toujours en premier', () => {
    const env = loadNavigation('/admin/pilotage', 'pilotage');
    const allRoles = ['admin', 'market_operator', 'finance', 'sourcing', 'agent_hub', 'agent_relais', 'agent_transitaire', 'support'];
    allRoles.forEach(role => {
      const domains = env.api.visibleDomainsFor({ role });
      expect(domains.length).toBeGreaterThanOrEqual(1);
      expect(domains[0].id).toBe('dashboard');
    });
  });

  test('visibleDomainsFor / visibleSpacesFor / landingForDomain sont exposées et cohérentes avec le rendu de mount()', () => {
    const env = loadNavigation('/admin/pilotage', 'pilotage');
    const domains = env.api.visibleDomainsFor({ role: 'market_operator' });
    expect(domains.map(d => d.id)).toEqual(['dashboard', 'pricing', 'catalog', 'orders', 'markets', 'operations', 'finance']);

    const operationsDomain = env.api.DOMAINS.find(d => d.id === 'operations');
    const spaces = env.api.visibleSpacesFor(operationsDomain, 'market_operator');
    expect(spaces.map(s => s.id)).toEqual(['operations-overview', 'operations-workspace', 'shipping-customs-workspace']);
    expect(env.api.landingForDomain(operationsDomain, { role: 'market_operator' })).toBe('/admin/operations');

    const financeDomain = env.api.DOMAINS.find(d => d.id === 'finance');
    expect(env.api.landingForDomain(financeDomain, { role: 'agent_relais' })).toBe('/admin/workspaces/accounting');
  });

  test('aucun onglet N1 ni espace N2 non prouvé côté serveur n’est jamais rendu (defense en profondeur rôle inconnu)', () => {
    const env = loadNavigation('/admin/pilotage', 'pilotage');
    const header = mountFor(env, '/admin/pilotage', 'pilotage', { role: 'inconnu' });
    expect(primaryIdsOf(header)).toEqual(['dashboard']);
    expect(secondaryNav(header)).toBeUndefined();
  });
});

describe('canonical admin navigation — zone utilitaire et marché', () => {
  test('le sélecteur Market ID est intégré à droite quand le contexte serveur est disponible', () => {
    const env = loadNavigation('/admin/workspaces/pricing', 'pricing-workspace');
    const header = mountFor(env, '/admin/workspaces/pricing', 'pricing-workspace', { role: 'admin' }, {
      adminContext: {
        access: {
          mode: 'market',
          defaultMarket: 'CM',
          allowedMarkets: ['CM', 'CG'],
        },
      },
    });
    const marketControl = utilitiesOf(header).children[0];
    const select = marketControl.children[1];
    expect(select.value).toBe('CM');
    expect(select.children.map(option => option.value)).toEqual(['CM', 'CG']);
    expect(select.children.map(option => option.textContent)).not.toContain('Global · Tous les marchés');
  });

  test('Catalogue pays exige lui aussi un Market ID explicite pour adminContext global', () => {
    const env = loadNavigation('/dashboards/canonical/market-catalog.html', 'market-catalog');
    const header = mountFor(env, '/dashboards/canonical/market-catalog.html', 'market-catalog', { role: 'market_operator' }, {
      adminContext: {
        access: {
          mode: 'global',
          defaultMarket: 'CG',
          allowedMarkets: ['CM', 'CG'],
        },
      },
    });
    const select = utilitiesOf(header).children[0].children[1];
    expect(select.value).toBe('CG');
    expect(select.children.map(option => option.value)).toEqual(['CM', 'CG']);
  });

  test('le drapeau visible suit le Market ID sélectionné sans dépendre des emoji Windows', () => {
    const env = loadNavigation('/admin/workspaces/pricing', 'pricing-workspace');
    const header = mountFor(env, '/admin/workspaces/pricing', 'pricing-workspace', { role: 'admin' }, {
      adminContext: {
        access: {
          mode: 'global',
          defaultMarket: 'CM',
          allowedMarkets: ['CM', 'CG', 'KM'],
        },
      },
    });
    const marketControl = utilitiesOf(header).children[0];
    const flag = marketControl.children[0];
    const select = marketControl.children[1];

    expect(flag.src).toBe('/dashboards/canonical/assets/flags/CM.svg');
    select.value = 'CG';
    select.listeners.change();
    expect(flag.src).toBe('/dashboards/canonical/assets/flags/CG.svg');
    expect(flag.attributes['data-market-flag']).toBe('CG');
    select.value = 'KM';
    select.listeners.change();
    expect(flag.src).toBe('/dashboards/canonical/assets/flags/KM.svg');
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
    const header = mountFor(env, '/admin/pilotage', 'pilotage', { role: 'admin' });
    const utilities = utilitiesOf(header);
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
});

describe('canonical admin navigation — pas de Retour redondant sur les espaces N2 (doctrine V2 §9)', () => {
  test('operations / operations-workspace / shipping-customs-workspace / sourcing-workspace / finance / accounting-workspace n’affichent jamais de Retour', () => {
    const env = loadNavigation('/admin/pilotage', 'pilotage');
    ['operations', 'operations-workspace', 'shipping-customs-workspace', 'sourcing-workspace', 'finance', 'accounting-workspace'].forEach(surface => {
      const header = mountFor(env, `/admin/${surface}`, surface, { role: 'admin' });
      const back = header.children[0].children[0].children.find(node => node.className === 'kmc-admin-back');
      expect(back).toBeUndefined();
    });
  });
});


describe('canonical admin navigation — outils staging fail-closed', () => {
  test('ne projette jamais Reset / Seed hors staging', async () => {
    const fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ komerce_env: 'production' }),
    });
    const env = loadNavigation('/admin/pilotage', 'pilotage', { window: { fetch } });
    const group = fakeNode('div');

    const mounted = await env.api.mountStagingAdminTools(env.document, group);

    expect(mounted).toBe(false);
    expect(group.children).toHaveLength(0);
    expect(fetch).toHaveBeenCalledWith('/health', expect.objectContaining({ method: 'GET' }));
  });

  test('projette Reset / Seed uniquement quand le serveur annonce KOMERCE_ENV=staging', async () => {
    const fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ komerce_env: 'staging' }),
    });
    const env = loadNavigation('/admin/pilotage', 'pilotage', { window: { fetch } });
    const group = fakeNode('div');

    const mounted = await env.api.mountStagingAdminTools(env.document, group);

    expect(mounted).toBe(true);
    const tools = group.children[0];
    expect(tools.attributes['data-staging-tools']).toBe('true');
    expect(tools.children.find(node => node.attributes['data-admin-action'] === 'reset-orders')).toBeDefined();
    expect(tools.children.find(node => node.attributes['data-admin-action'] === 'seed-test')).toBeDefined();
  });

  test('Reset staging envoie une confirmation explicite et reste borné au mode orders', async () => {
    const fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ komerce_env: 'staging' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ message: 'Reset ok' }) });
    const confirm = jest.fn(() => true);
    const env = loadNavigation('/admin/pilotage', 'pilotage', { window: { fetch, confirm } });
    const group = fakeNode('div');

    await env.api.mountStagingAdminTools(env.document, group);
    const tools = group.children[0];
    const reset = tools.children.find(node => node.attributes['data-admin-action'] === 'reset-orders');
    await reset.listeners.click();

    expect(confirm).toHaveBeenCalled();
    expect(fetch).toHaveBeenLastCalledWith('/api/admin/reset', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ mode: 'orders', confirm: true }),
    }));
  });

  test('Seed staging exige confirmation et appelle le endpoint protégé existant', async () => {
    const fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ komerce_env: 'staging' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ message: 'Seed ok' }) });
    const confirm = jest.fn(() => true);
    const env = loadNavigation('/admin/pilotage', 'pilotage', { window: { fetch, confirm } });
    const group = fakeNode('div');

    await env.api.mountStagingAdminTools(env.document, group);
    const tools = group.children[0];
    const seed = tools.children.find(node => node.attributes['data-admin-action'] === 'seed-test');
    await seed.listeners.click();

    expect(confirm).toHaveBeenCalled();
    expect(fetch).toHaveBeenLastCalledWith('/api/admin/seed-test', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ confirm: true }),
    }));
  });
});
