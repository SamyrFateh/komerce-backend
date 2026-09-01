/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

'use strict';

const schemaContract = require('../../public/dashboards/canonical/js/dashboard-schema');
const adminContextContract = require('../../public/dashboards/canonical/js/admin-context');
const pilotage = require('../../public/dashboards/canonical/js/pilotage');

function payloadFixture() {
  return {
    kpis_global: [
      { key: 'ca_encaisse', value: 1250000, unit: 'KMF', data_quality: {} },
      { key: 'cmds_actives', value: 12, unit: 'count', data_quality: {} },
      { key: 'marge_consolidee', value: 18.5, unit: '%', data_quality: { warning: 'Données partielles' } },
      { key: 'alertes_critiques', value: 2, unit: 'count', data_quality: {} },
      { key: 'taux_completude_couts', value: 75, unit: '%', data_quality: {} },
    ],
    system_alerts: [
      {
        level: 'urgent',
        source: 'orders',
        message: 'Deux commandes bloquées',
        action_url: '/admin/alerts?severity=critical',
        action_label: 'Voir les alertes',
      },
    ],
    view_blocks: [
      {
        title: 'Tour de contrôle',
        subtitle: 'Voir, comprendre, décider',
        kpis_summary: [{ label: 'CA encaissé' }, { label: 'Commandes actives' }],
      },
    ],
    economic_flow: {
      stages: [{ key: 'order', label: 'Commande', url: '/admin/orders-logistics' }],
    },
  };
}

function globalContext() {
  return {
    actor: { id: 'hq-admin', role: 'admin' },
    access: {
      mode: 'global',
      allowedMarkets: ['CM', 'CG', 'KM'],
      defaultMarket: null,
      capabilities: ['pilotage.read', 'dashboard.market.read', 'dashboard.global.read'],
    },
  };
}

function marketContext() {
  return {
    actor: { id: 'operator-cm', role: 'admin' },
    access: {
      mode: 'market',
      allowedMarkets: ['CM'],
      defaultMarket: 'CM',
      capabilities: ['pilotage.read', 'dashboard.market.read'],
    },
  };
}

