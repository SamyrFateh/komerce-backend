'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../db', () => ({ query: jest.fn() }));
const mockCache = { value: null };
jest.mock('../../routes/dashboard-shared', () => ({
  cached: jest.fn(() => mockCache.value),
  setCache: jest.fn((key, value) => { mockCache.value = value; }),
  getEurKmf: jest.fn(() => Promise.resolve({ eur_kmf: 492 })),
  loadDashConfig: jest.fn(() => Promise.resolve({})),
}));
jest.mock('../../utils/logger', () => ({ child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })) }));

const db = require('../../db');
const { cached, setCache } = require('../../routes/dashboard-shared');
const { getAnnulationsParcels } = require('../../services/finance-metrics/annulations');

describe('finance-metrics/annulations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCache.value = null;
  });

  it('retourne le cache si disponible', async () => {
    mockCache.value = { cached: true };

    await expect(getAnnulationsParcels({ period: 30 })).resolves.toEqual({ cached: true });
    expect(cached).toHaveBeenCalledWith('annulations-parcels');
    expect(db.query).not.toHaveBeenCalled();
  });

  it('assemble annulations, remboursements, credits, raisons et parcels', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ nb_annulees: '2', nb_actives: '8', annulees_7j: '1', annulees_30j: '2', nb_refunded: '1' }] })
      .mockResolvedValueOnce({ rows: [{ total_kmf: '10000', total_eur: '20.5', stripe_kmf: '7000', stripe_eur: '14.2', credit_kmf: '3000', nb_refunds: '2', nb_stripe: '1', nb_credit: '1' }] })
      .mockResolvedValueOnce({ rows: [{ total_actif_kmf: '5000', nb_credits_actifs: '3' }] })
      .mockResolvedValueOnce({ rows: [{ raison: 'Rupture', nb: '2' }] })
      .mockResolvedValueOnce({ rows: [{ reference: 'CMD-001', total_kmf: '9000', cancelled_at: 'date', cancel_reason: 'Rupture', payment_mode: 'cash_relais', refund_kmf: '4000', refund_method: 'store_credit' }] })
      .mockResolvedValueOnce({ rows: [{ total_parcels: '4', nb_partial: '1', nb_backorder: '1', en_cours: '2', backorder_actifs: '1', collected: '2', cancelled: '1' }] })
      .mockResolvedValueOnce({ rows: [{ status: 'available', type: 'partial', nb: '2' }] })
      .mockResolvedValueOnce({ rows: [{ reference: 'P-001', type: 'partial', status: 'available', created_at: 'date', order_reference: 'CMD-001', nb_items: '3' }] })
      .mockResolvedValueOnce({ rows: [{ nb: '1' }] });

    const result = await getAnnulationsParcels({ period: '30' });

    expect(result.period).toBe(30);
    expect(result.annulations.total).toBe(2);
    expect(result.annulations.taux_pct).toBe(20);
    expect(result.annulations.remboursements.stripe).toEqual({ count: 1, kmf: 7000, eur: 14.2 });
    expect(result.annulations.credits_actifs).toEqual({ total_kmf: 5000, nb: 3 });
    expect(result.annulations.raisons).toEqual([{ raison: 'Rupture', count: 2 }]);
    expect(result.annulations.recentes[0]).toMatchObject({ reference: 'CMD-001', total_kmf: 9000, refund_kmf: 4000 });
    expect(result.parcels).toMatchObject({ total: 4, partial: 1, backorder: 1, en_cours: 2, backorder_actifs: 1, taux_completion_pct: 50, nb_orders_with_parcels: 1 });
    expect(result.parcels.par_statut).toEqual({ partial_available: 2 });
    expect(result.parcels.recents).toEqual([{ reference: 'P-001', type: 'partial', status: 'available', order_reference: 'CMD-001', nb_items: 3, created_at: 'date' }]);
    expect(setCache).toHaveBeenCalledWith('annulations-parcels', result);
  });

  it('gere les divisions sans donnees sans NaN', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ nb_annulees: '0', nb_actives: '0', annulees_7j: '0', annulees_30j: '0', nb_refunded: '0' }] })
      .mockResolvedValueOnce({ rows: [{ total_kmf: '0', total_eur: '0', stripe_kmf: '0', stripe_eur: '0', credit_kmf: '0', nb_refunds: '0', nb_stripe: '0', nb_credit: '0' }] })
      .mockResolvedValueOnce({ rows: [{ total_actif_kmf: '0', nb_credits_actifs: '0' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total_parcels: '0', nb_partial: '0', nb_backorder: '0', en_cours: '0', backorder_actifs: '0', collected: '0', cancelled: '0' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ nb: '0' }] });

    const result = await getAnnulationsParcels({ period: 'abc' });

    expect(result.period).toBe(30);
    expect(result.annulations.taux_pct).toBe(0);
    expect(result.parcels.taux_completion_pct).toBe(0);
    expect(result.annulations.raisons).toEqual([]);
    expect(result.parcels.recents).toEqual([]);
  });
});
