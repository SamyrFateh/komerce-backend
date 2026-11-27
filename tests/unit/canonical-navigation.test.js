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
    KomerceAdminContext: require('../../public/dashboards/canonical/js/admin-context.js'),
    KomerceCanonicalAdmin: {
      surfaceForPath: jest.fn(() => surface),
      marketChoices: jest.fn((context, opts = {}) => {
        const access = context && context.access;
        if (!access) return [];
        const globalAllowed=(access.mode==='global' && (!opts.requireMarket || opts.allowGlobalOverview)) ||
          (access.mode==='hub' && opts.allowHubOverview);
        const rows = globalAllowed ? [{ value: '', marketCode: null, label: 'Global · Tous les marchés' }] : [];
        access.allowedMarkets.forEach(code => rows.push({ value: code, marketCode: code, label: code }));
        return rows;
      }),
    },
    ...(options.window || {}),
  };
  global.document = document;

  require('../../public/dashboards/canonical/js/navigation-policy-v4.js');

  // Le rendu structurel (header N1/N2, Retour, marché, utilitaires) est testé
  // sans la coque hybride V4 : `_buildHeader` est la couche de construction du
  // fichier de navigation unique, `mount` y ajoute seulement le shell.
  const full = global.window.KomerceCanonicalNavigation;
  const api = { ...full, mount: options => full._buildHeader(options) };

  return {
    api,
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
    expect(header.children[0].children[1].className).toBe('kmc-admin-primary-nav');
    expect(primaryIdsOf(header)).toEqual(['dashboard', 'pricing', 'catalog', 'orders', 'markets', 'operations', 'live', 'finance']);
  });

  test('admin utilise la navigation canonique de domaines sans capability map parallèle', () => {
    const env = loadNavigation('/admin/pilotage', 'pilotage');
    const header = mountFor(env, '/admin/pilotage', 'pilotage', { role: 'admin' });
    const primary = header.children[0].children[1];

    expect(primary.className).toBe('kmc-admin-primary-nav');
    expect(primary.children.map(link => link.attributes['data-dashboard'])).toEqual([
      'dashboard', 'pricing', 'catalog', 'orders', 'markets', 'operations', 'live', 'finance',
    ]);
    expect(primary.children[0].href).toBe('/admin/pilotage');
    expect(primary.children[0].attributes['aria-current']).toBe('page');
  });

  test('Paramètres n’est plus dupliqué dans la zone utilitaire (une seule entrée, dans la sidebar Administration)', () => {
    const adminEnv = loadNavigation('/admin/pilotage', 'pilotage');
    const adminHeader = mountFor(adminEnv, '/admin/pilotage', 'pilotage', { role: 'admin' });
    expect(utilitiesOf(adminHeader).children.find(node => node.attributes['data-dashboard'] === 'settings')).toBeUndefined();
    const ids = adminEnv.api.sidebarGroupsFor({ role: 'admin' }, null).flatMap(group => group.items.map(item => item.id));
    expect(ids.filter(id => id === 'settings')).toHaveLength(1);

    const operatorEnv = loadNavigation('/admin/pilotage', 'pilotage');
    const operatorIds = operatorEnv.api.sidebarGroupsFor({ role: 'market_operator' }, null).flatMap(group => group.items.map(item => item.id));
    // Le responsable marché voit la rubrique Paramètres ; sa destination est une vue
    // limitée à ses marchés et n'accorde aucun pouvoir d'administration centrale.
    expect(operatorIds.filter(id => id === 'settings')).toHaveLength(1);
    const operatorSettings = operatorEnv.api.sidebarGroupsFor({ role: 'market_operator' }, null)
      .flatMap(group => group.items).find(item => item.id === 'settings');
    expect(operatorSettings.href).toBe('/admin/settings');
  });

  test('Atelier économique est un domaine direct actif, sans bouton Retour parasite', () => {
    const env = loadNavigation('/admin/workspaces/pricing', 'pricing-workspace');
    const header = mountFor(env, '/admin/workspaces/pricing', 'pricing-workspace', { role: 'admin' });

    const inner = header.children[0];
    const identity = inner.children[0];
    const primary = inner.children[1];
    const pricing = findPrimaryLink(header, 'pricing');

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
    const orders = findPrimaryLink(header, 'orders');

    expect(identity.children[1].textContent).toBe('← Retour aux commandes');
    expect(identity.children[1].href).toBe('/admin/orders');
    expect(orders.attributes['aria-current']).toBe('page');
    expect(env.api.activePrimarySurface('order-360')).toBe('orders');
    // Order-360 reste un vrai drill-down Entity 360, pas un domaine N1 promu :
    // seuls les domaines canoniques (7 du mock + Live opérationnel) apparaissent, dans l'ordre.
    expect(env.api.visibleDomainsFor({ role: 'admin' }).map(domain => domain.label)).toEqual([
      'Dashboard', 'Prix & économie', 'Catalogue', 'Commandes', 'Marchés', 'Opérations', 'Live', 'Finance',
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
    expect(operatorMarkets.href).toBe('/dashboards/canonical/unsold.html');
  });

  test('Catalogue : même destination canonique, lentille marché pour le responsable pays', () => {
    const adminEnv = loadNavigation('/admin/pilotage', 'pilotage');
    const adminHeader = mountFor(adminEnv, '/admin/pilotage', 'pilotage', { role: 'admin' });
    expect(findPrimaryLink(adminHeader, 'catalog').href).toBe('/admin/workspaces/catalog');

    const operatorEnv = loadNavigation('/dashboards/canonical/market-catalog.html', 'market-catalog');
    const operatorHeader = mountFor(operatorEnv, '/dashboards/canonical/market-catalog.html', 'market-catalog', { role: 'market_operator' });
    const operatorLinks = operatorHeader.children[0].children[1].children;
    const catalog = operatorLinks.find(link => link.attributes['data-dashboard'] === 'catalog');
    expect(catalog.href).toBe('/admin/workspaces/catalog');
    expect(catalog.attributes['aria-current']).toBe('page');
  });

  test('Dashboard reste actif pour les surfaces techniques non exposées dans le mock', () => {
    const env = loadNavigation('/admin/demo', 'demo');
    const header = mountFor(env, '/admin/demo', 'demo', { role: 'admin' });
    const dashboard = header.children[0].children[1].children.find(link => link.attributes['data-dashboard'] === 'dashboard');
    expect(dashboard.attributes['aria-current']).toBe('page');
  });
});

