'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * GAP 3 / LOT A (A2) : la tab N2 'clients' (LOCAL_TABS.orders) porte une
 * capability DELEGATION ('client.read'). Un market_operator ne doit la voir
 * que si adminContext.access.delegatedCapabilities[defaultMarket] la
 * contient réellement — jamais par simple appartenance de rôle.
 */

const path = require('path');

function loadPolicy() {
  jest.resetModules();
  delete global.KomerceCanonicalNavigation;
  delete global.window;
  delete global.document;
  require('../../public/dashboards/canonical/js/navigation-policy-v4.js');
  return global.KomerceCanonicalNavigation;
}

afterEach(() => {
  delete global.KomerceCanonicalNavigation;
  delete global.window;
  delete global.document;
});

function marketAdminContext(delegated) {
  return {
    access: {
      mode: 'market',
      allowedMarkets: ['CM'],
      defaultMarket: 'CM',
      capabilities: ['pilotage.read', 'dashboard.market.read'],
      delegatedCapabilities: { CM: delegated },
    },
  };
}

describe('navigation-policy-v4 — capability gate (A2)', () => {
  test('market_operator sans client.read délégué ne voit pas la tab Clients', () => {
    const nav = loadPolicy();
    const tabs = nav._localTabsFor('orders', { role: 'market_operator' }, marketAdminContext([]));
    expect(tabs.map(t => t.id)).not.toContain('clients');
  });

  test('market_operator avec client.read délégué sur son marché voit la tab Clients', () => {
    const nav = loadPolicy();
    const tabs = nav._localTabsFor('orders', { role: 'market_operator' }, marketAdminContext(['client.read']));
    expect(tabs.map(t => t.id)).toContain('clients');
  });

  test('admin scoped market sans adminContext résolu garde le comportement role-only (pas de régression)', () => {
    const nav = loadPolicy();
    const tabs = nav._localTabsFor('orders', { role: 'admin' }, null);
    expect(tabs.map(t => t.id)).toContain('clients');
  });

  test('admin en mode global voit toujours la tab Clients, quelle que soit la projection délégation', () => {
    const nav = loadPolicy();
    const globalContext = {
      access: {
        mode: 'global',
        allowedMarkets: ['CM', 'KM'],
        defaultMarket: null,
        capabilities: ['pilotage.read', 'dashboard.market.read', 'dashboard.global.read'],
        delegatedCapabilities: {},
      },
    };
    const tabs = nav._localTabsFor('orders', { role: 'admin' }, globalContext);
    expect(tabs.map(t => t.id)).toContain('clients');
  });

  test('client.read délégué sur un autre marché que le defaultMarket ne compte pas', () => {
    const nav = loadPolicy();
    const context = {
      access: {
        mode: 'market',
        allowedMarkets: ['CM'],
        defaultMarket: 'CM',
        capabilities: ['pilotage.read', 'dashboard.market.read'],
        delegatedCapabilities: { KM: ['client.read'] },
      },
    };
    const tabs = nav._localTabsFor('orders', { role: 'market_operator' }, context);
    expect(tabs.map(t => t.id)).not.toContain('clients');
  });
});

