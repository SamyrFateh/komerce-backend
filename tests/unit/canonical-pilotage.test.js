/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

'use strict';

const schemaContract = require('../../public/dashboards/canonical/js/dashboard-schema');
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
      { level: 'urgent', source: 'orders', message: 'Deux commandes bloquées' },
    ],
    view_blocks: [
      {
        title: 'Tour de contrôle',
        subtitle: 'Voir, comprendre, décider',
        kpis_summary: [{ label: 'CA encaissé' }, { label: 'Commandes actives' }],
      },
    ],
    economic_flow: {
      stages: [{ label: 'Commande', url: '/admin/orders-logistics' }],
    },
  };
}

describe('LOT 2C-CANON — Pilotage vivant', () => {
  test('le schéma Pilotage respecte DashboardSchema V1', () => {
    const schema = schemaContract.validateDashboardSchema(pilotage.PILOTAGE_SCHEMA);
    expect(schema.id).toBe('pilotage');
    expect(schema.metrics.source).toBe('pilotage.metrics');
    expect(schema.sections.map(section => section.source)).toEqual(['pilotage.views', 'pilotage.flow']);
  });

  test('projette /unified sans recalcul métier', () => {
    const sources = pilotage.resolveSources(payloadFixture());

    expect(sources['pilotage.metrics']['ca-encaisse'].value).toContain('KMF');
    expect(sources['pilotage.metrics']['marge-consolidee'].tone).toBe('warning');
    expect(sources['pilotage.metrics']['alertes-critiques'].tone).toBe('critical');
    expect(sources['pilotage.alerts'][0]).toEqual(expect.objectContaining({
      level: 'critical',
      title: 'orders',
      message: 'Deux commandes bloquées',
    }));
    expect(sources['pilotage.views'][0]).toEqual({
      vue: 'Tour de contrôle',
      mission: 'Voir, comprendre, décider',
      indicateurs: 'CA encaissé · Commandes actives',
    });
    expect(sources['pilotage.flow'][0]).toEqual({
      etape: 'Commande',
      destination: '/admin/orders-logistics',
    });
  });

  test('mount charge la source canonique puis rend le dashboard', async () => {
    const render = jest.fn();
    const renderer = { createRenderer: jest.fn(() => ({ render })) };
    const fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(payloadFixture()),
    });

    await pilotage.mount({ root: {}, document: {}, ui: {}, fetch, renderer });

    expect(fetch).toHaveBeenCalledWith('/api/admin/dashboard/unified', expect.objectContaining({
      method: 'GET',
      credentials: 'include',
    }));
    expect(render).toHaveBeenNthCalledWith(1, {}, pilotage.PILOTAGE_SCHEMA, expect.objectContaining({ state: 'loading' }));
    expect(render).toHaveBeenNthCalledWith(2, {}, pilotage.PILOTAGE_SCHEMA, expect.objectContaining({
      data: expect.objectContaining({ 'pilotage.metrics': expect.any(Object) }),
    }));
  });

  test('mount rend l’état erreur si /unified échoue', async () => {
    const render = jest.fn();
    const renderer = { createRenderer: jest.fn(() => ({ render })) };
    const fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: jest.fn().mockResolvedValue({ error: 'dashboard indisponible' }),
    });

    await expect(pilotage.mount({ root: {}, document: {}, ui: {}, fetch, renderer }))
      .rejects.toThrow('dashboard indisponible');

    expect(render).toHaveBeenLastCalledWith({}, pilotage.PILOTAGE_SCHEMA, expect.objectContaining({
      state: 'error',
      stateMessage: 'dashboard indisponible',
    }));
  });
});