describe('canonical admin navigation — N2 domaine Opérations (doctrine V2 §4)', () => {
  test('admin voit les 3 espaces Opérations dans l’ordre canonique, Expéditions & Douane actif (Sourcing live est dans Live)', () => {
    const env = loadNavigation('/admin/workspaces/shipping-customs', 'shipping-customs-workspace');
    const header = mountFor(env, '/admin/workspaces/shipping-customs', 'shipping-customs-workspace', { role: 'admin' });

    const shippingCustoms = findPrimaryLink(header, 'operations');
    expect(shippingCustoms.attributes['aria-current']).toBe('page');

    const n2 = secondaryNav(header);
    expect(n2.className).toBe('kmc-admin-secondary-nav');
    const ids = n2.children.map(link => link.attributes['data-dashboard']);
    expect(ids).toEqual(['operations-overview', 'shipping-customs-workspace', 'purchasing-workspace']);

    const active = n2.children.find(link => link.attributes['data-dashboard'] === 'shipping-customs-workspace');
    expect(active.attributes['aria-current']).toBe('page');
    expect(active.href).toBe('/admin/workspaces/shipping-customs');
  });

  test('Achats fournisseurs : espace Opérations réservé à admin, actif sur sa propre surface', () => {
    const env = loadNavigation('/admin/workspaces/purchasing', 'purchasing-workspace');
    expect(env.api.activePrimarySurface('purchasing-workspace')).toBe('operations');
    expect(env.api.activeSpaceFor('purchasing-workspace')).toBe('purchasing-workspace');

    const header = mountFor(env, '/admin/workspaces/purchasing', 'purchasing-workspace', { role: 'admin' });
    const active = secondaryNav(header).children.find(link => link.attributes['data-dashboard'] === 'purchasing-workspace');
    expect(active.attributes['aria-current']).toBe('page');
    expect(active.href).toBe('/admin/workspaces/purchasing');

    for (const role of ['market_operator', 'agent_hub', 'agent_relais', 'agent_transitaire']) {
      const roleEnv = loadNavigation('/admin/operations', 'operations');
      const roleHeader = mountFor(roleEnv, '/admin/operations', 'operations', { role });
      const nav = secondaryNav(roleHeader);
      const ids = nav ? nav.children.map(link => link.attributes['data-dashboard']) : [];
      expect(ids).not.toContain('purchasing-workspace');
    }
  });

  test('market_operator voit Vue d’ensemble et Expéditions & Douane — sans entrée Relais hors rôle', () => {
    const env = loadNavigation('/admin/operations', 'operations');
    const header = mountFor(env, '/admin/operations', 'operations', { role: 'market_operator' });

    const n2 = secondaryNav(header);
    const ids = n2.children.map(link => link.attributes['data-dashboard']);
    expect(ids).toEqual(['operations-overview', 'shipping-customs-workspace']);
    expect(ids).not.toContain('sourcing-workspace');

    const overview = n2.children.find(link => link.attributes['data-dashboard'] === 'operations-overview');
    expect(overview.attributes['aria-current']).toBe('page');
  });

  test('agent_hub : Opérations mène directement à Expéditions & Douane (un seul espace), son cockpit est dans Live', () => {
    const env = loadNavigation('/admin/pilotage', 'pilotage');
    const header = mountFor(env, '/admin/pilotage', 'pilotage', { role: 'agent_hub' });
    expect(secondaryNav(header)).toBeUndefined();
    const links = header.children[0].children[1].children;
    expect(links.find(link => link.attributes['data-dashboard'] === 'operations').href).toBe('/admin/workspaces/shipping-customs');
    expect(links.find(link => link.attributes['data-dashboard'] === 'live').href).toBe('/admin/hub');
  });

  test('agent_relais n’a plus d’écran Opérations : Hub global et Relais sont dans Live', () => {
    const env = loadNavigation('/admin/pilotage', 'pilotage');
    const header = mountFor(env, '/admin/pilotage', 'pilotage', { role: 'agent_relais' });
    const links = header.children[0].children[1].children;
    expect(links.find(link => link.attributes['data-dashboard'] === 'operations')).toBeUndefined();
    expect(links.find(link => link.attributes['data-dashboard'] === 'finance')).toBeUndefined();
    expect(links.find(link => link.attributes['data-dashboard'] === 'live').href).toBe('/admin/hub');
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

  test('finance voit Comptabilité sans renvoi non autorisé au Relais ; agent_relais n’a pas de Finance', () => {
    const env = loadNavigation('/admin/pilotage', 'pilotage');
    const header = mountFor(env, '/admin/pilotage', 'pilotage', { role: 'finance' });
    const finance = header.children[0].children[1].children.find(link => link.attributes['data-dashboard'] === 'finance');
    expect(finance.href).toBe('/admin/workspaces/accounting');
    const relais = mountFor(loadNavigation('/admin/pilotage', 'pilotage'), '/admin/pilotage', 'pilotage', { role: 'agent_relais' });
    expect(relais.children[0].children[1].children.find(link => link.attributes['data-dashboard'] === 'finance')).toBeUndefined();
  });
});

describe('canonical admin navigation — zone utilitaire et marché', () => {
  test('le sélecteur Market ID est intégré à droite : multi-marchés sans choix -> « Choisir un marché… » (L1)', () => {
    const env = loadNavigation('/admin/workspaces/pricing', 'pricing-workspace');
    const header = mountFor(env, '/admin/workspaces/pricing', 'pricing-workspace', { role: 'admin' }, {
      adminContext: {
        actor: { id: 'o', role: 'market_operator' },
        access: {
          mode: 'market',
          defaultMarket: 'CM',
          allowedMarkets: ['CM', 'CG'],
          capabilities: [],
        },
      },
    });
    const marketControl = utilitiesOf(header).children[0];
    const select = marketControl.children[1];
    expect(select.value).toBe('');
    expect(select.children.map(option => option.value)).toEqual(['', 'CM', 'CG']);
    expect(select.children[0].textContent).toBe('Choisir un marché…');
    expect(select.children.map(option => option.textContent)).not.toContain('Global · Tous les marchés');
  });

  test('délégation mono-marché : le marché est sélectionné automatiquement (L1)', () => {
    const env = loadNavigation('/admin/workspaces/pricing', 'pricing-workspace');
    const header = mountFor(env, '/admin/workspaces/pricing', 'pricing-workspace', { role: 'admin' }, {
      adminContext: { actor: { id: 'o', role: 'market_operator' }, access: { mode: 'market', defaultMarket: 'CM', allowedMarkets: ['CM'], capabilities: [] } },
    });
    const label = utilitiesOf(header).children[0].children[1];
    expect(label.tagName).toBe('SPAN');
    expect(label.attributes['data-fixed-market']).toBe('CM');
    expect(label.textContent).toBe('CM');
    expect(label.listeners.change).toBeUndefined();
  });

  test('Catalogue pays et Autonomie marché exigent une cible d’action explicite (L1)', () => {
    const globalCtx = {
      actor: { id: 'a', role: 'admin' },
      access: { mode: 'global', defaultMarket: null, allowedMarkets: ['CG', 'CM'], capabilities: [] },
    };
    [
      ['/dashboards/canonical/market-catalog.html', 'market-catalog', ''],
      ['/dashboards/canonical/market-autonomy.html', 'market-autonomy', ''],
    ].forEach(([pathname, surface, search]) => {
      const env = loadNavigation(pathname, surface, { window: { location: { pathname, search, href: `https://komerce.test${pathname}${search}` } } });
      const header = mountFor(env, pathname, surface, { role: 'admin' }, { adminContext: globalCtx });
      const select = utilitiesOf(header).children[0].children[1];
      expect(select.value).toBe('');
      expect(select.children.map(option => option.value)).toEqual(['', 'CG', 'CM']);
    });
  });


  test('Global dans la topbar pour Douane/Comptabilité, pas pour Pricing ; aucun droit déduit du rôle', () => {
    const globalCtx={actor:{id:'g',role:'admin'},access:{
      mode:'global',defaultMarket:null,allowedMarkets:['KM','CM'],capabilities:['dashboard.global.read'],
    }};
    for(const [pathname,surface] of [
      ['/admin/workspaces/shipping-customs','shipping-customs-workspace'],
      ['/admin/workspaces/accounting','accounting-workspace'],
    ]) {
      const env=loadNavigation(pathname,surface);
      const header=mountFor(env,pathname,surface,{role:'admin'},{adminContext:globalCtx});
      const select=utilitiesOf(header).children[0].children[1];
      expect(select.children.map(x=>x.value)).toEqual(['','KM','CM']);
      expect(select.children[0].textContent).toBe('Global · Tous les marchés');
      expect(select.value).toBe('');
    }
    const pricing=loadNavigation('/admin/workspaces/pricing','pricing-workspace');
    const h=mountFor(pricing,'/admin/workspaces/pricing','pricing-workspace',{role:'admin'},{adminContext:globalCtx});
    expect(utilitiesOf(h).children[0].children[1].children[0].textContent).toBe('Choisir un marché…');
  });

  test('Hub central ne prend pas un premier marché arbitraire dans la topbar', () => {
    const pathname='/admin/hub-live';
    const env=loadNavigation(pathname,'hub-live',{window:{location:{
      pathname,search:'?view=execute',href:'https://komerce.test/admin/hub-live?view=execute',
    }}});
    const hub={actor:{id:'h',role:'agent_hub'},access:{
      mode:'hub',defaultMarket:'KM',allowedMarkets:['KM'],capabilities:[],
    }};
    const header=mountFor(env,pathname,'hub-live',{role:'agent_hub'},{adminContext:hub});
    const select=utilitiesOf(header).children[0].children[1];
    expect(select.children.map(x=>x.value)).toEqual(['','KM']);
    expect(select.value).toBe('');
  });

  test('un opérateur limité à CM ne reçoit jamais Tous les marchés sur Douane', () => {
    const pathname='/admin/workspaces/shipping-customs';
    const env=loadNavigation(pathname,'shipping-customs-workspace');
    const scoped={actor:{id:'a',role:'admin'},access:{
      mode:'market',defaultMarket:'CM',allowedMarkets:['CM'],capabilities:[],
    }};
    const header=mountFor(env,pathname,'shipping-customs-workspace',{role:'admin'},{adminContext:scoped});
    const label=utilitiesOf(header).children[0].children[1];
    expect(label.tagName).toBe('SPAN');
    expect(label.attributes['data-fixed-market']).toBe('CM');
    expect(label.listeners.change).toBeUndefined();
  });

  test('Hub live hors Exécution reste en vue Global (pas de marché exigé)', () => {
    const pathname = '/admin/hub-live';
    const env = loadNavigation(pathname, 'hub-live', { window: { location: { pathname, search: '', href: `https://komerce.test${pathname}` } } });
    const header = mountFor(env, pathname, 'hub-live', { role: 'admin' }, {
      adminContext: { actor: { id: 'a', role: 'admin' }, access: { mode: 'global', defaultMarket: null, allowedMarkets: ['CG', 'CM'], capabilities: [] } },
    });
    const select = utilitiesOf(header).children[0].children[1];
    expect(select.children.map(option => option.value)).toEqual(['', 'CG', 'CM']);
  });

  test('?market= autorisé est retenu ; le drapeau visible suit le Market ID sans dépendre des emoji Windows', () => {
    const pathname = '/admin/workspaces/pricing';
    const env = loadNavigation(pathname, 'pricing-workspace', { window: { location: { pathname, search: '?market=CM', href: `https://komerce.test${pathname}?market=CM` } } });
    const header = mountFor(env, pathname, 'pricing-workspace', { role: 'admin' }, {
      adminContext: {
        actor: { id: 'a', role: 'admin' },
        access: {
          mode: 'global',
          defaultMarket: null,
          allowedMarkets: ['CM', 'CG', 'KM'],
          capabilities: [],
        },
      },
    });
    const marketControl = utilitiesOf(header).children[0];
    const flag = marketControl.children[0];
    const select = marketControl.children[1];

    expect(select.value).toBe('CM');
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
    ['operations', 'operations-workspace', 'shipping-customs-workspace', 'purchasing-workspace', 'sourcing-workspace', 'finance', 'accounting-workspace'].forEach(surface => {
      const header = mountFor(env, `/admin/${surface}`, surface, { role: 'admin' });
      const back = header.children[0].children[0].children.find(node => node.className === 'kmc-admin-back');
      expect(back).toBeUndefined();
    });
  });
});


describe('console recette isolée — outils staging fail-closed', () => {
  test('aucun outil sur le shell métier, même en staging',async()=>{
    const fetch=jest.fn();
    const env=loadNavigation('/admin/pilotage','pilotage',{window:{fetch}});
    const group=fakeNode('div');
    expect(env.api.mountStagingAdminTools).toBeUndefined();
    expect(await require('../../public/js/golden-recipe-staging-tools.js').mountStagingAdminTools(env.document,group)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  test('refuse une session marché dans la console staging',async()=>{
    const fetch=jest.fn().mockResolvedValueOnce({ok:true,json:async()=>({komerce_env:'staging'})})
      .mockResolvedValueOnce({ok:true,json:async()=>({role:'market_operator'})});
    const env=loadNavigation('/admin/golden-e2e','golden-e2e',{window:{fetch}});
    const group=fakeNode('div');
    expect(await require('../../public/js/golden-recipe-staging-tools.js').mountStagingAdminTools(env.document,group)).toBe(false);
    expect(group.children).toHaveLength(0);
  });
  test('ne projette jamais Reset / Seed hors staging', async () => {
    const fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ komerce_env: 'production' }),
    });
    const env = loadNavigation('/admin/golden-e2e', 'golden-e2e', { window: { fetch } });
    const group = fakeNode('div');

    const mounted = await require('../../public/js/golden-recipe-staging-tools.js').mountStagingAdminTools(env.document, group);

    expect(mounted).toBe(false);
    expect(group.children).toHaveLength(0);
    expect(fetch).toHaveBeenCalledWith('/health', expect.objectContaining({ method: 'GET' }));
  });

  test('admin staging voit uniquement un lien vers le workflow, aucun POST possible',async()=>{
    const fetch=jest.fn().mockResolvedValueOnce({ok:true,json:async()=>({komerce_env:'staging'})})
      .mockResolvedValueOnce({ok:true,json:async()=>({role:'admin'})});
    const env=loadNavigation('/admin/golden-e2e','golden-e2e',{window:{fetch}});
    const group=fakeNode('div');
    expect(await require('../../public/js/golden-recipe-staging-tools.js').mountStagingAdminTools(env.document,group)).toBe(true);
    const tools=group.children[0];
    expect(tools.attributes['data-staging-tools']).toBe('true');
    expect(tools.children.some(node=>node.tagName==='BUTTON'||node.attributes['data-admin-action'])).toBe(false);
    expect(tools.children.find(node=>node.tagName==='A').href).toContain('/actions/workflows/staging-reset.yml');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.some(([,options])=>options?.method==='POST')).toBe(false);
  });
});

