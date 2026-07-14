/**
 * KOMERCE — Tests Unitaires : payment-paypal (R5)
 *
 * Couvre :
 *   - createPaypalOrder : nominal
 *   - capturePaypalOrder : amount mismatch refusé
 *   - handlePaypalWebhookEvent : idempotence event déjà traité
 *   - refundPaypalOrder : nominal, préconditions (capture absente, non payé)
 *
 * Run : npx jest tests/unit/payment-paypal.test.js
 */

'use strict';

jest.mock('../../utils/logger', () => {
  const child = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() });
  return { child, forModule: child };
});

jest.mock('../../services/order-payment-confirmation', () => ({
  confirmPaymentCycle: jest.fn(),
}));

jest.mock('../../services/pickup-secret-service', () => ({
  generateAndStoreSecret: jest.fn().mockResolvedValue({ code: 'TEST-CODE' }),
  cacheCodeForReveal: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/notification-service', () => ({
  notifyPaymentConfirmed: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../routes/purchasing', () => ({
  triggerPurchasing: jest.fn().mockResolvedValue({ ok: true }),
}));

jest.mock('../../services/documents/refund-receipt', () => ({
  issue: jest.fn().mockResolvedValue({ id: 'receipt-1' }),
}));
jest.mock('../../services/order-status-machine', () => ({
  transitionOrderStatus: jest.fn().mockResolvedValue({ success: true, previousStatus: 'confirmed', newStatus: 'refunded' }),
  appendOrderHistoryNote: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/refund-service', () => ({
  recordExternalRefund: jest.fn().mockResolvedValue('mock-refund-id'),
  processRefund: jest.fn(),
  processRefundWithFallback: jest.fn(),
  _buildIdempotencyKey: jest.fn(),
}));

const { confirmPaymentCycle } = require('../../services/order-payment-confirmation');
const { generateAndStoreSecret, cacheCodeForReveal } = require('../../services/pickup-secret-service');
const refundReceiptService = require('../../services/documents/refund-receipt');

const {
  createPaypalOrder,
  capturePaypalOrder,
  handlePaypalWebhookEvent,
  refundPaypalOrder,
} = require('../../services/payment-paypal');

const mockDbQuery = jest.fn();
const mockClientQuery = jest.fn();
const mockClientRelease = jest.fn();
const mockClient = { query: mockClientQuery, release: mockClientRelease };
const mockConnect = jest.fn();
const makeDb = () => ({ query: mockDbQuery, pool: { connect: mockConnect } });

beforeEach(() => {
  mockDbQuery.mockReset();
  mockClientQuery.mockReset();
  mockClientRelease.mockReset();
  mockConnect.mockReset();
  mockConnect.mockResolvedValue(mockClient);
  confirmPaymentCycle.mockReset();
  generateAndStoreSecret.mockReset();
  generateAndStoreSecret.mockResolvedValue({ code: 'TEST-CODE' });
  cacheCodeForReveal.mockReset();
  cacheCodeForReveal.mockResolvedValue(undefined);
  refundReceiptService.issue.mockReset();
  refundReceiptService.issue.mockResolvedValue({ id: 'receipt-1' });
});

const flush = () => new Promise(resolve => setImmediate(resolve));

describe('createPaypalOrder', () => {
  test('nominal : crée une order PayPal et persiste paypal_order_id', async () => {
    const order = { id: 'order-1', reference: 'KMC-001', total_eur: '49.90' };
    const paypal = {
      createOrder: jest.fn().mockResolvedValue({ id: 'PP-ORDER-1', status: 'CREATED' }),
    };

    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE orders SET paypal_order_id

    const result = await createPaypalOrder(order, paypal, makeDb());

    expect(paypal.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ amountEur: 49.9, reference: 'KMC-001' })
    );
    expect(result.paypal_order_id).toBe('PP-ORDER-1');
    expect(mockDbQuery).toHaveBeenCalledWith(
      'UPDATE orders SET paypal_order_id = $1 WHERE id = $2',
      ['PP-ORDER-1', 'order-1']
    );
  });
});

describe('capturePaypalOrder — amount mismatch', () => {
  test('refuse la capture si montant capturé != total_eur (>1 centime)', async () => {
    const order = { id: 'order-2', reference: 'KMC-002', total_eur: '49.90', payment_status: 'pending' };
    const paypal = {
      captureOrder: jest.fn().mockResolvedValue({ raw: true }),
      extractCaptureInfo: jest.fn().mockReturnValue({
        status: 'COMPLETED',
        amount_value: 10.00,
        paypal_capture_id: 'CAP-1',
      }),
    };

    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // INSERT alerts

    const result = await capturePaypalOrder('PP-ORDER-2', order, paypal, makeDb());

    expect(result.amount_mismatch).toBe(true);
    expect(result.expected).toBe(49.9);
    expect(result.actual).toBe(10.00);
    expect(mockDbQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO alerts'),
      expect.any(Array)
    );
  });

  test('idempotence : retourne already_paid si order déjà payée', async () => {
    const order = { id: 'order-3', reference: 'KMC-003', total_eur: '10.00', payment_status: 'paid' };
    const paypal = { captureOrder: jest.fn(), extractCaptureInfo: jest.fn() };

    const result = await capturePaypalOrder('PP-ORDER-3', order, paypal, makeDb());

    expect(result.already_paid).toBe(true);
    expect(paypal.captureOrder).not.toHaveBeenCalled();
  });
});

