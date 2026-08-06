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
const { getEurKmf } = require('../../routes/dashboard-shared');
const { getFinanceSummary } = require('../../services/finance-metrics/finance-summary');

describe('finance-metrics/finance-summary', () => {
  beforeEach(() => jest.clearAllMocks());

  it('normalise la periode entre 1 et 365 jours', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ ca_kmf: '0', ca_prev_kmf: '0', nb_commandes: '0', nb_prev: '0', nb_livrees: '0', nb_annulees: '0', panier_moyen_kmf: '0', nb_cash: '0', nb_stripe: '0', ca_cash_kmf: '0', ca_stripe_eur: '0', cout_logistique_kmf: '0', marge_reelle_kmf: '0', nb_avec_cost: '0', nb_sans_cost: '0' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await getFinanceSummary({ period: '9999' });

    expect(result.period).toBe(365);
    expect(db.query.mock.calls[0][1]).toEqual([365, 730]);
    expect(getEurKmf).toHaveBeenCalled();
  });

  it('retourne kpi, paiements, marges, categories et top produits', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{
        ca_kmf: '98400', ca_prev_kmf: '49200', nb_commandes: '10', nb_prev: '5',
        nb_livrees: '4', nb_annulees: '1', panier_moyen_kmf: '9840',
        nb_cash: '6', nb_stripe: '4', ca_cash_kmf: '60000', ca_stripe_eur: '78.05',
        cout_logistique_kmf: '20000', marge_reelle_kmf: '78400', nb_avec_cost: '8', nb_sans_cost: '2',
      }] })
      .mockResolvedValueOnce({ rows: [{ reference: 'CMD-LOSS' }] })
      .mockResolvedValueOnce({ rows: [{ category: 'food', nb_commandes: '3', ca_kmf: '30000', marge_kmf: '10000', taux_marge_pct: '33.3' }] })
      .mockResolvedValueOnce({ rows: [{ name: 'Riz', category: 'food', qty_vendue: '7', revenue_kmf: '21000' }] });

    const result = await getFinanceSummary({ period: '30' });

    expect(result.kpi).toMatchObject({ ca_kmf: 98400, ca_eur: 200, nb_commandes: 10, nb_livrees: 4, nb_annulees: 1, panier_moyen_kmf: 9840 });
    expect(result.kpi.evolution).toEqual({ ca_pct: 100, cmd_pct: 100 });
    expect(result.paiements).toEqual({ cash: { count: 6, total_kmf: 60000 }, stripe: { count: 4, total_eur: 78.05 } });
    expect(result.marges).toMatchObject({ marge_reelle_kmf: 78400, cout_logistique_kmf: 20000, taux_marge_pct: 79.7, nb_avec_cost: 8, nb_sans_cost: 2 });
    expect(result.marges.alertes_perte).toEqual({ count: 1, refs: ['CMD-LOSS'] });
    expect(result.par_categorie).toEqual([{ categorie: 'food', nb_commandes: 3, ca_kmf: 30000, marge_kmf: 10000, taux_marge: 33.3 }]);
    expect(result.top_produits).toEqual([{ nom: 'Riz', categorie: 'food', qty: 7, ca_kmf: 21000 }]);
  });

  it('ne produit pas de pourcentage si periode precedente ou CA cout absent', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ ca_kmf: '0', ca_prev_kmf: '0', nb_commandes: '0', nb_prev: '0', nb_livrees: '0', nb_annulees: '0', panier_moyen_kmf: '0', nb_cash: '0', nb_stripe: '0', ca_cash_kmf: '0', ca_stripe_eur: '0', cout_logistique_kmf: '0', marge_reelle_kmf: '0', nb_avec_cost: '0', nb_sans_cost: '0' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await getFinanceSummary({ period: 'abc' });

    expect(result.period).toBe(30);
    expect(result.kpi.evolution).toEqual({ ca_pct: null, cmd_pct: null });
    expect(result.marges.taux_marge_pct).toBeNull();
    expect(result.marges.alertes_perte).toBeNull();
  });
});
