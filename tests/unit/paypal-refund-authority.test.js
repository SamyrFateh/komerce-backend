'use strict';
/** @test-kind unit @test-runner jest @test-requires none
 * Finance F3 PayPal admin: no live PSP, exact committed-ledger boundary,
 * unknown fail-closed and verified-only partial/full settlement.
 */
const mockReserve = jest.fn();
const mockClaim = jest.fn();
const mockVerify = jest.fn();
jest.mock('../../services/refund-intent-ledger', () => {
  const real = jest.requireActual('../../services/refund-intent-ledger');
  return { ...real,
    reserveRefundIntent: (...args) => mockReserve(...args),
    claimRefundIntent: (...args) => mockClaim(...args),
  };
});
jest.mock('../../services/refund-intent-reconciliation', () => ({
  reconcileRefundIntent: (...args) => mockVerify(...args),
}));
jest.mock('../../services/refund-service', () => ({ recordExternalRefund: jest.fn() }));
jest.mock('../../services/payment-service', () => ({ markRefunded: jest.fn() }));
jest.mock('../../services/order-status-machine', () => ({
  appendOrderHistoryNote: jest.fn(),
  transitionOrderStatus: jest.fn(),
}));
jest.mock('../../services/documents/refund-receipt', () => ({
  issue: jest.fn(),
}));
jest.mock('../../utils/alerts', () => ({ createAlert: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
const { refundPaypalOrder, reconcilePaypalRefund } = require('../../services/paypal-refund-authority');
const { recordExternalRefund } = require('../../services/refund-service');
const { markRefunded } = require('../../services/payment-service');
const { appendOrderHistoryNote, transitionOrderStatus } = require('../../services/order-status-machine');
const receipt = require('../../services/documents/refund-receipt');
const { createAlert } = require('../../utils/alerts');

const INTENT = '11111111-2222-4333-8444-555555555555';
const ACTOR = { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', role: 'admin' };
const ENV = { KOMERCE_ENV: 'staging', PAYPAL_ENV: 'sandbox',
  FINANCE_DURABLE_REFUNDS_ENABLED: '1' };
const ORDER = {
  id: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff', reference: 'KM-TEST-1',
  payment_mode: 'paypal_eur', payment_status: 'paid', paypal_capture_id: 'CAP-01',
  total_eur: '100.00', total_kmf: '50000', status: 'ordered',
  market_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
};
const operation = (extra = {}) => ({
  orderId: ORDER.id, amountEur: '25.00', requestKey: 'PAYPAL-TEST-00001',
  reason: 'partial', adminUser: ACTOR, env: ENV, ...extra,
});

function fixture({ sum = '25.00', originalRefund = null, order = ORDER, amount = '25.00' } = {}) {
  let tx = false;
  const calls = [];
  const intentRow = {
    order_id: order.id, reference: order.reference,
    order_status: order.status, total_kmf: order.total_kmf, total_eur: order.total_eur,
    intent_id: INTENT, intent_status: 'confirmed', provider: 'paypal',
    provider_ref: 'RF-01', amount_eur: amount,
  };
  const client = {
    query: jest.fn(async (sql) => {
      calls.push(sql);
      if (sql === 'BEGIN') { tx = true; return { rows: [] }; }
      if (sql === 'COMMIT' || sql === 'ROLLBACK') { tx = false; return { rows: [] }; }
      if (sql.includes('FROM orders o JOIN refund_execution_intents i'))
        return { rows: [intentRow] };
      if (sql.includes('SELECT id, amount_kmf, amount_eur, refund_method, status FROM refunds'))
        return { rows: originalRefund ? [originalRefund] : [] };
      if (sql.includes('AS refunded_eur')) return { rows: [{ refunded_eur: sum }] };
      throw new Error('Unexpected settlement SQL: ' + sql);
    }),
    release: jest.fn(),
  };
  const db = {
    query: jest.fn(async (sql) => {
      calls.push(sql);
      if (sql.includes('SELECT * FROM orders WHERE')) return { rows: order ? [order] : [] };
      if (sql.includes('UPDATE refund_execution_intents SET status')) return {
        rowCount: 1, rows: [{ id: INTENT }],
      };
      if (sql.includes('SELECT id, status, provider_ref FROM refund_execution_intents'))
        return { rows: [{ id: INTENT, status: 'unknown', provider_ref: 'RF-01' }] };
      throw new Error('Unexpected pool SQL: ' + sql);
    }),
    connect: jest.fn(async () => client),
  };
  const paypal = {
    refundCapture: jest.fn(async () => {
      if (tx) throw new Error('PSP called while SQL transaction was open');
      return { id: 'RF-01', status: 'COMPLETED' };
    }),
    getRefund: jest.fn(),
  };
  return { db, paypal, client, calls, get transactionOpen() { return tx; } };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockReserve.mockResolvedValue({ intentId: INTENT, status: 'reserved', replayed: false });
  mockClaim.mockResolvedValue({
    providerRequestKey: 'kmr-ref-' + INTENT,
    capture_ref: ORDER.paypal_capture_id, amount_eur: '25.00',
  });
  mockVerify.mockResolvedValue({ status: 'confirmed', complete: true });
  recordExternalRefund.mockResolvedValue('refund-row-01');
  markRefunded.mockResolvedValue({ changed: true });
  transitionOrderStatus.mockResolvedValue({ success: true });
  appendOrderHistoryNote.mockResolvedValue(undefined);
  receipt.issue.mockResolvedValue(undefined);
  createAlert.mockResolvedValue(undefined);
});

test('gate ferme par defaut avant tout acces SQL ou PSP', async () => {
  const f = fixture();
  await expect(refundPaypalOrder(operation({
    env: { KOMERCE_ENV: 'production', PAYPAL_ENV: 'live' },
    paypal: f.paypal, db: f.db,
  }))).rejects.toMatchObject({ code: 'REFUND_PSP_NOT_CERTIFIED' });
  expect(f.db.query).not.toHaveBeenCalled();
  expect(f.paypal.refundCapture).not.toHaveBeenCalled();
});

test('Idempotency-Key obligatoire, pas de refund admin non trace', async () => {
  const f = fixture();
  await expect(refundPaypalOrder(operation({
    requestKey: null, paypal: f.paypal, db: f.db,
  }))).rejects.toMatchObject({ code: 'REFUND_IDEMPOTENCY_KEY_REQUIRED' });
  expect(mockReserve).not.toHaveBeenCalled();
});

test('partiel : reserve, claim, POST hors transaction, GET verifie, journal, pas de statut refunded', async () => {
  const f = fixture();
  const result = await refundPaypalOrder(operation({ paypal: f.paypal, db: f.db }));
  expect(result).toMatchObject({ status: 200, body: {
    refund_status: 'confirmed', partial: true, replayed: false,
  } });
  expect(mockReserve).toHaveBeenCalledWith(expect.objectContaining({
    provider: 'paypal', operationKey: 'paypal:admin:PAYPAL-TEST-00001',
    captureRef: 'CAP-01', amountEur: '25.00',
  }));
  expect(mockClaim).toHaveBeenCalledWith(expect.objectContaining({ intentId: INTENT }));
  expect(f.paypal.refundCapture).toHaveBeenCalledTimes(1);
  expect(f.paypal.refundCapture).toHaveBeenCalledWith('CAP-01',
    expect.objectContaining({ amountEur: 25, providerRequestKey: 'kmr-ref-' + INTENT }));
  expect(mockClaim.mock.invocationCallOrder[0])
    .toBeLessThan(f.paypal.refundCapture.mock.invocationCallOrder[0]);
  expect(mockVerify).toHaveBeenCalledWith(expect.objectContaining({
    intentId: INTENT, providerRefundId: 'RF-01', paypal: f.paypal,
  }));
  expect(recordExternalRefund).toHaveBeenCalledWith(expect.anything(),
    expect.objectContaining({ orderId: ORDER.id, amountEur: 25, amountKmf: 12500,
      refundType: 'paypal_admin:' + INTENT, method: 'paypal' }));
  expect(markRefunded).not.toHaveBeenCalled();
  expect(transitionOrderStatus).not.toHaveBeenCalled();
  expect(appendOrderHistoryNote).toHaveBeenCalledTimes(1);
  expect(f.calls).toContain('COMMIT');
  expect(receipt.issue).toHaveBeenCalledWith('refund-row-01', { issuedBy: ACTOR.id });
});

test('POST timeout : inconnue durable, jamais de wallet ni de second POST sur rejeu', async () => {
  const f = fixture();
  f.paypal.refundCapture.mockRejectedValueOnce(new Error('ECONNRESET after provider commit'));
  const initial = await refundPaypalOrder(operation({ paypal: f.paypal, db: f.db }));
  expect(initial).toMatchObject({ status: 202, body: {
    refund_status: 'unknown', requires_reconciliation: true } });
  expect(f.db.query).toHaveBeenCalledWith(
    expect.stringContaining("status = 'unknown'"), [INTENT, null]);
  mockReserve.mockResolvedValueOnce({
    intentId: INTENT, status: 'unknown', replayed: true,
  });
  const replay = await refundPaypalOrder(operation({ paypal: f.paypal, db: f.db }));
  expect(replay.status).toBe(202);
  expect(f.paypal.refundCapture).toHaveBeenCalledTimes(1);
  expect(recordExternalRefund).not.toHaveBeenCalled();
  expect(createAlert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    severity: 'high', type: 'refund_psp_reconciliation_required',
  }));
});

test('rejeu processing ou unknown ne claim jamais et ne rePOST jamais', async () => {
  const f = fixture();
  mockReserve.mockResolvedValue({ intentId: INTENT, status: 'processing', replayed: true });
  const answer = await refundPaypalOrder(operation({ paypal: f.paypal, db: f.db }));
  expect(answer.status).toBe(202);
  expect(mockClaim).not.toHaveBeenCalled();
  expect(f.paypal.refundCapture).not.toHaveBeenCalled();
});

test('full refund: markRefunded et transition atomiques seulement APRES GET verifie', async () => {
  const f = fixture({ sum: '100.00', amount: '100.00' });
  mockClaim.mockResolvedValue({ providerRequestKey: 'kmr-ref-' + INTENT,
    capture_ref: 'CAP-01', amount_eur: '100.00' });
  const answer = await refundPaypalOrder(operation({
    amountEur: '100.00', paypal: f.paypal, db: f.db,
  }));
  expect(answer).toMatchObject({ status: 200, body: { partial: false } });
  expect(markRefunded).toHaveBeenCalledTimes(1);
  expect(transitionOrderStatus).toHaveBeenCalledWith(expect.objectContaining({
    newStatus: 'refunded', source: 'refund_external',
  }));
  expect(mockVerify.mock.invocationCallOrder[0])
    .toBeLessThan(markRefunded.mock.invocationCallOrder[0]);
});

test('confirmed replay relit exactement son remboursement, sans POST ni nouvel ecriture', async () => {
  const f = fixture({ sum: '100.00', amount: '100.00',
    originalRefund: { id: 'refund-existing', amount_eur: '100.00', amount_kmf: 50000,
      refund_method: 'paypal', status: 'completed' },
  });
  mockReserve.mockResolvedValue({ intentId: INTENT, status: 'confirmed', replayed: true });
  const res = await refundPaypalOrder(operation({
    amountEur: '100.00', paypal: f.paypal, db: f.db,
  }));
  expect(res).toMatchObject({ status: 200, body: { replayed: true, partial: false } });
  expect(f.paypal.refundCapture).not.toHaveBeenCalled();
  expect(recordExternalRefund).not.toHaveBeenCalled();
  expect(markRefunded).not.toHaveBeenCalled();
});

test('reconciliation admin: GET seulement, zero POST PSP', async () => {
  const f = fixture();
  const res = await reconcilePaypalRefund({
    orderId: ORDER.id, requestKey: 'PAYPAL-TEST-00001',
    providerRefundId: 'RF-01', adminUser: ACTOR,
    paypal: f.paypal, db: f.db, env: ENV,
  });
  expect(res.status).toBe(200);
  expect(mockVerify).toHaveBeenCalledTimes(1);
  expect(f.paypal.refundCapture).not.toHaveBeenCalled();
});

test('provider verification inconclusive: pas de settlement ni statut refunded', async () => {
  const f = fixture();
  mockVerify.mockResolvedValue({ status: 'unknown', complete: false });
  const res = await refundPaypalOrder(operation({ paypal: f.paypal, db: f.db }));
  expect(res.status).toBe(202);
  expect(recordExternalRefund).not.toHaveBeenCalled();
  expect(markRefunded).not.toHaveBeenCalled();
});
