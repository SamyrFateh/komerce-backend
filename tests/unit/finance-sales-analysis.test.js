'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../routes/dashboard-shared', () => ({
  cached: jest.fn(() => null),
  setCache: jest.fn(),
  getEurKmf: jest.fn(() => Promise.resolve({ eur_kmf: 492 })),
  loadDashConfig: jest.fn(() => Promise.resolve({})),
}));
jest.mock('../../utils/logger', () => ({ child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })) }));

const db = require('../../db');
const { getSalesAnalysis } = require('../../services/finance-metrics/sales-analysis');

describe('finance-metrics/sales-analysis', () => {
  beforeEach(() => jest.clearAllMocks());

  function mockSalesQueries({ financeConfig = [{ target_marge_brute_pct: '45' }], cohortRows = [{ cohort_month: '2026-06-01', offset_months: '1', nb_clients: '3' }] } = {}) {
    db.query
      .mockResolvedValueOnce({ rows: [{ nb_commandes: '10', ca_kmf: '100000', panier_moyen: '10000', ca_eur: '203.25', couts_reels_kmf: '60000', nb_avec_cost: '8', nb_sans_cost: '2', marge_moy_pct: '30.5' }] })
      .mockResolvedValueOnce({ rows: [{ nb: '5', ca: '50000' }] })
      .mockResolvedValueOnce({ rows: [{ island: 'Anjouan', nb: '6', ca: '60000' }] })
      .mockResolvedValueOnce({ rows: [{ payment_mode: 'cash_relais', nb: '6', ca: '60000' }] })
      .mockResolvedValueOnce({ rows: [{ name: 'Riz', category: 'food', nb_sold: '12', revenue: '24000' }] })
      .mockResolvedValueOnce({ rows: [{ categorie: 'food', nb_commandes: '4', ca_kmf: '40000', marge_kmf: '12000', taux_marge_pct: '30.0' }] })
      .mockResolvedValueOnce({ rows: [{ bucket_date: '2026-06-01', nb_commandes: '2', ca_kmf: '20000' }] })
      .mockResolvedValueOnce({ rows: [{ nb_creees: '10', nb_confirmees: '8', nb_expediees: '6', nb_livrees: '4', nb_payees: '5', nb_perdues: '2' }] })
      .mockResolvedValueOnce({ rows: cohortRows })
      .mockResolvedValueOnce({ rows: financeConfig });
  }

  it('assemble sales analysis, marges, repartitions, evolution, funnel et cohortes', async () => {
    mockSalesQueries();

    const result = await getSalesAnalysis({ period: '30' });

    expect(result.period).toBe(30);
    expect(result.kpi).toMatchObject({ ca_kmf: 100000, ca_eur: 203.25, nb_commandes: 10, panier_moyen: 10000 });
    expect(result.kpi.evolution).toEqual({ ca_pct: 100, commandes_pct: 100 });
    expect(result.marges).toMatchObject({ marge_reelle_kmf: 30500, taux_marge_pct: 30.5, cible_marge_pct: 45, ecart_cible_pct: -14.5, couverture_pct: 80 });
    expect(result.by_island).toEqual([{ island: 'Anjouan', nb: '6', ca: '60000' }]);
    expect(result.by_payment).toEqual([{ payment_mode: 'cash_relais', nb: '6', ca: '60000' }]);
    expect(result.top_products).toEqual([{ name: 'Riz', category: 'food', nb_sold: '12', revenue: '24000' }]);
    expect(result.by_category).toEqual([{ categorie: 'food', nb_commandes: 4, ca_kmf: 40000, marge_kmf: 12000, taux_marge_pct: 30 }]);
    expect(result.evolution).toEqual({ bucket: 'day', points: [{ date: '2026-06-01', nb_commandes: 2, ca_kmf: 20000 }] });
    expect(result.funnel.etapes.map(e => e.pct)).toEqual([100, 80, 60, 40, 50]);
    expect(result.funnel.perdues).toBe(2);
    expect(result.cohorts.rows).toEqual([{ cohort_month: '2026-06-01', offset_months: 1, nb_clients: 3 }]);
  });

  it('utilise bucket week si periode superieure a 31 jours et fallback marge cible a 40', async () => {
    mockSalesQueries({ financeConfig: [] });

    const result = await getSalesAnalysis({ period: '90' });

    expect(result.period).toBe(90);
    expect(result.evolution.bucket).toBe('week');
    expect(result.marges.cible_marge_pct).toBe(40);
  });

  it('evite les divisions par zero dans evolution, couverture et funnel', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ nb_commandes: '0', ca_kmf: '0', panier_moyen: '0', ca_eur: '0', couts_reels_kmf: '0', nb_avec_cost: '0', nb_sans_cost: '0', marge_moy_pct: '0' }] })
      .mockResolvedValueOnce({ rows: [{ nb: '0', ca: '0' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ nb_creees: '0', nb_confirmees: '0', nb_expediees: '0', nb_livrees: '0', nb_payees: '0', nb_perdues: '0' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await getSalesAnalysis({ period: 'abc' });

    expect(result.period).toBe(30);
    expect(result.kpi.evolution).toEqual({ ca_pct: null, commandes_pct: null });
    expect(result.marges.couverture_pct).toBe(0);
    expect(result.funnel.etapes.map(e => e.pct)).toEqual([100, 0, 0, 0, 0]);
    expect(result.cohorts.rows).toEqual([]);
  });
});
