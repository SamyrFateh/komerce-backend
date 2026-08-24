'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn() }));

const mockMetrics = {
  getCmdsAujourdhui: jest.fn(),
  getPaiementsEnAttente: jest.fn(),
  getColisPreparation: jest.fn(),
  getColisEnTransit: jest.fn(),
  getDisponiblesRelais: jest.fn(),
  getRetardsCritiques: jest.fn(),
  getTauxCompletudeScans: jest.fn(),
  getTauxCollecteRelais: jest.fn(),
};
jest.mock('../../services/dashboard-metrics', () => mockMetrics);

const db = require('../../db');
const operations = require('../../services/dashboard-operations');

const metric = (key, value, unit = 'count') => ({
  key, label: key, value, unit, delta: null,
  data_quality: { completeness: 'complete', items_total: null, items_with_data: null, warning: null },
  drill_to: null,
});

function seedMetrics() {
  mockMetrics.getCmdsAujourdhui.mockResolvedValue(metric('cmds_aujourdhui', 4));
  mockMetrics.getPaiementsEnAttente.mockResolvedValue(metric('paiements_en_attente', 2));
  mockMetrics.getColisPreparation.mockResolvedValue(metric('colis_preparation', 3));
  mockMetrics.getColisEnTransit.mockResolvedValue(metric('colis_transit', 5));
  mockMetrics.getDisponiblesRelais.mockResolvedValue(metric('disponibles_relais', 6));
  mockMetrics.getRetardsCritiques.mockResolvedValue(metric('retards_critiques', 1));
  mockMetrics.getTauxCompletudeScans.mockResolvedValue(metric('taux_completude_scans', 92, '%'));
  mockMetrics.getTauxCollecteRelais.mockResolvedValue(metric('taux_collecte_relais', 80, '%'));
}

function seedRows() {
  db.query
    .mockResolvedValueOnce({ rows: [{ reference: 'CMD-1', status: 'preparation', payment_status: 'paid', total_kmf: '25000', destination_island: 'Centre', relais_name: 'Relais A', parcels_count: '1', hours_since_last_event: '30', created_at: '2026-08-23T08:00:00Z' }] })
    .mockResolvedValueOnce({ rows: [{ tracking_number: 'TRK-1', status: 'in_transit', shipped_at: '2026-08-01T08:00:00Z', order_reference: 'CMD-2', relais_name: 'Relais B', days_in_transit: '23' }] })
    .mockResolvedValueOnce({ rows: [{ signal_type: 'parcel_blocked', severity: 'critical', title: 'Colis bloqué', summary: 'Bloqué depuis plusieurs jours', recommendation: 'Vérifier le suivi', owner_role: 'hub', entity_type: 'parcel', status: 'open', created_at: '2026-08-20T08:00:00Z' }] });
}

beforeEach(() => {
  jest.clearAllMocks();
  seedMetrics();
  seedRows();
});

describe('dashboard-operations', () => {
  test('la projection marché applique le market_id à toutes les sources sans exposer l’UUID', async () => {
    const market = { id: 'market-cm-id', code: 'CM', name: 'Cameroun', currency: 'XAF' };
    const result = await operations.buildOperations({ market, now: new Date('2026-08-24T12:00:00Z') });

    expect(result.scope).toEqual({ mode: 'market', market: { code: 'CM', name: 'Cameroun', currency: 'XAF' } });
    expect(JSON.stringify(result)).not.toContain('market-cm-id');
    Object.values(mockMetrics).forEach(fn => expect(fn).toHaveBeenCalledWith({ market_id: 'market-cm-id' }));

    expect(db.query).toHaveBeenCalledTimes(3);
    expect(String(db.query.mock.calls[0][0])).toContain('o.market_id =');
    expect(db.query.mock.calls[0][1]).toContain('market-cm-id');
    expect(String(db.query.mock.calls[1][0])).toContain('o.market_id =');
    expect(db.query.mock.calls[1][1]).toContain('market-cm-id');

    const [signalSql, signalParams] = db.query.mock.calls[2];
    expect(String(signalSql)).toContain("s.entity_type = 'order'");
    expect(String(signalSql)).toContain('scope_o.market_id = $2');
    expect(signalParams[1]).toBe('market-cm-id');
    expect(result.kpis).toHaveLength(8);
  });

  test('la projection globale n’invente aucun filtre marché', async () => {
    const result = await operations.buildOperations({ now: new Date('2026-08-24T12:00:00Z') });
    expect(result.scope).toEqual({ mode: 'global', market: null });
    Object.values(mockMetrics).forEach(fn => expect(fn).toHaveBeenCalledWith({}));
    db.query.mock.calls.forEach(([, params]) => expect(params).not.toContain('market-cm-id'));
    expect(String(db.query.mock.calls[2][0])).toContain('AND 1=1');
  });
});
