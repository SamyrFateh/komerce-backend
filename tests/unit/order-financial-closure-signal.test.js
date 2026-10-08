'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

let mockQuery;
const mockReconcile = jest.fn();
const mockUpsert = jest.fn();
const mockWarn = jest.fn();

jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));
jest.mock('../../utils/logger', () => ({ child: () => ({ info: jest.fn(), warn: (...a) => mockWarn(...a), error: jest.fn() }) }));
jest.mock('../../services/signal-service', () => ({ upsertSignal: (...args) => mockUpsert(...args) }));
jest.mock('../../services/order-financial-closure-reconciliation', () => {
  const actual = jest.requireActual('../../services/order-financial-closure-reconciliation');
  return { ...actual, reconcileOrderFinancialClose: (...args) => mockReconcile(...args) };
});

const { VERDICT } = jest.requireActual('../../services/order-financial-closure-reconciliation');
const producer = require('../../services/order-financial-closure-signal');

beforeEach(() => {
  mockQuery = jest.fn();
  mockReconcile.mockReset();
  mockUpsert.mockReset().mockResolvedValue({});
  mockWarn.mockReset();
});

test('émet un signal finance uniquement pour le verdict serveur « faits économiques en attente »', async () => {
  mockReconcile
    .mockResolvedValueOnce({ verdict: VERDICT.PENDING, reason: producer.PENDING_REASON })
    .mockResolvedValueOnce({ verdict: VERDICT.MATCHED, reason: null })
    .mockResolvedValueOnce({ verdict: VERDICT.PENDING, reason: 'FINANCIAL_CLOSE_REFUND_PENDING' });
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 'o-1', reference: 'CMD-1' }, { id: 'o-2', reference: 'CMD-2' }, { id: 'o-3', reference: 'CMD-3' }] })
    .mockResolvedValueOnce({ rowCount: 2 });

  expect(await producer.generateFinancialCloseSignals()).toEqual({ generated: 1, evaluated: 3, truncated: false });

  const [selectSql, selectParams] = mockQuery.mock.calls[0];
  expect(selectSql).toContain("o.status::text = 'collected'");
  expect(selectSql).toContain("o.payment_status::text = 'paid'");
  expect(selectParams).toEqual([60, 201]);

  expect(mockUpsert).toHaveBeenCalledTimes(1);
  expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({
    signal_type: 'financial_close_economic_facts_pending', severity: 'warning', owner_role: 'finance', entity_type: 'order', entity_id: 'o-1',
  }));

  const [resolveSql, resolveParams] = mockQuery.mock.calls[1];
  expect(resolveSql).toContain('s.signal_type = $3');
  expect(resolveParams).toEqual([['o-2', 'o-3'], 60, 'financial_close_economic_facts_pending']);
});

test('une évaluation en échec ne résout rien pour cette commande (fail-closed) et n’interrompt pas le lot', async () => {
  mockReconcile
    .mockRejectedValueOnce(new Error('db hiccup'))
    .mockResolvedValueOnce({ verdict: VERDICT.MATCHED, reason: null });
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 'o-1', reference: 'A' }, { id: 'o-2', reference: 'B' }] })
    .mockResolvedValueOnce({ rowCount: 0 });

  expect(await producer.generateFinancialCloseSignals()).toEqual({ generated: 0, evaluated: 2, truncated: false });
  expect(mockQuery.mock.calls[1][1][0]).toEqual(['o-2']);
});

test('un plafond atteint est rapporté (truncated) et journalisé, jamais silencieux', async () => {
  mockReconcile.mockResolvedValue({ verdict: VERDICT.MATCHED, reason: null });
  mockQuery
    .mockResolvedValueOnce({ rows: Array.from({ length: 201 }, (_, i) => ({ id: `o-${i}`, reference: `R${i}` })) })
    .mockResolvedValueOnce({ rowCount: 0 });

  expect(await producer.generateFinancialCloseSignals()).toEqual({ generated: 0, evaluated: 200, truncated: true });
  expect(mockReconcile).toHaveBeenCalledTimes(200);
  expect(mockWarn).toHaveBeenCalledWith(expect.objectContaining({ max: 200 }), 'financial_close candidates truncated');
});

test('une panne de lecture est non fatale et rapportée', async () => {
  mockQuery.mockRejectedValueOnce(new Error('db down'));
  expect(await producer.generateFinancialCloseSignals()).toEqual({ generated: 0, error: 'db down' });
});