describe('handlePaypalWebhookEvent — idempotence', () => {
  test('event déjà traité → { received: true, idempotent: true }', async () => {
    const event = { id: 'evt_1', event_type: 'PAYMENT.CAPTURE.COMPLETED' };
    const paypal = { verifyWebhookSignature: jest.fn().mockResolvedValue(true) };

    mockDbQuery.mockResolvedValueOnce({ rows: [{ 1: 1 }] }); // SELECT paypal_events_processed → seen

    const result = await handlePaypalWebhookEvent(event, '{}', {}, makeDb(), paypal);

    expect(result).toEqual({ received: true, idempotent: true });
  });

  test('signature invalide → { invalidSignature: true }', async () => {
    const event = { id: 'evt_2', event_type: 'PAYMENT.CAPTURE.COMPLETED' };
    const paypal = { verifyWebhookSignature: jest.fn().mockResolvedValue(false) };

    const result = await handlePaypalWebhookEvent(event, '{}', {}, makeDb(), paypal);

    expect(result).toEqual({ invalidSignature: true });
    expect(mockDbQuery).not.toHaveBeenCalled();
  });
});

describe('refundPaypalOrder', () => {
  test('404 si commande introuvable', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const result = await refundPaypalOrder({
      orderId: 'missing', amountEur: undefined, reason: undefined,
      adminUser: { id: 'admin-1' }, paypal: {}, db: makeDb(),
    });

    expect(result.status).toBe(404);
  });

  test('409 si pas de capture PayPal liée', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: 'order-4', reference: 'KMC-004', total_eur: '10.00', payment_status: 'paid', paypal_capture_id: null }],
    });

    const result = await refundPaypalOrder({
      orderId: 'order-4', adminUser: { id: 'admin-1' }, paypal: {}, db: makeDb(),
    });

    expect(result.status).toBe(409);
    expect(result.body.error).toMatch(/Pas de capture/);
  });

  test('409 si commande non payée', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: 'order-5', reference: 'KMC-005', total_eur: '10.00', payment_status: 'pending', paypal_capture_id: 'CAP-5' }],
    });

    const result = await refundPaypalOrder({
      orderId: 'order-5', adminUser: { id: 'admin-1' }, paypal: {}, db: makeDb(),
    });

    expect(result.status).toBe(409);
    expect(result.body.error).toMatch(/non payée/);
  });

  test('nominal : refund effectué', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'order-6', reference: 'KMC-006', total_eur: '10.00', payment_status: 'paid', paypal_capture_id: 'CAP-6' }] }) // SELECT order
      .mockResolvedValueOnce({ rows: [{ id: 'refund-1' }] })  // INSERT refunds RETURNING id
      .mockResolvedValueOnce({ rows: [] })                    // INSERT order_status_history
      .mockResolvedValueOnce({ rowCount: 1 })                 // markRefunded → UPDATE orders SET payment_status='refunded'...
      .mockResolvedValueOnce({ rowCount: 1 });                // UPDATE orders SET status='refunded' (I3, exception tracée)
    const paypal = {
      refundCapture: jest.fn().mockResolvedValue({ id: 'REFUND-1', status: 'COMPLETED' }),
    };

    const result = await refundPaypalOrder({
      orderId: 'order-6', amountEur: 10, reason: 'Client request',
      adminUser: { id: 'admin-1' }, paypal, db: makeDb(),
    });

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.refund_id).toBe('REFUND-1');
    expect(paypal.refundCapture).toHaveBeenCalledWith('CAP-6', expect.objectContaining({
      amountEur: 10, reason: 'Client request',
    }));

    // Post Sprint B/D-02 : recordExternalRefund et transitionOrderStatus sont mockés.
    // markRefunded (payment_status) est le seul db.query direct restant.
    const { recordExternalRefund } = require('../../services/refund-service');
    expect(recordExternalRefund).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      orderId: 'order-6', method: 'paypal',
    }));
    const { transitionOrderStatus } = require('../../services/order-status-machine');
    expect(transitionOrderStatus).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 'order-6', newStatus: 'refunded', source: 'refund_external',
    }));
  });

  test('502 si refundCapture échoue', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: 'order-7', reference: 'KMC-007', total_eur: '10.00', payment_status: 'paid', paypal_capture_id: 'CAP-7' }],
    });
    const paypal = {
      refundCapture: jest.fn().mockRejectedValue(new Error('paypal down')),
    };

    const result = await refundPaypalOrder({
      orderId: 'order-7', adminUser: { id: 'admin-1' }, paypal, db: makeDb(),
    });

    expect(result.status).toBe(502);
  });
});

