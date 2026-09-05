'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Tests unitaires payment-service — déterministes, sans DB (client factice).
 * Valident la forme du SQL et les paramètres de chaque mutation.
 */
const svc = require('../../services/payment-service');

function fakeClient(rowCount = 1) {
  const calls = [];
  return { calls, query: async (text, params) => { calls.push({ text, params }); return { rowCount }; } };
}

describe('payment-service', () => {
  test('markPaid : payment_status=paid + updated_at, sans cash par défaut', async () => {
    const c = fakeClient();
    await svc.markPaid(42, { client: c });
    expect(c.calls[0].text).toMatch(/payment_status = 'paid'/);
    expect(c.calls[0].text).toMatch(/updated_at = NOW\(\)/);
    expect(c.calls[0].text).not.toMatch(/cash_paid_at/);
    expect(c.calls[0].params).toEqual([42]);
  });

  test('markPaid cashPaidAt : ajoute cash_paid_at', async () => {
    const c = fakeClient();
    await svc.markPaid(42, { client: c, cashPaidAt: true });
    expect(c.calls[0].text).toMatch(/cash_paid_at = NOW\(\)/);
  });

  test('markRefunded : payment_status=refunded et NE touche PAS orders.status', async () => {
    const c = fakeClient();
    await svc.markRefunded(7, { client: c });
    expect(c.calls[0].text).toMatch(/payment_status = 'refunded'/);
    expect(c.calls[0].text).not.toMatch(/\bstatus\b\s*=/);
    expect(c.calls[0].params).toEqual([7]);
  });

  test('markFailed : garde payment_status=pending, non contournable', async () => {
    const c = fakeClient();
    await svc.markFailed(9, { client: c });
    expect(c.calls[0].text).toMatch(/AND payment_status = 'pending'/);
  });

  test('markFailed : aucune option ne permet de contourner la garde', async () => {
    const c = fakeClient();
    await svc.markFailed(9, { client: c, guardPending: false });
    expect(c.calls[0].text).toMatch(/AND payment_status = 'pending'/);
  });

  test('retourne { changed, rowCount }', async () => {
    const c = fakeClient();
    const r = await svc.markFailed(9, { client: c });
    expect(r).toEqual({ changed: true, rowCount: 1 });
  });

  test('markPaid : sans paymentEvent, ne débloque que pending', async () => {
    const c = fakeClient();
    await svc.markPaid(42, { client: c });
    expect(c.calls[0].text).toMatch(/AND payment_status = 'pending'/);
  });

  test('markPaid : avec paymentEvent identifiable, débloque aussi failed→paid', async () => {
    const c = fakeClient();
    await svc.markPaid(42, { client: c, paymentEvent: { type: 'stripe_retry', externalId: 'pi_123' } });
    expect(c.calls[0].text).toMatch(/AND payment_status IN \('pending', 'failed'\)/);
  });

  test('markPaid : paymentEvent incomplet ne débloque rien de plus', async () => {
    const c = fakeClient();
    await svc.markPaid(42, { client: c, paymentEvent: { type: 'stripe_retry' } });
    expect(c.calls[0].text).toMatch(/AND payment_status = 'pending'/);
  });

  test('markRefunded : garde source = paid uniquement', async () => {
    const c = fakeClient();
    await svc.markRefunded(7, { client: c });
    expect(c.calls[0].text).toMatch(/AND payment_status = 'paid'/);
  });

  describe('forcePaymentStatusForSimulation', () => {
    const oldKomerceEnv = process.env.KOMERCE_ENV;
    const oldNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
      if (oldKomerceEnv === undefined) delete process.env.KOMERCE_ENV;
      else process.env.KOMERCE_ENV = oldKomerceEnv;
      if (oldNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = oldNodeEnv;
    });

    test('non-production : centralise le write chaos chez payment-service', async () => {
      process.env.KOMERCE_ENV = 'development';
      const c = fakeClient();
      const r = await svc.forcePaymentStatusForSimulation('o1', 'pending', { client: c });
      expect(c.calls).toHaveLength(1);
      expect(c.calls[0].text).toMatch(/UPDATE orders SET payment_status = \$1/);
      expect(c.calls[0].params).toEqual(['pending', 'o1']);
      expect(r).toEqual({ changed: true, rowCount: 1 });
    });

    test('production : refuse avant toute requête SQL', async () => {
      process.env.KOMERCE_ENV = 'production';
      const c = fakeClient();
      await expect(
        svc.forcePaymentStatusForSimulation('o1', 'pending', { client: c })
      ).rejects.toMatchObject({ code: 'SIMULATION_PRODUCTION_FORBIDDEN' });
      expect(c.calls).toHaveLength(0);
    });

    test('refuse une cible hors contrat chaos', async () => {
      process.env.KOMERCE_ENV = 'development';
      const c = fakeClient();
      await expect(
        svc.forcePaymentStatusForSimulation('o1', 'refunded', { client: c })
      ).rejects.toMatchObject({ code: 'SIMULATION_PAYMENT_STATUS_INVALID' });
      expect(c.calls).toHaveLength(0);
    });
  });
});