describe('V5.4 L3a.2 — marché fixe sans choix artificiel', () => {
  test.each(['KM','CM','CG','ZZ'])('libellé fixe issu du scope serveur : %s', code => {
    const env=loadNavigation('/admin/pilotage','pilotage');
    const ctx={actor:{id:'op',role:'market_operator'},access:{mode:'market',allowedMarkets:[code],defaultMarket:code,capabilities:[]}};
    const header=mountFor(env,'/admin/pilotage','pilotage',ctx.actor,{adminContext:ctx});
    const label=utilitiesOf(header).children[0].children[1];
    expect(label.tagName).toBe('SPAN');
    expect(label.attributes['data-fixed-market']).toBe(code);
    expect(label.listeners.change).toBeUndefined();
  });
  test('un admin global avec un seul marché garde le choix de la consolidation', () => {
    const env=loadNavigation('/admin/pilotage','pilotage');
    const ctx={actor:{id:'a',role:'admin'},access:{mode:'global',allowedMarkets:['CM'],defaultMarket:null,capabilities:[]}};
    const header=mountFor(env,'/admin/pilotage','pilotage',ctx.actor,{adminContext:ctx});
    const select=utilitiesOf(header).children[0].children[1];
    expect(select.tagName).toBe('SELECT');
    expect(select.children.map(o=>o.value)).toEqual(['','CM']);
  });
  test('un lien d’action hors scope reste sans marché sélectionné, récupération CM uniquement', () => {
    const pathname='/admin/workspaces/pricing';
    const env=loadNavigation(pathname,'pricing-workspace',{window:{location:{pathname,search:'?market=CG',href:'https://komerce.test'+pathname+'?market=CG'}}});
    const ctx={actor:{id:'op',role:'market_operator'},access:{mode:'market',allowedMarkets:['CM'],defaultMarket:'CM',capabilities:[]}};
    const header=mountFor(env,pathname,'pricing-workspace',ctx.actor,{adminContext:ctx});
    const select=utilitiesOf(header).children[0].children[1];
    expect(select.tagName).toBe('SELECT');
    expect(select.value).toBe('');
    expect(select.children.map(o=>o.value)).toEqual(['','CM']);
  });
});