describe('capturePaypalOrder — capture PayPal en échec', () => {
  test('paypal.captureOrder rejette → rethrow avec _paypalCaptureFailed', async () => {
    const order = { id: 'o-x', reference: 'KMC-X', total_eur: '10.00', payment_status: 'pending' };
    const paypal = { captureOrder: jest.fn().mockRejectedValue(new Error('paypal timeout')) };

    await expect(capturePaypalOrder('PP-X', order, paypal, makeDb()))
      .rejects.toMatchObject({ message: 'paypal timeout', _paypalCaptureFailed: true });
  });

  test('capture non-COMPLETED → { capture_not_completed: true, status }', async () => {
    const order = { id: 'o-y', reference: 'KMC-Y', total_eur: '10.00', payment_status: 'pending' };
    const paypal = {
      captureOrder: jest.fn().mockResolvedValue({}),
      extractCaptureInfo: jest.fn().mockReturnValue({ status: 'PENDING' }),
    };

    const result = await capturePaypalOrder('PP-Y', order, paypal, makeDb());
    expect(result).toEqual({ capture_not_completed: true, status: 'PENDING' });
  });

  test('mismatch montant : insertion alerte échoue → non-bloquant, amount_mismatch quand même renvoyé', async () => {
    const order = { id: 'o-z', reference: 'KMC-Z', total_eur: '49.90', payment_status: 'pending' };
    const paypal = {
      captureOrder: jest.fn().mockResolvedValue({}),
      extractCaptureInfo: jest.fn().mockReturnValue({ status: 'COMPLETED', amount_value: 1, paypal_capture_id: 'CAP-Z' }),
    };
    mockDbQuery.mockRejectedValueOnce(new Error('db down')); // INSERT alerts échoue

    const result = await capturePaypalOrder('PP-Z', order, paypal, makeDb());
    expect(result.amount_mismatch).toBe(true);
  });
});

