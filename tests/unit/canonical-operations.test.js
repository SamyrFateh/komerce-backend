'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const schemaContract = require('../../public/dashboards/canonical/js/dashboard-schema');
const adminContextContract = require('../../public/dashboards/canonical/js/admin-context');
const operations = require('../../public/dashboards/canonical/js/operations');

function payloadFixture() {
  return {
    kpis: [
      { key: 'cmds_aujourdhui', value: 4, unit: 'count', data_quality: {} },
      { key: 'paiements_en_attente', value: 2, unit: 'count', data_quality: {} },
      { key: 'colis_preparation', value: 3, unit: 'count', data_quality: {} },
      { key: 'colis_transit', value: 5, unit: 'count', data_quality: {} },
      { key: 'disponibles_relais', value: 6, unit: 'count', data_quality: {} },
      { key: 'retards_critiques', value: 1, unit: 'count', data_quality: { warning: '1 retard' } },
      { key: 'taux_completude_scans', value: 92, unit: '%', data_quality: {} },
      { key: 'taux_collecte_relais', value: 80, unit: '%', data_quality: {} },
    ],
    active_orders: [{
      reference: 'CMD-1', status: 'preparation', payment_status: 'paid', relais_name: 'Relais A',
      destination_island: 'Centre', parcels_count: 1, hours_since_last_event: 30,
    }],
    critical_delays: [{
      tracking_number: 'TRK-1', order_reference: 'CMD-2', status: 'in_transit', relais_name: 'Relais B', days_in_transit: 23,
    }],
    signals: [{
      signal_type: 'parcel_blocked', severity: 'critical', title: 'Colis bloqué',
      summary: 'Bloqué depuis plusieurs jours', recommendation: 'Vérifier le suivi',
    }],
  };
}

function globalContext() {
  return {
    actor: { id: 'hq-admin', role: 'admin' },
    access: { mode: 'global', allowedMarkets: ['CM', 'CG'], defaultMarket: null, capabilities: ['dashboard.global.read'] },
  };
}

function marketContext() {
  return {
    actor: { id: 'operator-cm', role: 'admin' },
    access: { mode: 'market', allowedMarkets: ['CM'], defaultMarket: 'CM', capabilities: ['dashboard.market.read'] },
  };
}

describe('LOT 2E-CANON — Operations vivant', () => {
  test('le schéma Operations respecte DashboardSchema', () => {
    const schema = schemaContract.validateDashboardSchema(operations.OPERATIONS_SCHEMA);
    expect(schema.id).toBe('operations');
    expect(schema.metrics.source).toBe('operations.metrics');
    expect(schema.alerts.source).toBe('operations.signals');
    expect(schema.sections.map(section => section.source)).toEqual([
      'operations.active-orders',
      'operations.critical-delays',
    ]);
  });

  test('projette les données backend sans recalcul métier', () => {
    const sources = operations.resolveSources(payloadFixture());
    expect(sources['operations.metrics']['retards-critiques']).toEqual(expect.objectContaining({ value: '1', tone: 'critical' }));
    expect(sources['operations.active-orders'][0]).toEqual(expect.objectContaining({ reference: 'CMD-1', attente: '30 h' }));
    expect(sources['operations.critical-delays'][0]).toEqual(expect.objectContaining({ tracking: 'TRK-1', transit: '23 j' }));
    expect(sources['operations.signals'][0]).toEqual({
      level: 'critical',
      title: 'Colis bloqué',
      message: 'Bloqué depuis plusieurs jours · Vérifier le suivi',
    });
  });

  test('résout la source uniquement depuis AdminContext', () => {
    expect(operations.endpointForContext(globalContext(), adminContextContract))
      .toBe('/api/admin/dashboard/operations');
    expect(operations.endpointForContext(marketContext(), adminContextContract))
      .toBe('/api/admin/dashboard/operations/market/CM');
    expect(operations.endpointForContext(globalContext(), adminContextContract, 'CG'))
      .toBe('/api/admin/dashboard/operations/market/CG');
    expect(() => operations.endpointForContext(marketContext(), adminContextContract, 'CG'))
      .toThrow(/autorisés par le serveur/);
  });

  test('mount marché charge directement Operations CM', async () => {
    const root = {};
    const render = jest.fn();
    const renderer = { createRenderer: jest.fn(() => ({ render })) };
    const fetch = jest.fn().mockResolvedValue({ ok: true, json: jest.fn().mockResolvedValue(payloadFixture()) });

    const result = await operations.mount({
      root,
      document: {},
      ui: {},
      fetch,
      renderer,
      adminContext: marketContext(),
      contextContract: adminContextContract,
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/api/admin/dashboard/operations/market/CM', expect.objectContaining({ method: 'GET', credentials: 'include' }));
    expect(result.endpoint).toBe('/api/admin/dashboard/operations/market/CM');
    expect(render).toHaveBeenNthCalledWith(1, root, operations.OPERATIONS_SCHEMA, expect.objectContaining({ state: 'loading' }));
    expect(render).toHaveBeenNthCalledWith(2, root, operations.OPERATIONS_SCHEMA, expect.objectContaining({
      data: expect.objectContaining({ 'operations.metrics': expect.any(Object) }),
    }));
  });
});
