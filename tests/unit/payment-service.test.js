'use strict';
/**
 * Tests unitaires payment-service — déterministes, sans DB (client factice).
 * Valident la forme du SQL et les paramètres de chaque mutation.
 */
const svc = require('../../services/payment-service');

function fakeClient() {
  const calls = [];
  return { calls, query: async (text, params) => { calls.push({ text, params }); return { rowCount: 1 }; } };
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

  test('markFailed : aucune option ne permet de contourner la garde (guardPending retiré)', async () => {
    const c = fakeClient();
    await svc.markFailed(9, { client: c, guardPending: false });
    // guardPending n'existe plus dans la signature : ce paramètre est ignoré,
    // la garde reste posée.
    expect(c.calls[0].text).toMatch(/AND payment_status = 'pending'/);
  });

  test('retourne { changed, rowCount }', async () => {
    const c = fakeClient();
    const r = await svc.markFailed(9, { client: c });
    expect(r).toEqual({ changed: true, rowCount: 1 });
  });

  test('markPaid : sans paymentEvent, ne débloque que pending (pas failed)', async () => {
    const c = fakeClient();
    await svc.markPaid(42, { client: c });
    expect(c.calls[0].text).toMatch(/AND payment_status = 'pending'/);
  });

  test('markPaid : avec paymentEvent identifiable, débloque aussi failed→paid', async () => {
    const c = fakeClient();
    await svc.markPaid(42, { client: c, paymentEvent: { type: 'stripe_retry', externalId: 'pi_123' } });
    expect(c.calls[0].text).toMatch(/AND payment_status IN \('pending', 'failed'\)/);
  });

  test('markPaid : paymentEvent incomplet (sans externalId) ne débloque rien de plus', async () => {
    const c = fakeClient();
    await svc.markPaid(42, { client: c, paymentEvent: { type: 'stripe_retry' } });
    expect(c.calls[0].text).toMatch(/AND payment_status = 'pending'/);
  });

  test('markRefunded : garde source = paid uniquement (resserré réconciliation 2026-07-27 §4.5)', async () => {
    const c = fakeClient();
    await svc.markRefunded(7, { client: c });
    expect(c.calls[0].text).toMatch(/AND payment_status = 'paid'/);
  });
});