describe('capturePaypalOrder — transaction complète (cycle paiement)', () => {
  function makeCompletedPaypal(overrides = {}) {
    return {
      captureOrder: jest.fn().mockResolvedValue({ raw: true }),
      extractCaptureInfo: jest.fn().mockReturnValue({
        status: 'COMPLETED',
        amount_value: 49.9,
        paypal_capture_id: 'CAP-OK',
        payer_email: 'client@example.com',
        payer_id: 'PAYER-1',
        payer_name: 'Client Test',
        pay_in_4: false,
        ...overrides,
      }),
    };
  }
  const order = { id: 'ord-ok', reference: 'KMC-OK', total_eur: '49.90', payment_status: 'pending' };

  test('nominal : cycle success → COMMIT, code retrait généré, cache post-commit, success:true', async () => {
    confirmPaymentCycle.mockResolvedValueOnce({ success: true, stockBlocked: false });
    mockClientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}) // UPDATE orders (persist infos paypal)
      .mockResolvedValueOnce({ rows: [{ relais_id: 'R-1' }] }) // SELECT relais_id
      .mockResolvedValueOnce({}); // COMMIT

    const result = await capturePaypalOrder('PP-OK', order, makeCompletedPaypal(), makeDb());

    expect(mockClientQuery).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(mockClientQuery).toHaveBeenNthCalledWith(4, 'COMMIT');
    expect(generateAndStoreSecret).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 'ord-ok', relaisId: 'R-1', channel: 'paypal',
    }));
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      success: true, order_id: 'ord-ok', order_reference: 'KMC-OK',
      pay_in_4_used: false, stock_blocked: false,
    });
    // post-commit, non-bloquant
    expect(cacheCodeForReveal).toHaveBeenCalledWith('ord-ok', 'TEST-CODE');
  });

  test('cycle noop (race avec webhook) → COMMIT + already_paid:true', async () => {
    confirmPaymentCycle.mockResolvedValueOnce({ noop: true });
    mockClientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}) // UPDATE orders COALESCE (noop)
      .mockResolvedValueOnce({}); // COMMIT

    const result = await capturePaypalOrder('PP-NOOP', order, makeCompletedPaypal(), makeDb());

    expect(result).toEqual({ already_paid: true, order_id: 'ord-ok', order_reference: 'KMC-OK' });
    expect(mockClientQuery).toHaveBeenNthCalledWith(3, 'COMMIT');
    expect(generateAndStoreSecret).not.toHaveBeenCalled();
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  test('cycle rejeté → ROLLBACK + alerte critique via db.query (pas client) + cycle_rejected:true', async () => {
    confirmPaymentCycle.mockResolvedValueOnce({ success: false, error: 'invalid_transition' });
    mockClientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}); // ROLLBACK
    mockDbQuery.mockResolvedValueOnce({}); // INSERT alerts (hors transaction, db pas client)

    const result = await capturePaypalOrder('PP-REJ', order, makeCompletedPaypal(), makeDb());

    expect(result).toEqual({ cycle_rejected: true, error: 'invalid_transition' });
    expect(mockClientQuery).toHaveBeenNthCalledWith(2, 'ROLLBACK');
    expect(mockDbQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO alerts'),
      expect.arrayContaining([expect.stringContaining('paypal_paid_but_cycle_failed')])
    );
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  test('cycle rejeté : l\'échec de l\'insertion alerte est avalé silencieusement', async () => {
    confirmPaymentCycle.mockResolvedValueOnce({ success: false, error: 'boom' });
    mockClientQuery.mockResolvedValueOnce({}).mockResolvedValueOnce({});
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));

    const result = await capturePaypalOrder('PP-REJ2', order, makeCompletedPaypal(), makeDb());
    expect(result).toEqual({ cycle_rejected: true, error: 'boom' });
  });

  test('stock bloqué : notes mises à jour + alerte critique + capture quand même COMMIT', async () => {
    confirmPaymentCycle.mockResolvedValueOnce({
      success: true, stockBlocked: true,
      insufficientItems: [{ product_name: 'Riz 5kg', available: 2, needed: 5 }],
    });
    mockClientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}) // UPDATE orders SET notes
      .mockResolvedValueOnce({}) // SAVEPOINT alert_stock_blocked
      .mockResolvedValueOnce({ rows: [{ id: 'alert-1' }] }) // INSERT alerts (createAlert, stockBlocked)
      .mockResolvedValueOnce({}) // RELEASE SAVEPOINT alert_stock_blocked
      .mockResolvedValueOnce({}) // UPDATE orders (persist infos paypal)
      .mockResolvedValueOnce({ rows: [{ relais_id: null }] }) // SELECT relais_id
      .mockResolvedValueOnce({}); // COMMIT

    const result = await capturePaypalOrder('PP-STOCK', order, makeCompletedPaypal(), makeDb());

    expect(result.stock_blocked).toBe(true);
    expect(result.success).toBe(true);
    expect(mockClientQuery).toHaveBeenNthCalledWith(2,
      expect.stringContaining('SET notes'), expect.any(Array));
    expect(mockClientQuery).toHaveBeenNthCalledWith(4,
      expect.stringContaining('INSERT INTO alerts'), expect.any(Array));
  });

  test('stock bloqué : échec insertion alerte est non-bloquant (capture continue)', async () => {
    confirmPaymentCycle.mockResolvedValueOnce({
      success: true, stockBlocked: true,
      insufficientItems: [{ product_name: 'X', available: 0, needed: 1 }],
    });
    mockClientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}) // UPDATE notes
      .mockResolvedValueOnce({}) // SAVEPOINT alert_stock_blocked
      .mockRejectedValueOnce(new Error('alert insert failed')) // INSERT alerts (createAlert) échoue
      .mockResolvedValueOnce({}) // ROLLBACK TO SAVEPOINT alert_stock_blocked (non-bloquant)
      .mockResolvedValueOnce({}) // UPDATE orders (persist)
      .mockResolvedValueOnce({ rows: [{ relais_id: null }] }) // SELECT relais_id
      .mockResolvedValueOnce({}); // COMMIT

    const result = await capturePaypalOrder('PP-STOCK2', order, makeCompletedPaypal(), makeDb());
    expect(result.success).toBe(true);
    expect(result.stock_blocked).toBe(true);
  });

  test('génération code retrait échoue → non-bloquant, pickupCode null, pas de cache post-commit', async () => {
    confirmPaymentCycle.mockResolvedValueOnce({ success: true, stockBlocked: false });
    generateAndStoreSecret.mockRejectedValueOnce(new Error('secret gen failed'));
    mockClientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}) // UPDATE orders (persist)
      .mockResolvedValueOnce({ rows: [{ relais_id: 'R-2' }] }) // SELECT relais_id
      .mockResolvedValueOnce({}); // COMMIT

    const result = await capturePaypalOrder('PP-NOCODE', order, makeCompletedPaypal(), makeDb());
    expect(result.success).toBe(true);
    expect(cacheCodeForReveal).not.toHaveBeenCalled();
  });

  test('erreur inattendue pendant la transaction → ROLLBACK puis rethrow, client toujours release', async () => {
    confirmPaymentCycle.mockResolvedValueOnce({ success: true, stockBlocked: false });
    mockClientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockRejectedValueOnce(new Error('db crashed mid-transaction')) // UPDATE orders (persist) explose
      .mockResolvedValueOnce({}); // ROLLBACK

    await expect(capturePaypalOrder('PP-CRASH', order, makeCompletedPaypal(), makeDb()))
      .rejects.toThrow('db crashed mid-transaction');
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });
});

