'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../services/refund-intent-ledger', () => ({
  ...jest.requireActual('../../services/refund-intent-ledger'),
  reserveRefundIntentInTransaction: jest.fn(),
  claimRefundIntent: jest.fn(),
}));
jest.mock('../../services/refund-intent-reconciliation', () => ({ reconcileRefundIntent: jest.fn() }));
jest.mock('../../services/refund-service', () => ({ recordExternalRefund: jest.fn() }));
jest.mock('../../services/documents/refund-receipt', () => ({ issue: jest.fn() }));
const ledger = require('../../services/refund-intent-ledger');
const reconcile = require('../../services/refund-intent-reconciliation').reconcileRefundIntent;
const record = require('../../services/refund-service').recordExternalRefund;
const issue = require('../../services/documents/refund-receipt').issue;
const { reserve, execute } = require('../../services/sav-ledger-refund');
const env = {
  KOMERCE_ENV: 'staging', E7_ITEM_RESERVATIONS_ENABLED: '1',
  E7_SANDBOX_REFUND_EXECUTION_ENABLED: '1', STRIPE_SECRET_KEY: 'sk_test_fixture',
};
const compensation = {
  refund_intent_id: 'intent', order_id: 'order', refund_amount_kmf: 2000,
  request_id: 'return', decided_by: 'admin', reason: 'Défaut attesté',
};
const dossier = {
  id: 'return', order_id: 'order', payment_mode: 'stripe_eur', stripe_payment_id: 'pi_test',
  total_kmf: '10000', total_eur: '20.00', fx_snapshot: { market: { amount: 15000 } },
};

beforeEach(() => jest.resetAllMocks());

test('réserve une part de la capture d’origine au taux figé et refuse un PSP hors sandbox', async () => {
  const client = {};
  ledger.reserveRefundIntentInTransaction.mockResolvedValue({ intentId: 'intent' });
  const args = { client, dossier, currency: 'XAF', value: 3000, actor: { id: 'admin' } };
  await expect(reserve({ ...args, env: {} })).rejects.toMatchObject({ status: 403 });
  expect(ledger.reserveRefundIntentInTransaction).not.toHaveBeenCalled();
  await expect(reserve({ ...args, env })).resolves.toMatchObject({ intentId: 'intent', amountKmf: 2000 });
  expect(ledger.reserveRefundIntentInTransaction).toHaveBeenCalledWith(client, {
    orderId: 'order', operationKey: 'sav:return', provider: 'stripe', captureRef: 'pi_test', amountEur: '4.00', initiatedBy: 'admin',
  });
});

test.each(['confirmed', 'failed', 'timeout'])('résultat PSP %s et rejeu sans second POST', async verdict => {
  const intent = { status: 'reserved', provider: 'stripe', amount_eur: '4.00', provider_ref: null };
  const client = {};
  const db = {
    query: jest.fn(async (sql, params) => {
      if (sql.startsWith('SELECT')) return { rows: [{ ...intent }] };
      intent.status = 'unknown';
      intent.provider_ref = params[1];
      return { rows: [] };
    }),
    withTransaction: fn => fn(client),
  };
  ledger.claimRefundIntent.mockResolvedValue({ capture_ref: 'pi_test', amount_eur: '4.00', providerRequestKey: 'stable' });
  reconcile.mockImplementation(async () => {
    intent.status = verdict;
    return { status: verdict };
  });
  record.mockResolvedValue('refund');
  const create = verdict === 'timeout' ? jest.fn().mockRejectedValue(new Error('timeout')) : jest.fn().mockResolvedValue({ id: 're_test' });
  const input = { compensation, db, env, stripe: { refunds: { create } } };
  const result = await execute({ ...input, replayed: false });
  expect(result.refund_status).toBe(verdict === 'timeout' ? 'unknown' : verdict);
  await execute({ ...input, replayed: true });
  expect(create).toHaveBeenCalledTimes(1);
  expect(ledger.claimRefundIntent).toHaveBeenCalledTimes(1);
  if (verdict === 'confirmed') {
    expect(record).toHaveBeenCalledWith(client, expect.objectContaining({ externalRefundId: 're_test', refundType: 'sav:return' }));
    expect(issue).toHaveBeenCalledWith('refund', { issuedBy: 'admin' });
  } else {
    expect(record).not.toHaveBeenCalled();
    expect(issue).not.toHaveBeenCalled();
  }
});
