'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 *
 * Stripe P3 — public API + real DB pipeline.
 *
 * Provider network is the ONLY replaced boundary here. The fake Stripe client
 * implements the exact P2-qualified PaymentIntent contract. Everything from
 * HTTP auth/validation through order lookup, canonical mapping, persistence
 * and replay/read-back runs through real Komerce code and a real Postgres.
 */

const request = require('supertest');
const express = require('express');
const { signAuthToken } = require('../../utils/auth-session');
const {
  createUser,
  createTestRelais,
  createPendingOrder,
  cleanup,
  cleanupBusinessFixtures,
} = require('../integration/test-harness/seed-helpers.EXTENDED');

const mockStripeClient = {
  paymentIntents: {
    create: jest.fn(),
    retrieve: jest.fn(),
  },
  webhooks: {
    constructEvent: jest.fn(),
  },
};

jest.mock('stripe', () => jest.fn(() => mockStripeClient));

const { describeE2E } = require('../helpers/e2eDbKit');

jest.setTimeout(30000);

describeE2E('Stripe P3 — public intent API + DB persistence', ({ db }) => {
  let app;
  let user;
  let relay;
  let order;
  let token;

  beforeAll(async () => {
    await cleanupBusinessFixtures();
    await cleanup();

    user = await createUser({ role: 'client' });
    relay = await createTestRelais();
    order = await createPendingOrder({
      user_id: user.id,
      relais_id: relay.id,
      total_kmf: 24500,
      total_eur: 49.90,
      payment_mode: 'stripe_eur',
    });

    token = signAuthToken(
      { id: user.id, role: 'client' },
      { method: 'stripe-p3-e2e' }
    );

    app = express();
    // This proof exercises only /stripe/intent. JSON parsing is intentionally
    // mounted before the payments router; webhook raw-body is proved in
    // orders.checkout-payment-cycle.e2e.test.js.
    app.use(express.json());
    app.use('/api/payments', require('../../routes/payments'));
    app.use((err, _req, res, _next) =>
      res.status(err.status || 500).json({ error: err.code || err.message })
    );
  });

  beforeEach(() => {
    mockStripeClient.paymentIntents.create.mockReset();
    mockStripeClient.paymentIntents.retrieve.mockReset();
  });

  afterAll(async () => {
    await cleanupBusinessFixtures();
    await cleanup();
  });

  it('creates through the public route, persists the exact Stripe external ref, then reuses by provider read-back', async () => {
    mockStripeClient.paymentIntents.create.mockImplementation(async (payload) => ({
      id: 'pi_p3_exact_1',
      status: 'requires_payment_method',
      client_secret: 'pi_p3_exact_1_secret',
      amount: payload.amount,
      currency: payload.currency,
      metadata: { ...payload.metadata },
    }));

    const first = await request(app)
      .post('/api/payments/stripe/intent')
      .set('Authorization', `Bearer ${token}`)
      .send({ order_reference: order.reference });

    expect(first.status).toBe(200);
    expect(first.body).toEqual({
      client_secret: 'pi_p3_exact_1_secret',
      amount_eur: '49.90',
      amount_cents: 4990,
      order_reference: order.reference,
    });

    expect(mockStripeClient.paymentIntents.create).toHaveBeenCalledTimes(1);
    expect(mockStripeClient.paymentIntents.create).toHaveBeenCalledWith({
      amount: 4990,
      currency: 'eur',
      metadata: {
        order_reference: order.reference,
        order_id: order.id,
        komerce: 'true',
      },
      description: `Komerce — Commande ${order.reference}`,
    }, {
      idempotencyKey: `order_pi_${order.id}`,
    });

    const { rows: [stored] } = await db.query(
      'SELECT stripe_payment_id, payment_status, status FROM orders WHERE id = $1',
      [order.id]
    );
    expect(stored.stripe_payment_id).toBe('pi_p3_exact_1');
    expect(stored.payment_status).toBe('pending');
    expect(stored.status).toBe('pending');

    mockStripeClient.paymentIntents.retrieve.mockResolvedValue({
      id: 'pi_p3_exact_1',
      status: 'requires_payment_method',
      client_secret: 'pi_p3_exact_1_secret',
      amount: 4990,
      currency: 'eur',
      metadata: {
        order_reference: order.reference,
        order_id: order.id,
        komerce: 'true',
      },
    });

    const replay = await request(app)
      .post('/api/payments/stripe/intent')
      .set('Authorization', `Bearer ${token}`)
      .send({ order_reference: order.reference });

    expect(replay.status).toBe(200);
    expect(replay.body.reused).toBe(true);
    expect(mockStripeClient.paymentIntents.retrieve).toHaveBeenCalledWith('pi_p3_exact_1');
    expect(mockStripeClient.paymentIntents.create).toHaveBeenCalledTimes(1);

    const { rows: [afterReplay] } = await db.query(
      'SELECT stripe_payment_id FROM orders WHERE id = $1',
      [order.id]
    );
    expect(afterReplay.stripe_payment_id).toBe('pi_p3_exact_1');
  });
});
