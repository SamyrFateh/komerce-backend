'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../db', () => ({ query: jest.fn() }));

const db = require('../../db');
const control = require('../../services/dashboard-metrics/control-tower');

describe('dashboard-metrics/control-tower', () => {
  beforeEach(() => jest.clearAllMocks());

  it('getCAEncaisse retourne le CA et le delta periode precedente', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ value: '100000', items_total: '4' }] })
      .mockResolvedValueOnce({ rows: [{ value: '50000' }] });

    const result = await control.getCAEncaisse({ from: '2026-06-01T00:00:00.000Z', to: '2026-06-30T00:00:00.000Z' });

    expect(result).toMatchObject({ key: 'ca_encaisse', value: 100000, unit: 'KMF', drill_to: '/admin/costing' });
    expect(result.delta).toMatchObject({ value: 100, direction: 'up', is_comparable: true });
    expect(result.data_quality.items_total).toBe(4);
  });

  it('getCmdsCreees compte, calcule le delta et drill vers Operations', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ value: '10' }] })
      .mockResolvedValueOnce({ rows: [{ value: '20' }] });

    const result = await control.getCmdsCreees({ from: '2026-06-01T00:00:00.000Z', to: '2026-06-11T00:00:00.000Z' });

    expect(result).toMatchObject({ key: 'cmds_creees', value: 10, drill_to: '/admin/operations' });
    expect(result.delta).toMatchObject({ value: -50, direction: 'down' });
  });

  it('getCmdsActives utilise la liste canonique des statuts actifs et drill vers Operations', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ value: '7' }] });

    const result = await control.getCmdsActives({ island: 'Anjouan' });

    expect(result).toMatchObject({ key: 'cmds_actives', value: 7, unit: 'count', drill_to: '/admin/operations?status=active' });
    expect(db.query.mock.calls[0][1][0]).toBe('Anjouan');
    expect(db.query.mock.calls[0][1][1]).toEqual(expect.arrayContaining(['confirmed', 'available']));
  });

  it('getColisEnTransit compte les colis transit et drill vers Operations', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ value: '3' }] });

    const result = await control.getColisEnTransit();

    expect(result).toMatchObject({ key: 'colis_transit', value: 3, drill_to: '/admin/operations?parcel_status=in_transit' });
    expect(db.query.mock.calls[0][1][0]).toEqual(expect.arrayContaining(['shipped', 'in_transit', 'arrived']));
  });

  it('getAlertesCritiques applique les filtres et drill vers Action Center', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ value: '11' }] });

    const result = await control.getAlertesCritiques({ from: '2026-06-01', to: '2026-06-30' });

    expect(result).toMatchObject({ key: 'alertes_critiques', value: 11, drill_to: '/admin/action-center?severity=critical' });
    expect(result.data_quality.warning).toBe('Beaucoup de signaux non resolus');
    expect(db.query.mock.calls[0][1]).toEqual(['2026-06-01', '2026-06-30']);
  });

  it('getCmdsBloquees signale les commandes payees sans stock et drill vers Operations', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ value: '2' }] });

    const result = await control.getCmdsBloquees();

    expect(result).toMatchObject({ key: 'cmds_bloquees', value: 2, drill_to: '/admin/operations?anomalie=stock_blocked' });
    expect(result.data_quality.warning).toBe('2 commande(s) payée(s) sans stock');
  });

  it('getTauxCompletudeScans retourne null et provisional sans colis', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ items_total: '0', items_with_data: '0' }] });

    const result = await control.getTauxCompletudeScans();

    expect(result).toMatchObject({ key: 'taux_completude_scans', value: null, unit: '%' });
    expect(result.data_quality.completeness).toBe('provisional');
  });

  it('getTauxCompletudeCouts calcule le ratio actual/total et garde le drill Costing tant que Finance est incomplet', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ items_total: '10', items_with_data: '4' }] });

    const result = await control.getTauxCompletudeCouts({ status: 'available' });

    expect(result).toMatchObject({ key: 'taux_completude_couts', value: 40, unit: '%', drill_to: '/admin/costing?cost_status=incomplete' });
    expect(result.data_quality.completeness).toBe('partial');
    expect(result.data_quality.warning).toBe('Beaucoup de commandes sans cout consolide');
    expect(db.query.mock.calls[0][1][0]).toBe('available');
    expect(db.query.mock.calls[0][1][1]).toEqual(expect.arrayContaining(['product_purchase', 'fixed_overhead', 'payment']));
  });
});
