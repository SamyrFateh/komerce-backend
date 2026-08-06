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

    expect(result).toMatchObject({ key: 'ca_encaisse', value: 100000, unit: 'KMF' });
    expect(result.delta).toMatchObject({ value: 100, direction: 'up', is_comparable: true });
    expect(result.data_quality.items_total).toBe(4);
  });

  it('getCmdsCreees compte et calcule le delta si periode comparable', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ value: '10' }] })
      .mockResolvedValueOnce({ rows: [{ value: '20' }] });

    const result = await control.getCmdsCreees({ from: '2026-06-01T00:00:00.000Z', to: '2026-06-11T00:00:00.000Z' });

    expect(result.key).toBe('cmds_creees');
    expect(result.value).toBe(10);
    expect(result.delta).toMatchObject({ value: -50, direction: 'down' });
  });

  it('getCmdsActives utilise la liste canonique des statuts actifs', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ value: '7' }] });

    const result = await control.getCmdsActives({ island: 'Anjouan' });

    expect(result).toMatchObject({ key: 'cmds_actives', value: 7, unit: 'count' });
    expect(db.query.mock.calls[0][1][0]).toBe('Anjouan');
    expect(db.query.mock.calls[0][1][1]).toEqual(expect.arrayContaining(['confirmed', 'available']));
  });

  it('getColisEnTransit compte les colis transit sur statuts colis canoniques', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ value: '3' }] });

    const result = await control.getColisEnTransit();

    expect(result).toMatchObject({ key: 'colis_transit', value: 3 });
    expect(db.query.mock.calls[0][1][0]).toEqual(expect.arrayContaining(['shipped', 'in_transit', 'arrived']));
  });

  it('getAlertesCritiques applique les filtres from/to et warning si volume eleve', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ value: '11' }] });

    const result = await control.getAlertesCritiques({ from: '2026-06-01', to: '2026-06-30' });

    expect(result).toMatchObject({ key: 'alertes_critiques', value: 11 });
    expect(result.data_quality.warning).toBe('Beaucoup de signaux non resolus');
    expect(db.query.mock.calls[0][1]).toEqual(['2026-06-01', '2026-06-30']);
  });

  it('getCmdsBloquees signale les commandes payees sans stock', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ value: '2' }] });

    const result = await control.getCmdsBloquees();

    expect(result).toMatchObject({ key: 'cmds_bloquees', value: 2 });
    expect(result.data_quality.warning).toBe('2 commande(s) payée(s) sans stock');
  });

  it('getTauxCompletudeScans retourne null et provisional sans colis', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ items_total: '0', items_with_data: '0' }] });

    const result = await control.getTauxCompletudeScans();

    expect(result).toMatchObject({ key: 'taux_completude_scans', value: null, unit: '%' });
    expect(result.data_quality.completeness).toBe('provisional');
  });

  it('getTauxCompletudeCouts calcule le ratio actual/total', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ items_total: '10', items_with_data: '4' }] });

    const result = await control.getTauxCompletudeCouts({ status: 'available' });

    expect(result).toMatchObject({ key: 'taux_completude_couts', value: 40, unit: '%' });
    expect(result.data_quality.completeness).toBe('partial');
    expect(result.data_quality.warning).toBe('Beaucoup de commandes sans cout consolide');
    expect(db.query.mock.calls[0][1][0]).toBe('available');
    expect(db.query.mock.calls[0][1][1]).toEqual(expect.arrayContaining(['product_purchase', 'fixed_overhead', 'payment']));
  });
});
