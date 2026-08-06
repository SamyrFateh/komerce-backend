'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/dashboard-finance-metrics.test.js
 * Tests de caractérisation — services/dashboard-finance-metrics.js (Lot B7 — 2026-06-28)
 */

jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const CFG = {
  SLA_WARNING_DAYS: 35, SLA_LATE_DAYS: 42, SLA_BLOCKED_DAYS: 56, INACTIVE_DAYS: 7,
  DELAY_PREVENTIF: 28, DELAY_AVOIR: 35, DELAY_REMISE: 42, DELAY_REMBOURSEMENT: 56,
  FRAUD_REVERSE_CRIT_DAYS: 7, FRAUD_PENDING_CRIT_H: 36, FRAUD_PENDING_WARN_H: 12,
  FRAUD_STALE_DAYS: 14, FRAUD_REVERSE_SQL_DAYS: 3,
};

jest.mock('../../routes/dashboard-shared', () => ({
  cached:         jest.fn().mockReturnValue(null),
  setCache:       jest.fn(),
  getEurKmf:      jest.fn().mockResolvedValue({ eur_kmf: 490, aed_kmf: 179 }),
  loadDashConfig: jest.fn().mockResolvedValue(CFG),
}));

const db = require('../../db');
const { getFinanceSummary, getAnnulationsParcels, getPaymentsDetail, getSalesAnalysis } =
  require('../../services/dashboard-finance-metrics');

const R0 = { rows: [{}] };
const RA = { rows: [] };

function mockSeq(...responses) {
  jest.clearAllMocks();
  require('../../routes/dashboard-shared').cached.mockReturnValue(null);
  require('../../routes/dashboard-shared').getEurKmf.mockResolvedValue({ eur_kmf: 490, aed_kmf: 179 });
  require('../../routes/dashboard-shared').loadDashConfig.mockResolvedValue(CFG);
  responses.forEach(r => db.query.mockResolvedValueOnce(r));
}

beforeEach(() => jest.clearAllMocks());