describe('navigation-policy-v4 — domaine Live (coque noire des cockpits opérationnels)', () => {
  test('Sourcing live appartient au domaine Live, pas à Opérations', () => {
    const nav = loadPolicy();
    expect(nav.activePrimarySurface('import-runtime')).toBe('live');
    const operationsTabs = nav._localTabsFor('operations', { role: 'admin' }, null).map(t => t.id);
    expect(operationsTabs).not.toContain('import-runtime');
    expect(nav._localTabsFor('live', { role: 'admin' }, null).map(t => t.id)).toEqual(['import-runtime', 'hub-live', 'relais-live']);
    expect(nav.activePrimarySurface('hub-live')).toBe('live');
  });

  test('Live : admin, sourcing, agent_hub et agent_relais pour leur seul cockpit', () => {
    const nav = loadPolicy();
    expect(nav._localTabsFor('live', { role: 'sourcing' }, null).map(t => t.id)).toEqual(['import-runtime']);
    expect(nav._localTabsFor('live', { role: 'agent_hub' }, null).map(t => t.id)).toEqual(['hub-live']);
    expect(nav._localTabsFor('live', { role: 'agent_relais' }, null).map(t => t.id)).toEqual(['relais-live']);
    for (const role of ['agent_transitaire', 'finance', 'market_operator', 'support']) {
      expect(nav._localTabsFor('live', { role }, null)).toEqual([]);
    }
  });

  test('le shell active body.kmc-shell-live uniquement pour le domaine Live', () => {
    const source = require('fs').readFileSync(path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical', 'js', 'navigation-policy-v4.js'), 'utf8');
    expect(source).toContain("classList?.toggle?.('kmc-shell-live', domainId === 'live')");
    expect(source).toContain("live: '◉'");
  });
});



describe('navigation-policy-v4 — grouped sidebar information architecture', () => {
  test('admin sees domain groups (Commerce / Opérations / Finance) with existing destinations only', () => {
    const nav = loadPolicy();
    const groups = nav.sidebarGroupsFor({ role: 'admin' }, null);
    expect(groups.map(group => group.id)).toEqual([
      'pilot', 'commerce', 'operations', 'finance', 'live', 'markets', 'administration',
    ]);
    const labels = id => groups.find(group => group.id === id).items.map(item => item.label);
    expect(labels('pilot')).toEqual(['Tour de contrôle', 'À traiter']);
    expect(labels('commerce')).toEqual(['Vue commerce', 'Commandes', 'Clients', 'Prix & économie', 'Catalogue']);
    expect(labels('operations')).toEqual(['Vue opérations', 'Hub & Relais', 'Expéditions & Douane', 'Sourcing', 'Achats fournisseurs']);
    expect(labels('finance')).toEqual(['Vue finance', 'Comptabilité']);
    expect(groups.find(group => group.id === 'live').items.map(item => item.href))
      .toEqual(['/admin/import-runtime', '/admin/hub-live', '/admin/relais-live']);
    expect(labels('markets')).toEqual(['Responsables pays']);
    const all = groups.flatMap(group => group.items);
    expect(all.some(item => item.href === '/admin/suppliers')).toBe(false);
    // « Produits » n'est plus une entrée de menu : onglet local du Catalogue uniquement.
    expect(all.some(item => item.id === 'entity-products')).toBe(false);
    expect(all.filter(item => item.id === 'settings')).toHaveLength(1);
  });

  test('chaque entrée de menu d’un market_operator déclare la capability serveur qui la protège', () => {
    const nav = loadPolicy();
    const expected = {
      'control-tower': 'dashboard.market.read',
      'action-center': 'decision_signal.manage',
      'flow-commerce': 'dashboard.market.read',
      'entity-orders': 'dashboard.market.read',
      'entity-clients': 'client.read',
      'workspace-pricing': 'pricing.read',
      'flow-operations': 'operations.read',
      'workspace-operations': 'operations.read',
      'workspace-shipping': 'operations.read',
      'flow-finance': 'finance.read',
      'workspace-accounting': 'finance.read',
    };
    const items = nav.sidebarGroupsFor({ role: 'market_operator' }, null).flatMap(group => group.items);
    items.filter(item => expected[item.id]).forEach(item => {
      expect([item.id, item.capability]).toEqual([item.id, expected[item.id]]);
    });
    expect(items.map(item => item.id)).toEqual(expect.arrayContaining(Object.keys(expected)));
  });

  test('un market_operator sans capability déléguée ne voit que les entrées sans capability', () => {
    const nav = loadPolicy();
    const none = nav.sidebarGroupsFor({ role: 'market_operator' }, marketAdminContext([]))
      .flatMap(group => group.items.map(item => item.id));
    expect(none).toEqual(expect.arrayContaining(['market-autonomy', 'market-catalog']));
    ['control-tower', 'flow-finance', 'flow-operations', 'entity-clients', 'workspace-pricing', 'workspace-accounting']
      .forEach(id => expect(none).not.toContain(id));

    const finance = nav.sidebarGroupsFor({ role: 'market_operator' }, marketAdminContext(['finance.read']))
      .flatMap(group => group.items.map(item => item.id));
    expect(finance).toEqual(expect.arrayContaining(['flow-finance', 'workspace-accounting']));
    expect(finance).not.toContain('flow-operations');
  });

  test('client entity remains capability-gated for a market operator', () => {
    const nav = loadPolicy();
    const ids = ctx => nav.sidebarGroupsFor({ role: 'market_operator' }, ctx).flatMap(group => group.items.map(item => item.id));
    expect(ids(marketAdminContext([]))).not.toContain('entity-clients');
    expect(ids(marketAdminContext(['client.read']))).toContain('entity-clients');
  });

  test('field roles stay limited to their server-authorized workspace destinations', () => {
    const nav = loadPolicy();
    const transitaire = nav.sidebarGroupsFor({ role: 'agent_transitaire' }, null);
    // Les agents voient l'Action Center canonique filtré par le serveur (périmètre + actions autorisées) et leur workspace.
    expect(transitaire.map(group => group.id)).toEqual(['pilot', 'operations']);
    expect(transitaire[0].items.map(item => item.id)).toEqual(['action-center']);
    expect(transitaire[1].items.map(item => item.id)).toEqual(['workspace-shipping']);

    // Les cockpits Live restent accessibles depuis la sidebar, chacun à son seul rôle.
    const ids = role => nav.sidebarGroupsFor({ role }, null).flatMap(group => group.items.map(item => item.id));
    expect(ids('agent_hub')).toContain('live-hub');
    expect(ids('agent_hub')).not.toContain('live-relais');
    expect(ids('agent_relais')).toContain('live-relais');
    expect(ids('agent_transitaire').filter(id => id.startsWith('live-'))).toEqual([]);
    expect(ids('sourcing').filter(id => id.startsWith('live-'))).toEqual(['live-import-runtime']);

    const finance = nav.sidebarGroupsFor({ role: 'finance' }, null);
    expect(finance.map(group => group.id)).toEqual(['finance']);
    expect(finance[0].items.map(item => item.id)).toEqual(['workspace-accounting']);
  });
});

describe('navigation-policy-v4 — canonical reference search', () => {
  function fakeDoc() {
    return {
      createElement(tag) {
        return {
          tagName: tag.toUpperCase(),
          attributes: {},
          children: [],
          setAttribute(key, val) { this.attributes[key] = val; },
          appendChild(node) { this.children.push(node); return node; },
          replaceChildren(...nodes) { this.children = nodes; },
        };
      },
    };
  }

  test('uses the read-only server resolver, never infers an owner from a prefix', () => {
    const nav = loadPolicy();
    expect(nav.REFERENCE_SEARCH_ENDPOINT).toBe('/api/admin/dashboard/reference/resolve');
    expect(nav.safeCanonicalHref('/admin/orders/CMD-1')).toBe('/admin/orders/CMD-1');
    expect(nav.safeCanonicalHref('/admin/workspaces/purchasing?po=123')).toBe('/admin/workspaces/purchasing?po=123');
    expect(nav.safeCanonicalHref('https://evil.example/path')).toBeNull();
    expect(nav.safeCanonicalHref('//evil.example/path')).toBeNull();
    expect(nav.safeCanonicalHref('/dashboards/legacy')).toBeNull();
  });

  test('renders all ambiguous matches and opens each server-supplied canonical destination', () => {
    const nav = loadPolicy();
    const doc = fakeDoc();
    const host = doc.createElement('div');
    nav.renderReferenceResults(doc, host, {
      found: true,
      ambiguous: true,
      matches: [
        { entity_type: 'PURCHASE_ORDER', matched_reference: 'PO-42', customer_order_reference: 'CMD-1', market_code: 'KM', current_position: { stage: 'PURCHASING', health: 'RED' }, canonical_href: '/admin/workspaces/purchasing?po=42' },
        { entity_type: 'PURCHASE_ORDER', matched_reference: 'PO-42', customer_order_reference: 'CMD-2', market_code: 'KM', current_position: { stage: 'SUPPLIER', health: 'GREEN' }, canonical_href: '/admin/orders/CMD-2' },
      ],
    });
    expect(host.children).toHaveLength(2);
    expect(host.children.map(item => item.attributes.href)).toEqual([
      '/admin/workspaces/purchasing?po=42',
      '/admin/orders/CMD-2',
    ]);
    expect(host.children[0].children[1].textContent).toContain('PURCHASING');
  });

  test('renders canonical orphans as explicit non-clickable lineage anomalies', () => {
    const nav = loadPolicy();
    const doc = fakeDoc();
    const host = doc.createElement('div');
    nav.renderReferenceResults(doc, host, {
      found: true,
      orphaned: true,
      matches: [],
      orphans: [{
        entity_type: 'PURCHASE_ORDER',
        matched_reference: 'PO-ORPHAN',
        canonical_id: 'po-orphan',
        canonical_owner: 'purchasing',
        reason: 'missing_customer_order_lineage',
      }],
    });

    expect(host.children).toHaveLength(1);
    expect(host.children[0].tagName).toBe('DIV');
    expect(host.children[0].attributes.href).toBeUndefined();
    expect(host.children[0].children[0].textContent).toMatch(/Référence orpheline/);
    expect(host.children[0].children[1].textContent).toMatch(/Owner purchasing/);
    expect(host.children[0].children[1].textContent).toMatch(/Rattachement à une commande introuvable/);
  });

  test('empty and invalid destinations never generate unsafe links', () => {
    const nav = loadPolicy();
    const doc = fakeDoc();
    const host = doc.createElement('div');
    nav.renderReferenceResults(doc, host, { found: false, matches: [] });
    expect(host.children[0].textContent).toMatch(/Aucune référence/);
    nav.renderReferenceResults(doc, host, {
      matches: [{ entity_type: 'PARCEL', matched_reference: 'P-1', canonical_href: 'https://evil.example' }],
    });
    expect(host.children[0].tagName).toBe('DIV');
    expect(host.children[0].attributes.href).toBeUndefined();
  });
});
