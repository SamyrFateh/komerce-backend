/**
 * WAVE 1 — Stripe payment seams (REAL_DB_INTEGRATION).
 *
 * Lot R4 — W1-1 / W1-2 / W1-3 (docs/E2E_MASTER_VALIDATION_PLAN.md WAVE 1).
 *
 * Central lifecycle (confirmPaymentCycle, order-status-machine, stock,
 * pickup-secret) runs against a REAL Postgres, exactly as
 * post-o8-payments-seams.test.js does for PayPal. Only the fire-and-forget
 * POST-COMMIT hooks (loyalty/notif/invoice/purchasing) are spied — no real
 * WhatsApp/SMS/email IO. Stripe SDK itself is never called: we feed
 * handleStripeSucceeded() directly with a synthetic `intent`/`event`, exactly
 * as routes/payments.js does after Stripe's webhook signature check.
 *
 * W1-1 stripe-nominal REAL_DB   : commit métier réel post-SAVEPOINT (DEBT-02/FSF-05)
 * W1-2 stripe-stockBlocked REAL_DB : SAVEPOINT alerte + commande survit (P0-A réel)
 * W1-3 stripe-replay            : double webhook même event → 1 seul effet
 */

'use strict';

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);

if (!hasIntegrationEnv) {
  // Loud, explicit skip — never silent (mission §26).
  describe.skip('Stripe payment seams (REAL_DB) — SKIPPED: no DATABASE_URL', () => {
    it('requires DATABASE_URL', () => {});
  });
} else {
  const db = require('../../db');
  const { handleStripeSucceeded } = require('../../services/payment-stripe');
  const alertsUtil = require('../../utils/alerts');
  const loyaltyService = require('../../services/loyalty-service');
  const notifService = require('../../services/notification-service');
  const invoiceService = require('../../services/invoice-service');
  const {
    createTestRelais, createLegacyProduct, createPendingOrder, createOrderItem,
    cleanupBusinessFixtures,
  } = require('./test-harness/seed-helpers.EXTENDED');

  function stripeEvent(id) {
    return { id, type: 'payment_intent.succeeded' };
  }

  function stripeIntent({ orderId, orderReference, id = 'pi_itest_1' }) {
    return {
      id,
      metadata: { order_id: orderId, order_reference: orderReference, komerce: 'true' },
      receipt_email: 'itest@stripe.test',
      latest_charge: null,
    };
  }

  function spyHooks() {
    return {
      loyalty: jest.spyOn(loyaltyService, 'handleOrderConfirmed').mockResolvedValue({ skipped: true }),
      notif: jest.spyOn(notifService, 'notifyPaymentConfirmed').mockResolvedValue({ ok: true }),
      invoice: jest.spyOn(invoiceService, 'sendInvoiceReadyNotification').mockResolvedValue({ ok: true }),
    };
  }

  function fakeTriggerPurchasing() {
    return jest.fn().mockResolvedValue({ ok: true });
  }

  async function reloadOrder(id) {
    const { rows } = await db.query('SELECT * FROM orders WHERE id = $1', [id]);
    return rows[0];
  }

  async function stripeEventRow(eventId) {
    const { rows } = await db.query(
      'SELECT * FROM stripe_events_processed WHERE stripe_event_id = $1', [eventId]
    );
    return rows[0];
  }

  jest.setTimeout(30000);

  describe('WAVE 1 — Stripe post-commit business-effect proof (REAL_DB)', () => {
    let relais;

    beforeAll(async () => {
      await cleanupBusinessFixtures();
      relais = await createTestRelais();
    });

    afterEach(() => jest.restoreAllMocks());
    afterAll(async () => { await cleanupBusinessFixtures(); });

    // ── W1-1 — nominal ─────────────────────────────────────────────────────
    it('W1-1 STRIPE-NOMINAL — commit métier réel post-SAVEPOINT : order paid+ordered, stock décrémenté, hooks tirés une fois', async () => {
      const product = await createLegacyProduct({ stock: 10, price_kmf: 10000, price_eur: 20 });
      const order = await createPendingOrder({
        relais_id: relais.id, total_kmf: 10000, total_eur: 20,
        payment_mode: 'stripe_eur',
      });
      await createOrderItem({ order_id: order.id, product_id: product.id, quantity: 2, price_kmf: 10000 });

      const hooks = spyHooks();
      const triggerPurchasing = fakeTriggerPurchasing();
      const event = stripeEvent('EVT-itest-stripe-nominal-1');
      const intent = stripeIntent({ orderId: order.id, orderReference: order.reference, id: 'pi_itest_nominal_1' });

      const res = await handleStripeSucceeded(event, intent, db, triggerPurchasing);
      expect(res.received).toBe(true);

      const after = await reloadOrder(order.id);
      expect(after.payment_status).toBe('paid');
      expect(['confirmed', 'ordered']).toContain(after.status);
      expect(after.pickup_secret_hash).not.toBeNull();
      expect(after.stripe_billing_name === null || typeof after.stripe_billing_name === 'string').toBe(true);

      const { rows: [prod] } = await db.query('SELECT stock FROM products WHERE id=$1', [product.id]);
      expect(prod.stock).toBe(8); // 10 - 2, decremented exactly once

      const evtRow = await stripeEventRow('EVT-itest-stripe-nominal-1');
      expect(evtRow).toBeDefined();

      // Post-commit business effects fired exactly once (fire-and-forget, so
      // give the microtask queue a tick before asserting).
      await new Promise((r) => setTimeout(r, 50));
      expect(hooks.loyalty).toHaveBeenCalledTimes(1);
      expect(hooks.notif).toHaveBeenCalledTimes(1);
      expect(hooks.invoice).toHaveBeenCalledTimes(1);
      expect(triggerPurchasing).toHaveBeenCalledTimes(1);
      expect(triggerPurchasing).toHaveBeenCalledWith(order.id);
    });

    // ── W1-2 — stockBlocked / P0-A ─────────────────────────────────────────
    it('W1-2 STRIPE-STOCKBLOCKED — SAVEPOINT alerte échoue mais la commande (déjà encaissée) survit et COMMIT quand même (P0-A réel)', async () => {
      const product = await createLegacyProduct({ stock: 1, price_kmf: 10000, price_eur: 20 });
      const order = await createPendingOrder({
        relais_id: relais.id, total_kmf: 10000, total_eur: 20,
        payment_mode: 'stripe_eur',
      });
      // Need 5, only 1 in stock → stockBlocked path.
      await createOrderItem({ order_id: order.id, product_id: product.id, quantity: 5, price_kmf: 10000 });

      const hooks = spyHooks();
      const triggerPurchasing = fakeTriggerPurchasing();
      const event = stripeEvent('EVT-itest-stripe-stockblocked-1');
      const intent = stripeIntent({ orderId: order.id, orderReference: order.reference, id: 'pi_itest_stockblocked_1' });

      // Force the alert INSERT inside the SAVEPOINT to fail, to actually
      // prove the transaction survives it (not just that the happy path of
      // createAlert succeeding also happens to commit).
      const alertSpy = jest.spyOn(alertsUtil, 'createAlert').mockRejectedValue(new Error('itest: simulated alert insert failure'));

      const res = await handleStripeSucceeded(event, intent, db, triggerPurchasing);
      expect(res.received).toBe(true);

      // P0-A core claim: payment already captured by Stripe → order MUST
      // still be committed as paid, even though the alert insert failed.
      const after = await reloadOrder(order.id);
      expect(after.payment_status).toBe('paid');
      expect(after.notes).toMatch(/paid_but_stock_blocked/);

      // Stock must NOT have been decremented (insufficient stock path never
      // reaches adjustStock).
      const { rows: [prod] } = await db.query('SELECT stock FROM products WHERE id=$1', [product.id]);
      expect(prod.stock).toBe(1);

      const evtRow = await stripeEventRow('EVT-itest-stripe-stockblocked-1');
      expect(evtRow).toBeDefined();
      expect(evtRow.payload_summary.stock_blocked).toBe(true);

      // stockBlocked ⇒ processedOk=false in payment-stripe.js ⇒ post-commit
      // business hooks and purchasing must NOT fire (manual treatment only).
      await new Promise((r) => setTimeout(r, 50));
      expect(hooks.loyalty).not.toHaveBeenCalled();
      expect(hooks.notif).not.toHaveBeenCalled();
      expect(hooks.invoice).not.toHaveBeenCalled();
      expect(triggerPurchasing).not.toHaveBeenCalled();

      alertSpy.mockRestore();
    });

    // ── W1-3 — replay (double webhook, same event) ──────────────────────────
    it('W1-3 STRIPE-REPLAY — double webhook même event_id → un seul effet métier (idempotence)', async () => {
      const product = await createLegacyProduct({ stock: 10, price_kmf: 10000, price_eur: 20 });
      const order = await createPendingOrder({
        relais_id: relais.id, total_kmf: 10000, total_eur: 20,
        payment_mode: 'stripe_eur',
      });
      await createOrderItem({ order_id: order.id, product_id: product.id, quantity: 3, price_kmf: 10000 });

      const event = stripeEvent('EVT-itest-stripe-replay-1');
      const intent = stripeIntent({ orderId: order.id, orderReference: order.reference, id: 'pi_itest_replay_1' });

      // 1) first delivery
      const hooks1 = spyHooks();
      const trigger1 = fakeTriggerPurchasing();
      await handleStripeSucceeded(event, intent, db, trigger1);
      await new Promise((r) => setTimeout(r, 50));
      expect(hooks1.loyalty).toHaveBeenCalledTimes(1);
      expect(trigger1).toHaveBeenCalledTimes(1);
      jest.restoreAllMocks();

      const { rows: [prodAfterFirst] } = await db.query('SELECT stock FROM products WHERE id=$1', [product.id]);
      expect(prodAfterFirst.stock).toBe(7); // 10 - 3, once

      // 2) SAME Stripe event_id redelivered (Stripe's own retry semantics) →
      // must be a pure no-op: order already paid, nothing decremented twice,
      // no hooks re-fired.
      const hooks2 = spyHooks();
      const trigger2 = fakeTriggerPurchasing();
      const res2 = await handleStripeSucceeded(event, intent, db, trigger2);
      expect(res2.received).toBe(true);
      expect(res2.idempotent).toBe(true);

      const { rows: [prodAfterSecond] } = await db.query('SELECT stock FROM products WHERE id=$1', [product.id]);
      expect(prodAfterSecond.stock).toBe(7); // unchanged — decremented ONCE across both deliveries

      await new Promise((r) => setTimeout(r, 50));
      expect(hooks2.loyalty).not.toHaveBeenCalled();
      expect(hooks2.notif).not.toHaveBeenCalled();
      expect(hooks2.invoice).not.toHaveBeenCalled();
      expect(trigger2).not.toHaveBeenCalled();

      // stripe_events_processed: only the first delivery gets a row inserted
      // via the ON CONFLICT DO NOTHING path inside the transaction; the
      // second delivery short-circuits before reaching that INSERT
      // (already_paid guard) and instead marks it via markStripeEventProcessed
      // with a DIFFERENT summary — but since ON CONFLICT is on
      // stripe_event_id and the row already exists, it stays the ORIGINAL row.
      const evtRow = await stripeEventRow('EVT-itest-stripe-replay-1');
      expect(evtRow).toBeDefined();
      expect(evtRow.payload_summary.order_id).toBe(order.id);
    });
  });
}
