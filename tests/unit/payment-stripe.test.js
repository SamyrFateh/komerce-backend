/**
 * KOMERCE — Tests Unitaires : payment-stripe (R5)
 *
 * Couvre createStripeIntent et handleStripePaymentFailed.
 * Les chemins de handleStripeSucceeded sont déjà couverts par
 * tests/unit/payments-webhook.test.js.
 *
 * Run : npx jest tests/unit/payment-stripe.test.js
 */

'use strict';

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({
  query: (...args) => mockDbQuery(...args),
}));

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

jest.mock('../../routes/pickup-secret', () => ({
  generateAndStoreSecret: jest.fn().mockResolvedValue({ code: 'TEST-CODE' }),
  cacheCodeForReveal: jest.fn().mockResolvedValue(undefined),
}));

const {
  createStripeIntent,
  handleStripePaymentFailed,
} = require('../../services/payment-stripe');

describe('createStripeIntent', () => {
  beforeEach(() => {
    mockDbQuery.mockReset();
  });

  test('réutilise un PaymentIntent existant si statut réutilisable', async () => {
    const order = {
      id: 'order-1',
      reference: 'KMC-001',
      total_eur: '49.90',
      stripe_payment_id: 'pi_existing',
    };

    const stripe = {
      paymentIntents: {
        retrieve: jest.fn().mockResolvedValue({
          id: 'pi_existing',
          status: 'requires_payment_method',
          client_secret: 'secret_existing',
          amount: 4990,
        }),
        create: jest.fn(),
      },
    };

    const result = await createStripeIntent(order, stripe, { query: mockDbQuery });

    expect(result.reused).toBe(true);
    expect(result.client_secret).toBe('secret_existing');
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  test('crée un nouvel intent si aucun stripe_payment_id existant', async () => {
    const order = {
      id: 'order-2',
      reference: 'KMC-002',
      total_eur: '10.00',
      stripe_payment_id: null,
    };

    const stripe = {
      paymentIntents: {
        retrieve: jest.fn(),
        create: jest.fn().mockResolvedValue({
          id: 'pi_new',
          client_secret: 'secret_new',
        }),
      },
    };

    mockDbQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const result = await createStripeIntent(order, stripe, { query: mockDbQuery });

    expect(stripe.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1000, currency: 'eur' }),
      expect.objectContaining({ idempotencyKey: 'order_pi_order-2' })
    );
    expect(mockDbQuery).toHaveBeenCalledWith(
      'UPDATE orders SET stripe_payment_id = $1 WHERE id = $2',
      ['pi_new', 'order-2']
    );
    expect(result.client_secret).toBe('secret_new');
    expect(result.reused).toBeUndefined();
  });

  test('crée un nouvel intent si retrieve échoue', async () => {
    const order = {
      id: 'order-3',
      reference: 'KMC-003',
      total_eur: '20.00',
      stripe_payment_id: 'pi_broken',
    };

    const stripe = {
      paymentIntents: {
        retrieve: jest.fn().mockRejectedValue(new Error('not found')),
        create: jest.fn().mockResolvedValue({
          id: 'pi_new2',
          client_secret: 'secret_new2',
        }),
      },
    };

    mockDbQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const result = await createStripeIntent(order, stripe, { query: mockDbQuery });

    expect(stripe.paymentIntents.create).toHaveBeenCalled();
    expect(result.client_secret).toBe('secret_new2');
  });
});

describe('handleStripePaymentFailed — guard ne pas dégrader paid → failed', () => {
  beforeEach(() => {
    mockDbQuery.mockReset();
  });

  test('UPDATE conditionnel appliqué si payment_status = pending', async () => {
    const event = { id: 'evt_1', type: 'payment_intent.payment_failed' };
    const intent = { id: 'pi_1', metadata: { order_id: 'order-1', order_reference: 'KMC-001' } };

    mockDbQuery
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE orders
      .mockResolvedValueOnce({ rows: [] });   // markStripeEventProcessed insert

    await handleStripePaymentFailed(event, intent, { query: mockDbQuery });

    expect(mockDbQuery).toHaveBeenNthCalledWith(1,
      `UPDATE orders SET payment_status = 'failed'
     WHERE id = $1 AND payment_status = 'pending'`,
      ['order-1']
    );
  });

  test('ignoré si order_id absent des métadonnées', async () => {
    const event = { id: 'evt_2', type: 'payment_intent.payment_failed' };
    const intent = { id: 'pi_2', metadata: {} };

    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // markStripeEventProcessed insert

    await handleStripePaymentFailed(event, intent, { query: mockDbQuery });

    // Une seule query : markStripeEventProcessed (pas d'UPDATE orders)
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  test('rowCount=0 si déjà paid : pas de dégradation', async () => {
    const event = { id: 'evt_3', type: 'payment_intent.payment_failed' };
    const intent = { id: 'pi_3', metadata: { order_id: 'order-9', order_reference: 'KMC-009' } };

    mockDbQuery
      .mockResolvedValueOnce({ rowCount: 0 }) // UPDATE orders — aucune ligne (déjà paid)
      .mockResolvedValueOnce({ rows: [] });   // markStripeEventProcessed

    await handleStripePaymentFailed(event, intent, { query: mockDbQuery });

    expect(mockDbQuery).toHaveBeenCalledTimes(2);
  });
});
