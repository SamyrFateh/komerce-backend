'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const metric = key => ({ key, label: key, value: 1, unit: 'count', data_quality: {} });
const mocks = {
  getCAEncaisse: jest.fn(async () => metric('ca_encaisse')),
  getCoutReel: jest.fn(async () => metric('cout_reel')),
  getMargeConsolidee: jest.fn(async () => metric('marge_consolidee')),
  getTauxCompletudeCouts: jest.fn(async () => metric('taux_completude_couts')),
  getCmdsCoutIncompletCount: jest.fn(async () => metric('cmds_cout_incomplet')),
  getPaiementsEnAttente: jest.fn(async () => metric('paiements_en_attente')),
  getCmdsCoutIncompletIds: jest.fn(async () => [
    { reference: 'CMD-1', status: 'confirmed', payment_status: 'paid', total_kmf: '1000', created_at: '2026-08-20T00:00:00.000Z' },
  ]),
};
jest.mock('../../services/dashboard-metrics', () => mocks);

const finance = require('../../services/dashboard-finance-canonical');

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockImplementation(async sql => {
    const text = String(sql);
    if (text.includes('COUNT(*)::int AS count') && text.includes('FROM refunds')) {
      return { rows: [{ count: 2, total_kmf: '1500', stripe_kmf: '1000', store_credit_kmf: '500' }] };
    }
    if (text.includes('GROUP BY o.payment_mode')) {
      return { rows: [{ payment_mode: 'stripe_eur', orders: 2, total_kmf: '9000' }] };
    }
    if (text.includes('r.completed_at') && text.includes('ORDER BY r.completed_at DESC')) {
      return { rows: [{ order_reference: 'CMD-R', amount_kmf: '500', refund_method: 'stripe', completed_at: '2026-08-23T00:00:00.000Z' }] };
    }
    return { rows: [] };
  });
});

test('Finance market injecte le market_id serveur dans tous les SSOT de commande', async () => {
  const payload = await finance.buildFinance(
    { period: '30' },
    {
      market: { id: 'market-cm-id', code: 'CM', name: 'Cameroun', currency: 'XAF' },
      now: new Date('2026-08-24T12:00:00.000Z'),
    }
  );

  for (const fn of [
    mocks.getCAEncaisse,
    mocks.getCoutReel,
    mocks.getMargeConsolidee,
    mocks.getTauxCompletudeCouts,
    mocks.getCmdsCoutIncompletCount,
    mocks.getPaiementsEnAttente,
  ]) {
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ market_id: 'market-cm-id' }));
  }
  expect(mocks.getCmdsCoutIncompletIds).toHaveBeenCalledWith(
    expect.objectContaining({ market_id: 'market-cm-id' }),
    { limit: 20 }
  );

  expect(payload.scope).toEqual({ mode: 'market', market: { code: 'CM', name: 'Cameroun', currency: 'XAF' } });
  expect(payload.period).toBe(30);
  expect(JSON.stringify(payload)).not.toContain('market-cm-id');
});

test('les remboursements market sont filtrés par completed_at et orders.market_id', async () => {
  await finance.buildFinance(
    { period: '7' },
    {
      market: { id: 'market-cm-id', code: 'CM', name: 'Cameroun', currency: 'XAF' },
      now: new Date('2026-08-24T12:00:00.000Z'),
    }
  );

  const refundCalls = mockQuery.mock.calls.filter(([sql]) => String(sql).includes('FROM refunds r'));
  expect(refundCalls).toHaveLength(2);
  refundCalls.forEach(([sql, params]) => {
    expect(String(sql)).toContain('r.completed_at >= $1');
    expect(String(sql)).toContain('r.completed_at <= $2');
    expect(String(sql)).toContain('o.market_id = $3');
    expect(params[2]).toBe('market-cm-id');
  });
});

test('Finance globale ne fabrique aucun filtre market et normalise la période', async () => {
  const payload = await finance.buildFinance(
    { period: '999' },
    { now: new Date('2026-08-24T12:00:00.000Z') }
  );

  expect(payload.scope).toEqual({ mode: 'global', market: null });
  expect(payload.period).toBe(30);
  const refundCalls = mockQuery.mock.calls.filter(([sql]) => String(sql).includes('FROM refunds r'));
  refundCalls.forEach(([sql, params]) => {
    expect(String(sql)).not.toContain('o.market_id');
    expect(params).toHaveLength(2);
  });
});
