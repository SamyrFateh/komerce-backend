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
  loadDashConfig: jest.fn(() => Promise.resolve({ FRAUD_REVERSE_CRIT_DAYS: 7, FRAUD_PENDING_CRIT_H: 36, FRAUD_PENDING_WARN_H: 12 })),
}));
jest.mock('../../utils/logger', () => ({ child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })) }));

const db = require('../../db');
const { getPaymentsDetail } = require('../../services/finance-metrics/payments');

describe('finance-metrics/payments', () => {
  beforeEach(() => jest.clearAllMocks());

  function mockPaymentQueries({ aggOverrides = {}, rows = {} } = {}) {
    const agg = {
      cash_pending_count: '1', cash_pending_kmf: '5000', cash_overdue_12h: '1', cash_overdue_36h: '0', cash_paid_count: '2', cash_paid_kmf: '10000',
      stripe_pending_count: '1', stripe_pending_eur: '10', stripe_paid_count: '3', stripe_paid_eur: '25.5', stripe_failed_count: '1', stripe_failed_eur: '5.25',
      ...aggOverrides,
    };
    db.query
      .mockResolvedValueOnce({ rows: [agg] })
      .mockResolvedValueOnce({ rows: rows.pendingOrders || [] })
      .mockResolvedValueOnce({ rows: rows.failedOrders || [] })
      .mockResolvedValueOnce({ rows: rows.deliveredUnpaid || [] })
      .mockResolvedValueOnce({ rows: rows.sourcedUnpaid || [] })
      .mockResolvedValueOnce({ rows: rows.stripeNoproof || [] })
      .mockResolvedValueOnce({ rows: rows.cashNoproof || [] })
      .mockResolvedValueOnce({ rows: [rows.ecart || { total_commande_kmf: '100000', total_encaisse_kmf: '80000', total_source_kmf: '60000', gap_non_encaisse_kmf: '20000' }] })
      .mockResolvedValueOnce({ rows: rows.fraudCollectedUnpaid || [] })
      .mockResolvedValueOnce({ rows: rows.fraudDelayedReverse || [] })
      .mockResolvedValueOnce({ rows: rows.fraudStaleParcels || [] });
  }

  it('assemble les agregats cash/stripe et pending_orders avec urgence', async () => {
    mockPaymentQueries({
      rows: {
        pendingOrders: [{ id: 'o1', reference: 'CMD-1', payment_mode: 'cash_relais', payment_status: 'pending', order_status: 'available', total_kmf: '5000', total_eur: null, cash_ref_code: 'CASH1', client_name: 'Ali', client_phone: '+269', relais_name: 'Relais A', created_at: 'date', age_hours: '14.4' }],
        failedOrders: [{ reference: 'CMD-S', stripe_payment_id: 'pi_1', total_eur: '5.25', client_name: 'Bob', client_phone: '+2692', created_at: 'date' }],
      },
    });

    const result = await getPaymentsDetail({ period: '30' });

    expect(result.period).toBe(30);
    expect(result.cash.pending).toEqual({ count: 1, total_kmf: 5000 });
    expect(result.stripe.pending).toEqual({ count: 1, total_eur: 10 });
    expect(result.summary).toMatchObject({ total_pending_kmf: 9920, alert_count: 1, needs_action: true });
    expect(result.stripe.failed.orders[0]).toMatchObject({ reference: 'CMD-S', total_eur: 5.25, client: 'Bob' });
    expect(result.pending_orders[0]).toMatchObject({ id: 'o1', mode: 'cash', total_kmf: 5000, urgency: 'warning' });
  });

  it('detecte les ecarts de reconciliation et le niveau critical', async () => {
    mockPaymentQueries({
      rows: {
        deliveredUnpaid: [{ reference: 'CMD-D', payment_mode: 'cash_relais', payment_status: 'pending', order_status: 'collected', total_kmf: '7000', total_eur: null, client_name: 'Ali', client_phone: '+269', relais_name: 'Relais A', created_at: 'date' }],
        sourcedUnpaid: [{ reference: 'CMD-SRC', payment_mode: 'stripe_eur', payment_status: 'pending', total_kmf: '9000', total_eur: '18', cost_real_kmf: '4000', nb_parcels_actifs: '2', parcel_statuses: ['shipped'], client_name: 'Bob', client_phone: '+2692', created_at: 'date' }],
        stripeNoproof: [{ reference: 'CMD-NP', total_eur: '10.5', total_kmf: '5166', client_name: 'NoProof', created_at: 'date' }],
        cashNoproof: [{ reference: 'CMD-CASH', total_kmf: '3000', cash_ref_code: 'CR', client_name: 'Cash', created_at: 'date' }],
      },
    });

    const result = await getPaymentsDetail({ period: '30' });

    expect(result.reconciliation.delivered_unpaid).toMatchObject({ count: 1, total_kmf: 7000 });
    expect(result.reconciliation.sourced_unpaid).toMatchObject({ count: 1, total_kmf: 9000, cost_source_kmf: 4000 });
    expect(result.reconciliation.paid_no_proof.stripe_no_payment_id.count).toBe(1);
    expect(result.reconciliation.paid_no_proof.cash_no_timestamp.count).toBe(1);
    expect(result.reconciliation.alert_level).toBe('critical');
    expect(result.reconciliation.ecart_global).toMatchObject({ has_gap: true, gap_non_encaisse_kmf: 20000 });
  });

  it('score les anomalies relais cash et trie par risque', async () => {
    mockPaymentQueries({
      rows: {
        fraudCollectedUnpaid: [{ relais_id: 'r1', relais_name: 'Relais A', agent_name: 'Agent', relais_phone: '+1', island: 'Anjouan', total_kmf: '10000', reference: 'CMD-1', cash_ref_code: 'C1', client_name: 'Ali', client_phone: '+269', collected_at: 'date', heures_depuis_collected: '40' }],
        fraudDelayedReverse: [{ relais_id: 'r1', relais_name: 'Relais A', agent_name: 'Agent', relais_phone: '+1', island: 'Anjouan', total_kmf: '5000', reference: 'CMD-2', client_name: 'Ali', collected_at: 'c', cash_paid_at: 'p', jours_delai_reverse: '8' }],
        fraudStaleParcels: [{ relais_id: 'r2', relais_name: 'Relais B', agent_name: 'Agent B', relais_phone: '+2', island: 'Moheli', total_kmf: '3000', reference: 'CMD-3', client_name: 'Bob', client_phone: '+2692', available_at: 'a', jours_au_relais: '16' }],
      },
    });

    const result = await getPaymentsDetail({ period: '30' });

    expect(result.fraud_relais.collected_unpaid).toMatchObject({ count: 1, total_kmf: 10000 });
    expect(result.fraud_relais.delayed_reverse.orders[0]).toMatchObject({ urgency: 'critical', jours_delai_reverse: 8 });
    expect(result.fraud_relais.stale_parcels.orders[0]).toMatchObject({ jours_au_relais: 16 });
    expect(result.fraud_relais.relais_risk_scores[0]).toMatchObject({ relais_id: 'r1', risk_score: 5, risk_level: 'warning', total_kmf_at_risk: 15000 });
    expect(result.fraud_relais.alert_level).toBe('critical');
  });

  it('reste ok sans anomalies ni gap', async () => {
    mockPaymentQueries({
      aggOverrides: { cash_overdue_36h: '0', stripe_failed_count: '0', stripe_failed_eur: '0', cash_pending_kmf: '0', stripe_pending_eur: '0' },
      rows: { ecart: { total_commande_kmf: '1000', total_encaisse_kmf: '1000', total_source_kmf: '500', gap_non_encaisse_kmf: '0' } },
    });

    const result = await getPaymentsDetail({ period: '9999' });

    expect(result.period).toBe(365);
    expect(result.summary.needs_action).toBe(false);
    expect(result.reconciliation.alert_level).toBe('ok');
    expect(result.fraud_relais.alert_level).toBe('ok');
  });
});