describe('handlePaypalWebhookEvent — dispatch par event_type', () => {
  function baseDbNotSeen() {
    // SELECT paypal_events_processed → jamais vu
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
  }

  test('event_type non géré → markPaypalEventProcessed(ignored) + { received:true, ignored:true }', async () => {
    baseDbNotSeen();
    mockDbQuery.mockResolvedValueOnce({}); // INSERT paypal_events_processed (ignored)
    const paypal = { verifyWebhookSignature: jest.fn().mockResolvedValue(true) };

    const result = await handlePaypalWebhookEvent(
      { id: 'evt-x', event_type: 'SOME.UNKNOWN.EVENT' }, '{}', {}, makeDb(), paypal
    );

    expect(result).toEqual({ received: true, ignored: true });
    expect(mockDbQuery).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO paypal_events_processed'),
      expect.arrayContaining(['evt-x', 'SOME.UNKNOWN.EVENT'])
    );
  });

  test('PAYMENT.CAPTURE.COMPLETED sans capture_id → ignoré (no_capture_id)', async () => {
    baseDbNotSeen();
    mockDbQuery.mockResolvedValueOnce({}); // INSERT ignored
    const paypal = {
      verifyWebhookSignature: jest.fn().mockResolvedValue(true),
      extractCaptureInfo: jest.fn().mockReturnValue({}),
    };

    const result = await handlePaypalWebhookEvent(
      { id: 'evt-nc', event_type: 'PAYMENT.CAPTURE.COMPLETED' }, '{}', {}, makeDb(), paypal
    );

    expect(result).toEqual({ received: true });
    expect(mockDbQuery).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO paypal_events_processed'),
      expect.arrayContaining(['evt-nc'])
    );
  });

  test('PAYMENT.CAPTURE.COMPLETED sans order matching (3 stratégies épuisées) → ignoré order_not_found', async () => {
    baseDbNotSeen();
    mockDbQuery
      .mockResolvedValueOnce({ rows: [] }) // SELECT via capture_id
      .mockResolvedValueOnce({ rows: [] }) // SELECT via paypal_order_id
      .mockResolvedValueOnce({ rows: [] }) // SELECT via reference
      .mockResolvedValueOnce({}); // INSERT ignored
    const paypal = {
      verifyWebhookSignature: jest.fn().mockResolvedValue(true),
      extractCaptureInfo: jest.fn().mockReturnValue({
        paypal_capture_id: 'CAP-NF', paypal_order_id: 'PPORD-NF', reference_id: 'KMC-NF',
      }),
    };

    const result = await handlePaypalWebhookEvent(
      { id: 'evt-nf', event_type: 'PAYMENT.CAPTURE.COMPLETED' }, '{}', {}, makeDb(), paypal
    );
    expect(result).toEqual({ received: true });
  });

  test('PAYMENT.CAPTURE.COMPLETED, order déjà paid → noop, pas de transaction ouverte', async () => {
    baseDbNotSeen();
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'ord-paid', reference: 'KMC-P', payment_status: 'paid' }] })
      .mockResolvedValueOnce({}); // INSERT noop
    const paypal = {
      verifyWebhookSignature: jest.fn().mockResolvedValue(true),
      extractCaptureInfo: jest.fn().mockReturnValue({ paypal_capture_id: 'CAP-P' }),
    };

    const result = await handlePaypalWebhookEvent(
      { id: 'evt-p', event_type: 'PAYMENT.CAPTURE.COMPLETED' }, '{}', {}, makeDb(), paypal
    );
    expect(result).toEqual({ received: true });
    expect(mockConnect).not.toHaveBeenCalled();
  });

  test('PAYMENT.CAPTURE.COMPLETED, fallback webhook : cycle success → COMMIT + event marqué processed dans la tx', async () => {
    baseDbNotSeen();
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: 'ord-fb', reference: 'KMC-FB', payment_status: 'pending' }],
    });
    confirmPaymentCycle.mockResolvedValueOnce({ success: true, stockBlocked: false });
    mockClientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}) // UPDATE orders COALESCE paypal_capture_id
      .mockResolvedValueOnce({ rows: [{ pickup_secret_hash: 'already-set' }] }) // SELECT pickup_secret_hash (PICKUP-5 parity — déjà présent, pas de régénération)
      .mockResolvedValueOnce({}) // INSERT paypal_events_processed (processed, dans la tx)
      .mockResolvedValueOnce({}); // COMMIT
    const paypal = {
      verifyWebhookSignature: jest.fn().mockResolvedValue(true),
      extractCaptureInfo: jest.fn().mockReturnValue({ paypal_capture_id: 'CAP-FB' }),
    };

    const result = await handlePaypalWebhookEvent(
      { id: 'evt-fb', event_type: 'PAYMENT.CAPTURE.COMPLETED' }, '{}', {}, makeDb(), paypal
    );
    expect(result).toEqual({ received: true });
    expect(mockClientQuery).toHaveBeenNthCalledWith(5, 'COMMIT');
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  test('PAYMENT.CAPTURE.COMPLETED, fallback webhook : cycle noop → COMMIT + marqué noop', async () => {
    baseDbNotSeen();
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'ord-fbn', reference: 'KMC-FBN', payment_status: 'pending' }] })
      .mockResolvedValueOnce({}); // INSERT noop (hors tx, via markPaypalEventProcessed → db.query)
    confirmPaymentCycle.mockResolvedValueOnce({ noop: true });
    mockClientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}); // COMMIT

    const paypal = {
      verifyWebhookSignature: jest.fn().mockResolvedValue(true),
      extractCaptureInfo: jest.fn().mockReturnValue({ paypal_capture_id: 'CAP-FBN' }),
    };

    const result = await handlePaypalWebhookEvent(
      { id: 'evt-fbn', event_type: 'PAYMENT.CAPTURE.COMPLETED' }, '{}', {}, makeDb(), paypal
    );
    expect(result).toEqual({ received: true });
    expect(mockClientQuery).toHaveBeenNthCalledWith(2, 'COMMIT');
  });

  test('PAYMENT.CAPTURE.COMPLETED, fallback webhook : cycle rejeté → ROLLBACK + marqué rejected', async () => {
    baseDbNotSeen();
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'ord-fbr', reference: 'KMC-FBR', payment_status: 'pending' }] })
      .mockResolvedValueOnce({}); // INSERT rejected (hors tx)
    confirmPaymentCycle.mockResolvedValueOnce({ success: false, error: 'blocked' });
    mockClientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}); // ROLLBACK

    const paypal = {
      verifyWebhookSignature: jest.fn().mockResolvedValue(true),
      extractCaptureInfo: jest.fn().mockReturnValue({ paypal_capture_id: 'CAP-FBR' }),
    };

    const result = await handlePaypalWebhookEvent(
      { id: 'evt-fbr', event_type: 'PAYMENT.CAPTURE.COMPLETED' }, '{}', {}, makeDb(), paypal
    );
    expect(result).toEqual({ received: true });
    expect(mockClientQuery).toHaveBeenNthCalledWith(2, 'ROLLBACK');
  });

  test('PAYMENT.CAPTURE.COMPLETED, fallback webhook : erreur transaction → ROLLBACK + rethrow', async () => {
    baseDbNotSeen();
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: 'ord-fbc', reference: 'KMC-FBC', payment_status: 'pending' }],
    });
    confirmPaymentCycle.mockRejectedValueOnce(new Error('confirmPaymentCycle crash'));
    mockClientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}); // ROLLBACK

    const paypal = {
      verifyWebhookSignature: jest.fn().mockResolvedValue(true),
      extractCaptureInfo: jest.fn().mockReturnValue({ paypal_capture_id: 'CAP-FBC' }),
    };

    await expect(handlePaypalWebhookEvent(
      { id: 'evt-fbc', event_type: 'PAYMENT.CAPTURE.COMPLETED' }, '{}', {}, makeDb(), paypal
    )).rejects.toThrow('confirmPaymentCycle crash');
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['PAYMENT.CAPTURE.DENIED'],
    ['PAYMENT.CAPTURE.DECLINED'],
  ])('%s → alerte warning insérée + marqué processed (denied_logged)', async (eventType) => {
    baseDbNotSeen();
    mockDbQuery
      .mockResolvedValueOnce({}) // INSERT alerts (warning)
      .mockResolvedValueOnce({}); // INSERT paypal_events_processed
    const paypal = {
      verifyWebhookSignature: jest.fn().mockResolvedValue(true),
      extractCaptureInfo: jest.fn().mockReturnValue({ paypal_capture_id: 'CAP-D', reference_id: 'KMC-D' }),
    };

    const result = await handlePaypalWebhookEvent(
      { id: 'evt-d', event_type: eventType }, '{}', {}, makeDb(), paypal
    );
    expect(result).toEqual({ received: true });
    expect(mockDbQuery).toHaveBeenNthCalledWith(2,
      expect.stringContaining('INSERT INTO alerts'),
      expect.arrayContaining(['paypal_capture_denied', 'medium'])
    );
  });

  test('DENIED : insertion alerte échoue → non-bloquant, event quand même marqué processed', async () => {
    baseDbNotSeen();
    mockDbQuery
      .mockRejectedValueOnce(new Error('db down')) // INSERT alerts échoue
      .mockResolvedValueOnce({}); // INSERT paypal_events_processed
    const paypal = {
      verifyWebhookSignature: jest.fn().mockResolvedValue(true),
      extractCaptureInfo: jest.fn().mockReturnValue({}),
    };

    const result = await handlePaypalWebhookEvent(
      { id: 'evt-d2', event_type: 'PAYMENT.CAPTURE.DENIED' }, '{}', {}, makeDb(), paypal
    );
    expect(result).toEqual({ received: true });
  });

  test.each([
    ['PAYMENT.CAPTURE.REFUNDED'],
    ['PAYMENT.CAPTURE.REVERSED'],
  ])('%s → marqué processed (refund_acknowledged), pas d\'alerte', async (eventType) => {
    baseDbNotSeen();
    mockDbQuery.mockResolvedValueOnce({}); // INSERT paypal_events_processed
    const paypal = { verifyWebhookSignature: jest.fn().mockResolvedValue(true) };

    const result = await handlePaypalWebhookEvent(
      { id: 'evt-r', event_type: eventType }, '{}', {}, makeDb(), paypal
    );
    expect(result).toEqual({ received: true });
    expect(mockDbQuery).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO paypal_events_processed'),
      expect.arrayContaining(['evt-r', eventType])
    );
  });

  test.each([
    ['CUSTOMER.DISPUTE.CREATED'],
    ['CUSTOMER.DISPUTE.UPDATED'],
  ])('%s → alerte critique avec les infos du litige + marqué processed', async (eventType) => {
    baseDbNotSeen();
    mockDbQuery
      .mockResolvedValueOnce({}) // INSERT alerts (critical)
      .mockResolvedValueOnce({}); // INSERT paypal_events_processed
    const paypal = { verifyWebhookSignature: jest.fn().mockResolvedValue(true) };
    const event = {
      id: 'evt-disp', event_type: eventType,
      resource: { dispute_id: 'DISP-1', dispute_state: 'OPEN', reason: 'MERCHANDISE_NOT_RECEIVED', dispute_amount: {} },
    };

    const result = await handlePaypalWebhookEvent(event, '{}', {}, makeDb(), paypal);
    expect(result).toEqual({ received: true });
    expect(mockDbQuery).toHaveBeenNthCalledWith(2,
      expect.stringContaining('INSERT INTO alerts'),
      expect.arrayContaining(['paypal_dispute', 'high'])
    );
  });

  test('DISPUTE : insertion alerte échoue → non-bloquant, event quand même marqué', async () => {
    baseDbNotSeen();
    mockDbQuery
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({});
    const paypal = { verifyWebhookSignature: jest.fn().mockResolvedValue(true) };

    const result = await handlePaypalWebhookEvent(
      { id: 'evt-disp2', event_type: 'CUSTOMER.DISPUTE.CREATED', resource: {} }, '{}', {}, makeDb(), paypal
    );
    expect(result).toEqual({ received: true });
  });

  test('SELECT paypal_events_processed indisponible → tolère et continue le dispatch (pas idempotent-bloquant)', async () => {
    mockDbQuery
      .mockRejectedValueOnce(new Error('table absente')) // SELECT paypal_events_processed échoue
      .mockResolvedValueOnce({}); // INSERT paypal_events_processed (refund/reversed, pas d'alerte)
    const paypal = { verifyWebhookSignature: jest.fn().mockResolvedValue(true) };

    const result = await handlePaypalWebhookEvent(
      { id: 'evt-tol', event_type: 'PAYMENT.CAPTURE.REVERSED' }, '{}', {}, makeDb(), paypal
    );
    expect(result).toEqual({ received: true });
  });
});

