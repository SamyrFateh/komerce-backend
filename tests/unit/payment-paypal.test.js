'use strict';

jest.mock('../../utils/logger', () => {
  const child = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() });
  return { child, forModule: child };
});

jest.mock('../../services/order-payment-confirmation', () => ({ confirmPaymentCycle: jest.fn() }));
jest.mock('../../services/payment-service', () => ({ markRefunded: jest.fn() }));
jest.mock('../../routes/pickup-secret', () => ({
  generateAndStoreSecret: jest.fn().mockResolvedValue({ code: 'TEST-CODE' }),
  cacheCodeForReveal: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/documents/refund-receipt', () => ({ issue: jest.fn(() => Promise.resolve()) }));

const { confirmPaymentCycle } = require('../../services/order-payment-confirmation');
const { markRefunded } = require('../../services/payment-service');
const { generateAndStoreSecret, cacheCodeForReveal } = require('../../routes/pickup-secret');
const refundReceiptService = require('../../services/documents/refund-receipt');
const {
  createPaypalOrder,
  capturePaypalOrder,
  handlePaypalWebhookEvent,
  markPaypalEventProcessed,
  refundPaypalOrder,
} = require('../../services/payment-paypal');

function makeTxDb(script = []) {
  let i = 0;
  const client = {
    query: jest.fn(async (sql) => {
      const s = String(sql).trim();
      if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] };
      const next = script[i++];
      if (next instanceof Error) throw next;
      return next || { rows: [], rowCount: 0 };
    }),
    release: jest.fn(),
  };
  return {
    query: jest.fn(async () => {
      const next = script[i++];
      if (next instanceof Error) throw next;
      return next || { rows: [], rowCount: 0 };
    }),
    pool: { connect: jest.fn().mockResolvedValue(client) },
    client,
  };
}

describe('payment-paypal', () => {
  beforeEach(() => jest.clearAllMocks());

  it('createPaypalOrder cree une order PayPal et persiste paypal_order_id', async () => {
    const order = { id: 'order-1', reference: 'KMC-001', total_eur: '49.90' };
    const paypal = { createOrder: jest.fn().mockResolvedValue({ id: 'PP-ORDER-1', status: 'CREATED' }) };
    const db = { query: jest.fn().mockResolvedValueOnce({ rows: [] }) };

    await expect(createPaypalOrder(order, paypal, db)).resolves.toEqual({ paypal_order_id: 'PP-ORDER-1', status: 'CREATED' });
    expect(paypal.createOrder).toHaveBeenCalledWith(expect.objectContaining({ amountEur: 49.9, reference: 'KMC-001' }));
    expect(db.query).toHaveBeenCalledWith('UPDATE orders SET paypal_order_id = $1 WHERE id = $2', ['PP-ORDER-1', 'order-1']);
  });

  it('capturePaypalOrder retourne already_paid sans appeler PayPal si order deja payee', async () => {
    const paypal = { captureOrder: jest.fn(), extractCaptureInfo: jest.fn() };

    await expect(capturePaypalOrder('PP-ORDER-3', { id: 'order-3', reference: 'KMC-003', total_eur: '10.00', payment_status: 'paid' }, paypal, {}))
      .resolves.toEqual({ already_paid: true, order_id: 'order-3', order_reference: 'KMC-003' });
    expect(paypal.captureOrder).not.toHaveBeenCalled();
  });

  it('capturePaypalOrder refuse la capture si le montant PayPal differe du total', async () => {
    const order = { id: 'order-2', reference: 'KMC-002', total_eur: '49.90', payment_status: 'pending' };
    const paypal = {
      captureOrder: jest.fn().mockResolvedValue({ raw: true }),
      extractCaptureInfo: jest.fn().mockReturnValue({ status: 'COMPLETED', amount_value: 10.00, paypal_capture_id: 'CAP-1' }),
    };
    const db = { query: jest.fn().mockResolvedValueOnce({ rows: [] }), pool: { connect: jest.fn() } };

    const result = await capturePaypalOrder('PP-ORDER-2', order, paypal, db);

    expect(result).toEqual({ amount_mismatch: true, expected: 49.9, actual: 10.00 });
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO alerts'), expect.any(Array));
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  it('capturePaypalOrder execute le cycle paiement, persiste PayPal et cache le code retrait', async () => {
    const paypal = {
      captureOrder: jest.fn().mockResolvedValue({ raw: true }),
      extractCaptureInfo: jest.fn().mockReturnValue({
        status: 'COMPLETED', amount_value: 49.9, paypal_capture_id: 'CAP-OK', payer_email: 'buyer@example.com', payer_id: 'PAYER', payer_name: 'Buyer', pay_in_4: true,
      }),
    };
    const db = makeTxDb([{ rows: [{ relais_id: 'relais-001' }] }]);
    confirmPaymentCycle.mockResolvedValueOnce({ success: true });
    generateAndStoreSecret.mockResolvedValueOnce({ code: '123456' });

    await expect(capturePaypalOrder('PP-ORDER-OK', { id: 'order-ok', reference: 'KMC-OK', total_eur: '49.90' }, paypal, db))
      .resolves.toEqual({ success: true, order_id: 'order-ok', order_reference: 'KMC-OK', pay_in_4_used: true, stock_blocked: false });
    expect(confirmPaymentCycle).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'order-ok', source: 'paypal_capture', dbClient: db.client }));
    expect(generateAndStoreSecret).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'order-ok', relaisId: 'relais-001', channel: 'paypal', dbClient: db.client }));
    expect(cacheCodeForReveal).toHaveBeenCalledWith('order-ok', '123456');
    expect(db.client.query.mock.calls.map(c => String(c[0]).trim())).toContain('COMMIT');
  });

  it('capturePaypalOrder rollback et alerte si confirmPaymentCycle rejette apres capture', async () => {
    const paypal = {
      captureOrder: jest.fn().mockResolvedValue({ raw: true }),
      extractCaptureInfo: jest.fn().mockReturnValue({ status: 'COMPLETED', amount_value: 10, paypal_capture_id: 'CAP-FAIL' }),
    };
    const db = makeTxDb([]);
    db.query.mockResolvedValue({ rows: [], rowCount: 1 });
    confirmPaymentCycle.mockResolvedValueOnce({ success: false, error: 'bad_transition' });

    await expect(capturePaypalOrder('PP-ORDER-FAIL', { id: 'order-fail', reference: 'KMC-FAIL', total_eur: 10 }, paypal, db))
      .resolves.toEqual({ cycle_rejected: true, error: 'bad_transition' });
    expect(db.client.query.mock.calls.map(c => String(c[0]).trim())).toContain('ROLLBACK');
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO alerts'), expect.any(Array));
  });

  it('handlePaypalWebhookEvent gere signature invalide, idempotence et event ignore', async () => {
    const invalidPaypal = { verifyWebhookSignature: jest.fn().mockResolvedValue(false) };
    await expect(handlePaypalWebhookEvent({ id: 'evt_0', event_type: 'X' }, '{}', {}, {}, invalidPaypal)).resolves.toEqual({ invalidSignature: true });

    const paypal = { verifyWebhookSignature: jest.fn().mockResolvedValue(true) };
    const dbSeen = { query: jest.fn().mockResolvedValueOnce({ rows: [{ 1: 1 }] }) };
    await expect(handlePaypalWebhookEvent({ id: 'evt_1', event_type: 'PAYMENT.CAPTURE.COMPLETED' }, '{}', {}, dbSeen, paypal))
      .resolves.toEqual({ received: true, idempotent: true });

    const dbIgnored = { query: jest.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [], rowCount: 1 }) };
    await expect(handlePaypalWebhookEvent({ id: 'evt_2', event_type: 'BILLING.UNKNOWN' }, '{}', {}, dbIgnored, paypal))
      .resolves.toEqual({ received: true, ignored: true });
    expect(dbIgnored.query.mock.calls[1][1]).toEqual(['evt_2', 'BILLING.UNKNOWN', JSON.stringify({ reason: 'not_handled' }), 'ignored']);
  });

  it('markPaypalEventProcessed est non bloquant si insertion echoue', async () => {
    const db = { query: jest.fn().mockRejectedValueOnce(new Error('db_down')) };

    await expect(markPaypalEventProcessed({ id: 'evt_3', event_type: 'X' }, 'processed', { ok: true }, db)).resolves.toBeUndefined();
  });

  it('refundPaypalOrder valide, rembourse PayPal, trace refund et marque refunded', async () => {
    const order = { id: 'order-6', reference: 'KMC-006', total_kmf: 10000, total_eur: '10.00', payment_status: 'paid', paypal_capture_id: 'CAP-6' };
    const db = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [order] })
      .mockResolvedValueOnce({ rows: [{ id: 'refund-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 1 }) };
    const paypal = { refundCapture: jest.fn().mockResolvedValue({ id: 'REFUND-1', status: 'COMPLETED' }) };
    markRefunded.mockResolvedValueOnce({ changed: true });

    const result = await refundPaypalOrder({ orderId: 'order-6', amountEur: 10, reason: 'Client request', adminUser: { id: 'admin-1' }, paypal, db });

    expect(result).toEqual({ status: 200, body: { success: true, refund_id: 'REFUND-1', refund_status: 'COMPLETED' } });
    expect(paypal.refundCapture).toHaveBeenCalledWith('CAP-6', { amountEur: 10, reason: 'Client request' });
    expect(db.query.mock.calls[1][1]).toEqual(['order-6', 10000, 10, 'full', 'REFUND-1', 'Client request', 'admin-1']);
    expect(markRefunded).toHaveBeenCalledWith('order-6', { client: db });
    expect(refundReceiptService.issue).toHaveBeenCalledWith('refund-1', { issuedBy: 'admin-1' });
  });

  it('refundPaypalOrder bloque les preconditions invalides avant appel PayPal', async () => {
    const dbMissing = { query: jest.fn().mockResolvedValueOnce({ rows: [] }) };
    await expect(refundPaypalOrder({ orderId: 'missing', paypal: {}, db: dbMissing })).resolves.toMatchObject({ status: 404 });

    const dbNoCapture = { query: jest.fn().mockResolvedValueOnce({ rows: [{ id: 'order-4', payment_status: 'paid', paypal_capture_id: null }] }) };
    await expect(refundPaypalOrder({ orderId: 'order-4', paypal: {}, db: dbNoCapture })).resolves.toMatchObject({ status: 409 });

    const dbNotPaid = { query: jest.fn().mockResolvedValueOnce({ rows: [{ id: 'order-5', payment_status: 'pending', paypal_capture_id: 'CAP-5' }] }) };
    await expect(refundPaypalOrder({ orderId: 'order-5', paypal: {}, db: dbNotPaid })).resolves.toMatchObject({ status: 409 });

    const dbTooMuch = { query: jest.fn().mockResolvedValueOnce({ rows: [{ id: 'order-8', payment_status: 'paid', paypal_capture_id: 'CAP-8', total_eur: 10 }] }) };
    await expect(refundPaypalOrder({ orderId: 'order-8', amountEur: 12, paypal: {}, db: dbTooMuch })).resolves.toMatchObject({ status: 400 });
  });

  it('refundPaypalOrder retourne 502 si refundCapture echoue', async () => {
    const db = { query: jest.fn().mockResolvedValueOnce({ rows: [{ id: 'order-7', total_eur: '10.00', payment_status: 'paid', paypal_capture_id: 'CAP-7' }] }) };
    const paypal = { refundCapture: jest.fn().mockRejectedValue(new Error('paypal down')) };

    await expect(refundPaypalOrder({ orderId: 'order-7', adminUser: { id: 'admin-1' }, paypal, db })).resolves.toMatchObject({ status: 502 });
  });
});