describe('LOT 2C-CANON — Pilotage vivant', () => {
  test('le schéma Pilotage respecte DashboardSchema V1', () => {
    const schema = schemaContract.validateDashboardSchema(pilotage.PILOTAGE_SCHEMA);
    expect(schema.id).toBe('pilotage');
    expect(schema.metrics.source).toBe('pilotage.metrics');
    expect(schema.sections.map(section => section.source)).toEqual(['pilotage.views', 'pilotage.flow']);
    expect(schema.sections[1].columns[1].label).toBe('Destination');
  });

  test('normalise seulement les anciennes destinations déjà cutover', () => {
    expect(pilotage.canonicalAdminHref('/admin/orders-logistics?status=active'))
      .toBe('/admin/operations?status=active');
    expect(pilotage.canonicalAdminHref('/admin/pricing-strategy'))
      .toBe('/admin/workspaces/pricing');
    expect(pilotage.canonicalAdminHref('/admin/alerts?severity=critical'))
      .toBe('/admin/action-center?severity=critical');
    expect(pilotage.canonicalAdminHref('/admin/control-tower'))
      .toBe('/admin/pilotage');
    expect(pilotage.canonicalAdminHref('/admin/costing?cost_status=actual'))
      .toBe('/admin/costing?cost_status=actual');
    expect(pilotage.canonicalAdminHref('/admin/products/PRD-42'))
      .toBe('/admin/products/PRD-42');
  });

  test('projette /unified sans recalcul métier ni URL legacy brute dans la chaîne économique', () => {
    const sources = pilotage.resolveSources(payloadFixture());

    expect(sources['pilotage.metrics']['ca-encaisse'].value).toContain('KMF');
    expect(sources['pilotage.metrics']['marge-consolidee'].tone).toBe('warning');
    expect(sources['pilotage.metrics']['alertes-critiques'].tone).toBe('critical');
    expect(sources['pilotage.alerts'][0]).toEqual(expect.objectContaining({
      level: 'critical',
      title: 'orders',
      message: 'Deux commandes bloquées',
      href: '/admin/action-center?severity=critical',
      actionLabel: 'Voir les alertes',
    }));
    expect(sources['pilotage.views'][0]).toEqual({
      vue: 'Tour de contrôle',
      mission: 'Voir, comprendre, décider',
      indicateurs: 'CA encaissé · Commandes actives',
    });
    expect(sources['pilotage.flow'][0]).toEqual({
      etape: 'Commande',
      destination: 'Opérations',
    });
  });

  test('l’endpoint est résolu uniquement depuis AdminContext validé', () => {
    expect(pilotage.endpointForContext(globalContext(), adminContextContract))
      .toBe('/api/admin/dashboard/unified');
    expect(pilotage.endpointForContext(marketContext(), adminContextContract))
      .toBe('/api/admin/dashboard/unified/market/CM');
    expect(pilotage.endpointForContext(globalContext(), adminContextContract, 'CG'))
      .toBe('/api/admin/dashboard/unified/market/CG');
    expect(() => pilotage.endpointForContext(marketContext(), adminContextContract, 'CG'))
      .toThrow(/autorisés par le serveur/);
  });

  test('mount global charge la source globale autorisée puis rend le dashboard', async () => {
    const root = {};
    const render = jest.fn();
    const renderer = { createRenderer: jest.fn(() => ({ render })) };
    const fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(payloadFixture()),
    });

    const result = await pilotage.mount({
      root,
      document: {},
      ui: {},
      fetch,
      renderer,
      adminContext: globalContext(),
      contextContract: adminContextContract,
    });

    expect(fetch).toHaveBeenCalledWith('/api/admin/dashboard/unified', expect.objectContaining({
      method: 'GET',
      credentials: 'include',
    }));
    expect(result.endpoint).toBe('/api/admin/dashboard/unified');
    expect(root.className).toBe('');
    expect(render).toHaveBeenNthCalledWith(1, root, pilotage.PILOTAGE_SCHEMA, expect.objectContaining({ state: 'loading' }));
    expect(render).toHaveBeenNthCalledWith(2, root, pilotage.PILOTAGE_SCHEMA, expect.objectContaining({
      data: expect.objectContaining({ 'pilotage.metrics': expect.any(Object) }),
    }));
  });

  test('mount market ne charge jamais l’agrégat global puis filtre côté client', async () => {
    const root = {};
    const render = jest.fn();
    const renderer = { createRenderer: jest.fn(() => ({ render })) };
    const fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(payloadFixture()),
    });

    const result = await pilotage.mount({
      root,
      document: {},
      ui: {},
      fetch,
      renderer,
      adminContext: marketContext(),
      contextContract: adminContextContract,
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/api/admin/dashboard/unified/market/CM', expect.any(Object));
    expect(result.endpoint).toBe('/api/admin/dashboard/unified/market/CM');
  });

  test('mount rend l’état erreur si la source autorisée échoue', async () => {
    const root = {};
    const render = jest.fn();
    const renderer = { createRenderer: jest.fn(() => ({ render })) };
    const fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: jest.fn().mockResolvedValue({ error: 'dashboard indisponible' }),
    });

    await expect(pilotage.mount({
      root,
      document: {},
      ui: {},
      fetch,
      renderer,
      adminContext: globalContext(),
      contextContract: adminContextContract,
    })).rejects.toThrow('dashboard indisponible');

    expect(root.className).toBe('');
    expect(render).toHaveBeenLastCalledWith(root, pilotage.PILOTAGE_SCHEMA, expect.objectContaining({
      state: 'error',
      stateMessage: 'dashboard indisponible',
    }));
  });
});