describe('refundPaypalOrder — validations montant', () => {
  test('400 si amountEur fourni invalide (NaN / <=0)', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: 'o-inv', reference: 'KMC-INV', total_eur: '10.00', payment_status: 'paid', paypal_capture_id: 'CAP-INV' }],
    });
    const result = await refundPaypalOrder({
      orderId: 'o-inv', amountEur: -5, adminUser: { id: 'a1' }, paypal: {}, db: makeDb(),
    });
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/amountEur invalide/);
  });

  test('400 si montant refund > total commande (au-delà de la tolérance)', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: 'o-over', reference: 'KMC-OVER', total_eur: '10.00', payment_status: 'paid', paypal_capture_id: 'CAP-OVER' }],
    });
    const result = await refundPaypalOrder({
      orderId: 'o-over', amountEur: 50, adminUser: { id: 'a1' }, paypal: {}, db: makeDb(),
    });
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/supérieur au total/);
  });

  test('refund partiel : amountKmf calculé au prorata (pas full refund)', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{
        id: 'o-part', reference: 'KMC-PART', total_eur: '100.00', total_kmf: '50000',
        payment_status: 'paid', paypal_capture_id: 'CAP-PART',
      }] })
      .mockResolvedValueOnce({ rows: [{ id: 'refund-part' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 });
    const paypal = { refundCapture: jest.fn().mockResolvedValue({ id: 'REFUND-PART', status: 'COMPLETED' }) };

    const result = await refundPaypalOrder({
      orderId: 'o-part', amountEur: 25, reason: 'partial', adminUser: { id: 'a1' }, paypal, db: makeDb(),
    });

    expect(result.status).toBe(200);
    // 25/100 * 50000 = 12500 → vérifié via le mock recordExternalRefund
    const { recordExternalRefund } = require('../../services/refund-service');
    expect(recordExternalRefund).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      orderId: 'o-part', amountKmf: 12500, amountEur: 25, refundType: 'partial',
    }));
  });

  test('échec de l\'émission du reçu de remboursement est non-bloquant (log warn, pas de throw)', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{
        id: 'o-receipt', reference: 'KMC-RCPT', total_eur: '10.00', payment_status: 'paid', paypal_capture_id: 'CAP-RCPT',
      }] })
      .mockResolvedValueOnce({ rows: [{ id: 'refund-rcpt' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 });
    const paypal = { refundCapture: jest.fn().mockResolvedValue({ id: 'REFUND-RCPT', status: 'COMPLETED' }) };

    const result = await refundPaypalOrder({
      orderId: 'o-receipt', adminUser: { id: 'a1' }, paypal, db: makeDb(),
    });

    expect(result.status).toBe(200);
    // le .catch() interne du fire-and-forget est vérifié indirectement : pas de rejet propagé
  });
});

