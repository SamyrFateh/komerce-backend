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
  require('../../public/dashboards/canonical/js/navigation.js');
  require('../../public/dashboards/canonical/js/navigation-policy-v3.js');
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

