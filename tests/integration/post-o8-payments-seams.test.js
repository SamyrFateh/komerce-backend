/**
 * POST-O8 — Payments seams (REAL_DB_INTEGRATION).
 *
 * Central lifecycle (confirmPaymentCycle, order-status-machine, stock,
 * pickup-secret) runs against a REAL Postgres. Only the PROVIDER boundary
 * (paypal-client) and the fire-and-forget POST-COMMIT hooks are spied, so we
 * assert the seam ("is the hook invoked?") without real WhatsApp/supplier IO.
 *
 * Focus: PayPal post-commit business-effect parity (mission §9).
 * Baseline observation (docs/POST_O8_BUSINESS_SEMANTIC_AUDIT.md §PAYPAL_POSTCOMMIT):
 *   Stripe + cash fire loyalty + payment-notif + invoice-ready + purchasing
 *   post-commit; PayPal capture and webhook fallback fire NONE — contradicting
 *   the LOY-01 comment in order-payment-confirmation.js ("payment-paypal ×2").
 */

'use strict';

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);

if (!hasIntegrationEnv) {
  // Loud, explicit skip — never silent (mission §26).
  describe.skip('POST-O8 payments seams (REAL_DB) — SKIPPED: no DATABASE_URL', () => {
    it('requires DATABASE_URL', () => {});
  });
} else {
  const db = require('../../db');
  const paymentPaypal = require('../../services/payment-paypal');
  const loyaltyService = require('../../services/loyalty-service');
  const notifService = require('../../services/notification-service');
  const invoiceService = require('../../services/invoice-service');
  const purchasingTrigger = require('../../services/purchasing-trigger-service');
  const {
    createTestRelais, createLegacyProduct, createPendingOrder, createOrderItem,
    cleanupBusinessFixtures,
  } = require('./test-harness/seed-helpers');

  // Fake PayPal provider boundary — no network.
  function fakePaypal({ amountEur, captureId = 'CAP-itest-1', orderId = null }) {
    return {
      captureOrder: jest.fn().mockResolvedValue({ id: captureId, status: 'COMPLETED' }),
      extractCaptureInfo: jest.fn().mockReturnValue({
        status: 'COMPLETED',
        amount_value: amountEur,
        paypal_capture_id: captureId,
        paypal_order_id: orderId,
        payer_email: 'itest@paypal.test',
        payer_id: 'PAYER-1',
        payer_name: 'ITest Payer',
        pay_in_4: false,
      }),
      verifyWebhookSignature: jest.fn().mockResolvedValue(true),
    };
  }

  function spyHooks() {
    return {
      loyalty: jest.spyOn(loyaltyService, 'handleOrderConfirmed').mockResolvedValue({ skipped: true }),
      notif: jest.spyOn(notifService, 'notifyPaymentConfirmed').mockResolvedValue({ ok: true }),
      invoice: jest.spyOn(invoiceService, 'sendInvoiceReadyNotification').mockResolvedValue({ ok: true }),
      purchasing: jest.spyOn(purchasingTrigger, 'triggerPurchasing').mockResolvedValue({ ok: true }),
    };
  }

  async function reloadOrder(id) {
    const { rows } = await db.query('SELECT * FROM orders WHERE id = $1', [id]);
    return rows[0];
  }

  jest.setTimeout(30000);

  describe('POST-O8 — PayPal post-commit business-effect parity (REAL_DB)', () => {
    let relais;

    beforeAll(async () => {
      await cleanupBusinessFixtures();
      relais = await createTestRelais();
    });

    afterEach(() => jest.restoreAllMocks());
    afterAll(async () => { await cleanupBusinessFixtures(); });

    // ── PAYPAL-CAPTURE ────────────────────────────────────────────────────
    it('PAYPAL-CAPTURE — capture nominal fires loyalty + payment-notif + invoice-ready + purchasing exactly once', async () => {
      const product = await createLegacyProduct({ stock: 10, price_kmf: 10000, price_eur: 20 });
      const order = await createPendingOrder({
        relais_id: relais.id, total_kmf: 10000, total_eur: 20,
        payment_mode: 'paypal_eur', paypal_order_id: 'PP-ORDER-CAP-1',
      });
      await createOrderItem({ order_id: order.id, product_id: product.id, quantity: 2, price_kmf: 10000 });

      const hooks = spyHooks();
      const paypal = fakePaypal({ amountEur: 20, captureId: 'CAP-cap-1' });

      const result = await paymentPaypal.capturePaypalOrder('PP-ORDER-CAP-1', order, paypal, db);

      // Lifecycle proven against the REAL DB:
      expect(result.success).toBe(true);
      const after = await reloadOrder(order.id);
      expect(after.payment_status).toBe('paid');
      expect(['confirmed', 'ordered']).toContain(after.status);
      expect(after.paypal_capture_id).toBe('CAP-cap-1');
      expect(after.pickup_secret_hash).not.toBeNull();

      const { rows: [prod] } = await db.query('SELECT stock FROM products WHERE id=$1', [product.id]);
      expect(prod.stock).toBe(8); // 10 - 2, decremented exactly once

      // Post-commit business effects (the seam under audit):
      expect(hooks.loyalty).toHaveBeenCalledTimes(1);
      expect(hooks.notif).toHaveBeenCalledTimes(1);
      expect(hooks.invoice).toHaveBeenCalledTimes(1);
      expect(hooks.purchasing).toHaveBeenCalledTimes(1);
    });

    // ── PAYPAL-WEBHOOK-FALLBACK ───────────────────────────────────────────
    it('PAYPAL-WEBHOOK-FALLBACK — webhook confirms payment and fires the same post-commit effects once', async () => {
      const product = await createLegacyProduct({ stock: 10, price_kmf: 10000, price_eur: 20 });
      const order = await createPendingOrder({
        relais_id: relais.id, total_kmf: 10000, total_eur: 20,
        payment_mode: 'paypal_eur', paypal_order_id: 'PP-ORDER-WH-1',
      });
      await createOrderItem({ order_id: order.id, product_id: product.id, quantity: 1, price_kmf: 10000 });

      const hooks = spyHooks();
      const paypal = fakePaypal({ amountEur: 20, captureId: 'CAP-wh-1', orderId: 'PP-ORDER-WH-1' });

      const event = {
        id: 'EVT-itest-wh-1',
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: {},
      };

      const res = await paymentPaypal.handlePaypalWebhookEvent(
        event, JSON.stringify(event), {}, db, paypal
      );
      expect(res.received).toBe(true);

      const after = await reloadOrder(order.id);
      expect(after.payment_status).toBe('paid');
      // Pickup-secret parity (PICKUP-5): webhook fallback is the only path when
      // the capture endpoint never ran — it must still generate the code.
      expect(after.pickup_secret_hash).not.toBeNull();

      const { rows: [prod] } = await db.query('SELECT stock FROM products WHERE id=$1', [product.id]);
      expect(prod.stock).toBe(9); // decremented exactly once

      expect(hooks.loyalty).toHaveBeenCalledTimes(1);
      expect(hooks.notif).toHaveBeenCalledTimes(1);
      expect(hooks.invoice).toHaveBeenCalledTimes(1);
      expect(hooks.purchasing).toHaveBeenCalledTimes(1);
    });

    // ── PAYPAL-RACE — capture then duplicate webhook must not double-fire ──
    it('PAYPAL-RACE — capture then webhook (same payment) does not duplicate stock or post-commit effects', async () => {
      const product = await createLegacyProduct({ stock: 10, price_kmf: 10000, price_eur: 20 });
      const order = await createPendingOrder({
        relais_id: relais.id, total_kmf: 10000, total_eur: 20,
        payment_mode: 'paypal_eur', paypal_order_id: 'PP-ORDER-RACE-1',
      });
      await createOrderItem({ order_id: order.id, product_id: product.id, quantity: 1, price_kmf: 10000 });

      // 1) capture endpoint succeeds
      const hooks1 = spyHooks();
      await paymentPaypal.capturePaypalOrder(
        'PP-ORDER-RACE-1', order, fakePaypal({ amountEur: 20, captureId: 'CAP-race-1' }), db
      );
      expect(hooks1.purchasing).toHaveBeenCalledTimes(1);
      jest.restoreAllMocks();

      // 2) webhook for the SAME payment arrives afterwards → must be idempotent
      const hooks2 = spyHooks();
      const event = {
        id: 'EVT-itest-race-1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: {},
      };
      await paymentPaypal.handlePaypalWebhookEvent(
        event, JSON.stringify(event), {}, db,
        fakePaypal({ amountEur: 20, captureId: 'CAP-race-1', orderId: 'PP-ORDER-RACE-1' })
      );

      const { rows: [prod] } = await db.query('SELECT stock FROM products WHERE id=$1', [product.id]);
      expect(prod.stock).toBe(9); // decremented ONCE across capture+webhook

      // Already-paid → webhook must not re-fire post-commit effects.
      expect(hooks2.loyalty).not.toHaveBeenCalled();
      expect(hooks2.purchasing).not.toHaveBeenCalled();
    });
  });
}
