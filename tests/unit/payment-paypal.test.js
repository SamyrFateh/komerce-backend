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

jest.mock('../../routes/pickup-secret', () => ({
  generateAndStoreSecret: jest.fn().mockResolvedValue({ code: 'TEST-CODE' }),
  cacheCodeForReveal: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/notification-service', () => ({
  notifyPaymentConfirmed: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../routes/purchasing', () => ({
  triggerPurchasing: jest.fn().mockResolvedValue({ ok: true }),
}));

const {
  createPaypalOrder,
  capturePaypalOrder,
  handlePaypalWebhookEvent,
  refundPaypalOrder,
} = require('../../services/payment-paypal');

const mockDbQuery = jest.fn();
const makeDb = () => ({ query: mockDbQuery, pool: { connect: jest.fn() } });

beforeEach(() => {
  mockDbQuery.mockReset();
});

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

    // P3-A.4 : payment_status passe par markRefunded (payment-service.js),
    // status reste une mutation directe distincte (I3, exception documentée).
    expect(mockDbQuery).toHaveBeenNthCalledWith(4,
      `UPDATE orders SET payment_status = 'refunded', updated_at = NOW() WHERE id = $1`,
      ['order-6']
    );
    expect(mockDbQuery).toHaveBeenNthCalledWith(5,
      `UPDATE orders SET status = 'refunded' WHERE id = $1`,
      ['order-6']
    );
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
