'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mutations = require('../../services/order-mutation-service');

function executor(result = { rowCount: 1, rows: [] }) {
  return {
    query: jest.fn(async () => result),
  };
}

describe('order-mutation-service', () => {
  test('requires caller-owned executor', async () => {
    await expect(
      mutations.setWalletApplied(null, { orderId: 'o1', amountKmf: 100 }),
    ).rejects.toThrow('executor.query requis');
  });

  test('inventory completion persists only order completion fields', async () => {
    const q = executor();
    await mutations.setInventoryCompletion(q, {
      orderId: 'o1', itemsReceived: 2, itemsTotal: 3, completionRatio: 2 / 3,
    });
    expect(q.query).toHaveBeenCalledTimes(1);
    expect(q.query.mock.calls[0][0]).toContain('items_received = $2');
    expect(q.query.mock.calls[0][1]).toEqual(['o1', 2, 3, 2 / 3]);
  });

  test('customs recomputation stays on the caller transaction executor', async () => {
    const q = executor();
    await mutations.recomputeCustomsCosts(q, { orderIds: ['o1', 'o2'] });
    expect(q.query).toHaveBeenCalledTimes(2);
    expect(q.query.mock.calls[0][0]).toContain('customs_shipment_parcels');
    expect(q.query.mock.calls[1][0]).toContain('margin_real_pct');
    expect(q.query.mock.calls[0][1]).toEqual([['o1', 'o2']]);
  });





  test('stripe idempotency guard is preserved', async () => {
    const q = executor();
    await mutations.setStripePaymentId(q, {
      orderId: 'o1', stripePaymentId: 'pi_1', onlyIfEmptyOrSame: true,
    });
    expect(q.query.mock.calls[0][0]).toContain(
      '(stripe_payment_id IS NULL OR stripe_payment_id = $1)',
    );
    expect(q.query.mock.calls[0][1]).toEqual(['pi_1', 'o1']);
  });

  test('wallet mutation is narrow and caller-executed', async () => {
    const q = executor();
    await mutations.setWalletApplied(q, { orderId: 'o1', amountKmf: 2500 });
    expect(q.query.mock.calls[0][0]).toContain('wallet_applied_kmf = $1');
    expect(q.query.mock.calls[0][1]).toEqual([2500, 'o1']);
  });

  test('pickup secret accepts known fields only', async () => {
    const q = executor();
    await mutations.writePickupSecret(q, {
      orderId: 'o1',
      fields: {
        pickup_secret_hash: 'hash',
        pickup_secret_salt: 'salt',
        stripe_card_last4: '4242',
      },
    });
    const [sql, params] = q.query.mock.calls[0];
    expect(sql).toContain('pickup_secret_hash = $1');
    expect(sql).toContain('pickup_secret_salt = $2');
    expect(sql).toContain('stripe_card_last4 = $3');
    expect(params).toEqual(['hash', 'salt', '4242', 'o1']);
  });

  test('pickup secret rejects arbitrary order columns', async () => {
    const q = executor();
    await expect(mutations.writePickupSecret(q, {
      orderId: 'o1',
      fields: { status: 'collected' },
    })).rejects.toThrow('pickup column interdite');
    expect(q.query).not.toHaveBeenCalled();
  });

  test('pickup finalization only accepts the two collection methods', async () => {
    const q = executor();
    await mutations.finalizePickupCollection(q, {
      orderId: 'o1', method: 'PICKUP_CODE',
    });
    expect(q.query.mock.calls[0][0]).toContain("pickup_collected_via = 'PICKUP_CODE'");
    expect(q.query.mock.calls[0][1]).toEqual(['o1']);

    q.query.mockClear();

    await mutations.finalizePickupCollection(q, {
      orderId: 'o2',
      method: 'AUTHORIZED_NAME_ID_CHECK',
    });

    expect(q.query.mock.calls[0][0]).toContain(
      "pickup_collected_via = 'AUTHORIZED_NAME_ID_CHECK'"
    );
    expect(q.query.mock.calls[0][1]).toEqual(['o2']);

    await expect(mutations.finalizePickupCollection(q, {
      orderId: 'o1', method: 'ADMIN_BYPASS',
    })).rejects.toThrow('pickup collection method invalide');
  });

  test('reminder mutation is whitelisted', async () => {
    const q = executor();
    await mutations.markCashReminderSent(q, { orderId: 'o1', reminder: 'h12' });
    expect(q.query.mock.calls[0][0]).toContain('reminder_h12_sent = TRUE');
    await expect(
      mutations.markCashReminderSent(q, { orderId: 'o1', reminder: 'other' }),
    ).rejects.toThrow('reminder invalide');
  });
});