describe('Lot A — dernières branches d\'erreur non-bloquantes', () => {
  test('cacheCodeForReveal rejette après COMMIT → catch avalé, ne fait pas planter la capture', async () => {
    const order = { id: 'ord-cache', reference: 'KMC-CACHE', total_eur: '10.00', payment_status: 'pending' };
    const paypal = {
      captureOrder: jest.fn().mockResolvedValue({}),
      extractCaptureInfo: jest.fn().mockReturnValue({
        status: 'COMPLETED', amount_value: 10, paypal_capture_id: 'CAP-CACHE', pay_in_4: false,
      }),
    };
    confirmPaymentCycle.mockResolvedValueOnce({ success: true, stockBlocked: false });
    cacheCodeForReveal.mockRejectedValueOnce(new Error('cache down'));
    mockClientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}) // UPDATE orders (persist)
      .mockResolvedValueOnce({ rows: [{ relais_id: null }] }) // SELECT relais_id
      .mockResolvedValueOnce({}); // COMMIT

    const result = await capturePaypalOrder('PP-CACHE', order, paypal, makeDb());
    expect(result.success).toBe(true);
    await flush(); // laisse le .catch() du fire-and-forget s'exécuter
  });

  test('markPaypalEventProcessed (chemin ignored du dispatch) : INSERT échoue → log.warn avalé, pas de throw', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [] }) // SELECT paypal_events_processed → pas vu
      .mockRejectedValueOnce(new Error('insert failed')); // INSERT paypal_events_processed échoue
    const paypal = { verifyWebhookSignature: jest.fn().mockResolvedValue(true) };

    const result = await handlePaypalWebhookEvent(
      { id: 'evt-markfail', event_type: 'SOME.UNKNOWN.EVENT' }, '{}', {}, makeDb(), paypal
    );
    expect(result).toEqual({ received: true, ignored: true });
  });

  test('refundReceiptService.issue rejette → non-bloquant, refund reste 200 (catch avalé)', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{
        id: 'o-rcpt-fail', reference: 'KMC-RCPTFAIL', total_eur: '10.00',
        payment_status: 'paid', paypal_capture_id: 'CAP-RCPTFAIL',
      }] })
      .mockResolvedValueOnce({ rows: [{ id: 'refund-rcptfail' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 });
    refundReceiptService.issue.mockRejectedValueOnce(new Error('pdf gen failed'));
    const paypal = { refundCapture: jest.fn().mockResolvedValue({ id: 'REFUND-RCPTFAIL', status: 'COMPLETED' }) };

    const result = await refundPaypalOrder({
      orderId: 'o-rcpt-fail', adminUser: { id: 'a1' }, paypal, db: makeDb(),
    });

    expect(result.status).toBe(200);
    await flush(); // laisse le .catch() du fire-and-forget s'exécuter
  });
});