// ════════════════════════════════════════════════════════════════════════════
// 1. getFinanceSummary
// Séquence : getEurKmf (mock), kpi(R0), perteRows(RA), catRows(RA), topProds(RA)
// ════════════════════════════════════════════════════════════════════════════
describe('getFinanceSummary', () => {
  it('retourne les clés top-level attendues', async () => {
    mockSeq(R0, RA, RA, RA);
    const result = await getFinanceSummary({ period: '30' });
    expect(result).toHaveProperty('period', 30);
    expect(result).toHaveProperty('taux');
    expect(result).toHaveProperty('kpi');
    expect(result).toHaveProperty('paiements');
    expect(result).toHaveProperty('marges');
    expect(result).toHaveProperty('par_categorie');
    expect(result).toHaveProperty('top_produits');
    expect(db.query).toHaveBeenCalledTimes(4);
  });

  it('shape kpi : clés numériques + evolution', async () => {
    mockSeq(R0, RA, RA, RA);
    const { kpi } = await getFinanceSummary({ period: '7' });
    expect(kpi).toMatchObject({
      ca_kmf:           expect.any(Number),
      nb_commandes:     expect.any(Number),
      panier_moyen_kmf: expect.any(Number),
      evolution:        expect.objectContaining({ ca_pct: null, cmd_pct: null }),
    });
  });

  it('period est clampé entre 1 et 365', async () => {
    mockSeq(R0, RA, RA, RA);
    const r1 = await getFinanceSummary({ period: '-5' });
    expect(r1.period).toBe(1);

    mockSeq(R0, RA, RA, RA);
    const r2 = await getFinanceSummary({ period: '500' });
    expect(r2.period).toBe(365);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. getAnnulationsParcels
// Séquence : annulKpi(R0), remb(R0), credits(R0), raisonsRows(RA),
//            recentCancel(RA), parcelKpi(R0), parcelStatuts(RA),
//            recentParcels(RA), partialOrders(R0)
// ════════════════════════════════════════════════════════════════════════════
describe('getAnnulationsParcels', () => {
  it('retourne les clés top-level commandes + parcels', async () => {
    mockSeq(R0, R0, R0, RA, RA, R0, RA, RA, R0);
    const result = await getAnnulationsParcels({ period: '30' });
    expect(result).toHaveProperty('annulations');
    expect(result).toHaveProperty('parcels');
    expect(db.query).toHaveBeenCalledTimes(9);
  });

  it('commandes.remboursements a les sous-clés stripe et credit_boutique', async () => {
    mockSeq(R0, R0, R0, RA, RA, R0, RA, RA, R0);
    const { annulations } = await getAnnulationsParcels({});
    expect(annulations).toHaveProperty('remboursements');
    expect(annulations.remboursements).toHaveProperty('stripe');
    expect(annulations.remboursements).toHaveProperty('credit_boutique');
  });

  it('retourne la valeur du cache si cache hit', async () => {
    const shared = require('../../routes/dashboard-shared');
    shared.cached.mockReturnValue({ commandes: {}, parcels: {}, __cached: true });
    const result = await getAnnulationsParcels({});
    expect(result.__cached).toBe(true);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('appelle setCache après les queries', async () => {
    mockSeq(R0, R0, R0, RA, RA, R0, RA, RA, R0);
    const { setCache } = require('../../routes/dashboard-shared');
    await getAnnulationsParcels({});
    expect(setCache).toHaveBeenCalledWith('annulations-parcels', expect.any(Object));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. getPaymentsDetail
// loadDashConfig (mock) + getEurKmf (mock)
// Séquence db.query : agg(R0), pendingOrders(RA), failedOrders(RA),
//   deliveredUnpaid(RA), sourcedUnpaid(RA), stripeNoproof(RA),
//   cashNoproof(RA), ecart(R0), fraudCollectedUnpaid(RA),
//   fraudDelayedReverse(RA), fraudStaleParcels(RA)
// Vraies clés : period, taux, cash, stripe, summary, reconciliation, fraud_relais, pending_orders
// ════════════════════════════════════════════════════════════════════════════
describe('getPaymentsDetail', () => {
  it('retourne les clés top-level attendues', async () => {
    mockSeq(R0, RA, RA, RA, RA, RA, RA, R0, RA, RA, RA);
    const result = await getPaymentsDetail({});
    expect(result).toHaveProperty('period');
    expect(result).toHaveProperty('taux');
    expect(result).toHaveProperty('cash');
    expect(result).toHaveProperty('stripe');
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('reconciliation');
    expect(result).toHaveProperty('fraud_relais');
    expect(result).toHaveProperty('pending_orders');
    expect(db.query).toHaveBeenCalledTimes(11);
  });

  it('fraud_relais.alert_level vaut "ok" quand toutes les listes fraude sont vides', async () => {
    mockSeq(R0, RA, RA, RA, RA, RA, RA, R0, RA, RA, RA);
    const { fraud_relais } = await getPaymentsDetail({});
    expect(fraud_relais.alert_level).toBe('ok');
  });

  it('pending_orders est un tableau', async () => {
    mockSeq(R0, RA, RA, RA, RA, RA, RA, R0, RA, RA, RA);
    const { pending_orders } = await getPaymentsDetail({});
    expect(Array.isArray(pending_orders)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. getSalesAnalysis
// Séquence : kpiQ(R0), prevKpiQ(R0), byIsland(RA), byPayment(RA),
//            topProducts(RA), byCategory(RA), evolution(RA), funnelQ(R0),
//            cohortsQ(RA), finance_config(RA — try/catch)
// ════════════════════════════════════════════════════════════════════════════
describe('getSalesAnalysis', () => {
  it('retourne les clés top-level attendues', async () => {
    mockSeq(R0, R0, RA, RA, RA, RA, RA, R0, RA, RA);
    const result = await getSalesAnalysis({ period: '30' });
    expect(result).toHaveProperty('period', 30);
    expect(result).toHaveProperty('kpi');
    expect(result).toHaveProperty('marges');
    expect(result).toHaveProperty('by_island');
    expect(result).toHaveProperty('by_payment');
    expect(result).toHaveProperty('top_products');
    expect(result).toHaveProperty('by_category');
    expect(result).toHaveProperty('evolution');
    expect(result).toHaveProperty('funnel');
    expect(result).toHaveProperty('cohorts');
    expect(db.query).toHaveBeenCalledTimes(10);
  });

  it('kpi a les clés numériques + evolution', async () => {
    mockSeq(R0, R0, RA, RA, RA, RA, RA, R0, RA, RA);
    const { kpi } = await getSalesAnalysis({});
    expect(kpi).toMatchObject({
      ca_kmf:       expect.any(Number),
      nb_commandes: expect.any(Number),
      panier_moyen: expect.any(Number),
      evolution:    expect.objectContaining({ ca_pct: null, commandes_pct: null }),
    });
  });

  it('funnel a 5 étapes ordonnées', async () => {
    mockSeq(R0, R0, RA, RA, RA, RA, RA, R0, RA, RA);
    const { funnel } = await getSalesAnalysis({});
    expect(funnel.etapes).toHaveLength(5);
    const ids = funnel.etapes.map(e => e.id);
    expect(ids).toEqual(['creees', 'confirmees', 'expediees', 'livrees', 'payees']);
  });

  it('marges.couverture_pct = 0 quand nb_avec_cost = 0', async () => {
    mockSeq(R0, R0, RA, RA, RA, RA, RA, R0, RA, RA);
    const { marges } = await getSalesAnalysis({});
    expect(marges.couverture_pct).toBe(0);
  });
});
