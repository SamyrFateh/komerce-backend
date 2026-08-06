'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../services/dashboard-metrics/control-tower', () => ({
  getCAEncaisse: jest.fn(),
}));

const db = require('../../db');
const { getCAEncaisse } = require('../../services/dashboard-metrics/control-tower');
const costing = require('../../services/dashboard-metrics/costing');

describe('dashboard-metrics/costing', () => {
  beforeEach(() => jest.clearAllMocks());

  it('getCAVendu reutilise CA encaisse et renomme le KPI', async () => {
    getCAEncaisse.mockResolvedValueOnce({ key: 'ca_encaisse', label: 'CA encaissé', value: 12000, unit: 'KMF' });

    await expect(costing.getCAVendu({ from: '2026-06-01' })).resolves.toEqual({
      key: 'ca_vendu', label: 'CA vendu', value: 12000, unit: 'KMF',
    });
    expect(getCAEncaisse).toHaveBeenCalledWith({ from: '2026-06-01' });
  });

  it('getCoutEstime retourne un KPI complet quand toutes les commandes ont un snapshot', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ value: '50000', items_with_data: '2', items_total: '2' }] });

    const result = await costing.getCoutEstime({ island: 'Anjouan' });

    expect(result).toMatchObject({ key: 'cout_estime', label: 'Coût estimé', value: 50000, unit: 'KMF' });
    expect(result.data_quality).toMatchObject({ completeness: 'complete', items_total: 2, items_with_data: 2, warning: null });
    expect(db.query.mock.calls[0][1]).toEqual(['Anjouan']);
  });

  it('getCoutReel marque provisional sans commande', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ value: '0', items_with_data: '0', items_total: '0' }] });

    const result = await costing.getCoutReel();

    expect(result.value).toBe(0);
    expect(result.data_quality.completeness).toBe('provisional');
  });

  it('getMargeEstimee calcule marge et pourcentage sans division par zero', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ margin_kmf: '25000', revenue_kmf: '100000', items_with_data: '2', items_total: '3' }] });

    const result = await costing.getMargeEstimee();

    expect(result).toMatchObject({ key: 'marge_estimee', value: 25000, unit: 'KMF' });
    expect(result.data_quality.warning).toBe('25% sur 2/3 cmds');
  });

  it('getMargeVariableReelle passe les couts variables attendus en parametre', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ margin_kmf: '30000', revenue_kmf: '100000', items_with_data: '1', items_total: '2' }] });

    const result = await costing.getMargeVariableReelle({ status: 'available' });

    expect(result.key).toBe('marge_variable_reelle');
    expect(result.data_quality.completeness).toBe('partial');
    expect(db.query.mock.calls[0][1][0]).toBe('available');
    expect(db.query.mock.calls[0][1][1]).toEqual(expect.arrayContaining(['product_purchase', 'freight', 'customs']));
  });

  it('getMargeConsolidee exige tous les couts attendus', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ margin_kmf: '42000', revenue_kmf: '100000', items_with_data: '2', items_total: '2' }] });

    const result = await costing.getMargeConsolidee();

    expect(result.key).toBe('marge_consolidee');
    expect(result.data_quality.completeness).toBe('complete');
    expect(db.query.mock.calls[0][1][0]).toEqual(expect.arrayContaining(['product_purchase', 'fixed_overhead', 'payment']));
  });

  it('getCmdsCoutIncompletCount produit drilldown et warning si valeur > 0', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ value: '4' }] });

    const result = await costing.getCmdsCoutIncompletCount();

    expect(result).toMatchObject({ key: 'cmds_cout_incomplet', value: 4, unit: 'count', drill_to: '/admin/costing?cost_status=incomplete,partial_real,estimated' });
    expect(result.data_quality.warning).toBe('Cliquer pour voir le detail');
  });

  it('getCmdsCoutIncompletIds borne la limite a 1000', async () => {
    const rows = [{ id: 'order-001' }];
    db.query.mockResolvedValueOnce({ rows });

    await expect(costing.getCmdsCoutIncompletIds({ relais_id: 'r1' }, { limit: 5000 })).resolves.toBe(rows);
    expect(db.query.mock.calls[0][1][0]).toBe('r1');
    expect(db.query.mock.calls[0][1].at(-1)).toBe(1000);
  });

  it('getCoutMoyParCmd retourne provisional si aucune commande payee', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ value: '0', items_total: '0' }] });

    const result = await costing.getCoutMoyParCmd();

    expect(result).toMatchObject({ key: 'cout_moy_par_cmd', value: 0 });
    expect(result.data_quality.completeness).toBe('provisional');
  });
});
