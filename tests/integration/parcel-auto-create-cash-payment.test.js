'use strict';

// P3-A.1 — confirmCashAndCreateParcel doit produire le MÊME effet DB qu'avant
// la migration (payment_status='paid' + cash_paid_at posé), mais désormais
// via services/payment-service.js (markPaid) plutôt qu'un UPDATE inline.

const { makeClient, expectTransactionCommitted } = require('./test-harness/mock-db');

const mockDb = {
  getClient: jest.fn(),
  query: jest.fn(async () => ({ rows: [], rowCount: 0 })),
};

jest.mock('../../db', () => mockDb);

const mockTransitionOrderStatus = jest.fn();
jest.mock('../../services/order-status-machine', () => ({
  transitionOrderStatus: (...args) => mockTransitionOrderStatus(...args),
}));

describe('P3-A.1 confirmCashAndCreateParcel → payment-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    mockTransitionOrderStatus.mockResolvedValue({ success: true });
  });

  test('confirms cash payment via markPaid (payment_status=paid, cash_paid_at set) and commits', async () => {
    const order = {
      id: 'order-1',
      reference: 'KM-1',
      status: 'confirmed',
      payment_mode: 'cash_relais',
      payment_status: 'pending',
      total_kmf: 12000,
      user_id: 'user-1',
      customer_name: 'Client Test',
      customer_phone: '+269000000',
    };

    const client = makeClient([
      { rows: [order] },                                    // 1. SELECT order (confirmCashAndCreateParcel)
      { rows: [], rowCount: 1 },                             // 2. markPaid → UPDATE orders SET payment_status='paid'...
      { rows: [{ ...order, payment_status: 'paid', relais_id: null }] }, // 3. SELECT order (autoCreateParcel, relit l'état post-update)
      { rows: [] },                                          // 4. SELECT parcels WHERE order_id (pas de colis existant)
      { rows: [] },                                          // 5. SELECT order_items (aucun item → bail propre 'no_items')
    ]);
    mockDb.getClient.mockResolvedValue(client);

    const { confirmCashAndCreateParcel } = require('../../services/parcel-auto-create-service');

    const result = await confirmCashAndCreateParcel('KM-1', { id: 'agent-1', role: 'agent_relais', full_name: 'Agent' });

    // Le SQL exécuté doit être EXACTEMENT celui de markPaid({cashPaidAt:true}),
    // donc le même effet DB qu'avant la migration (P3-A.0 DoD : effet identique).
    const updateCall = client.calls.find(c => /UPDATE orders SET payment_status/.test(String(c.sql)));
    expect(updateCall).toBeDefined();
    expect(updateCall.sql).toMatch(/payment_status\s*=\s*'paid'/);
    expect(updateCall.sql).toMatch(/cash_paid_at\s*=\s*NOW\(\)/);
    expect(updateCall.sql).toMatch(/updated_at\s*=\s*NOW\(\)/);
    expect(updateCall.params).toEqual(['order-1']);

    // La confirmation de statut passe toujours par la machine à états (I3),
    // payment-service ne touche jamais orders.status.
    expect(mockTransitionOrderStatus).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 'order-1',
      newStatus: 'confirmed',
      source: 'cash_confirm',
      dbClient: client,
    }));

    expect(result.order).toEqual(order);
    expect(result.parcelResult).toEqual({ success: false, reason: 'no_items' });
    expectTransactionCommitted(client);
  });

  test('rolls back without touching payment_status if order is already paid', async () => {
    const order = {
      id: 'order-2',
      reference: 'KM-2',
      status: 'confirmed',
      payment_mode: 'cash_relais',
      payment_status: 'paid',
    };

    const client = makeClient([{ rows: [order] }]);
    mockDb.getClient.mockResolvedValue(client);

    const { confirmCashAndCreateParcel } = require('../../services/parcel-auto-create-service');

    await expect(
      confirmCashAndCreateParcel('KM-2', { id: 'agent-1', role: 'agent_relais' })
    ).rejects.toMatchObject({ status: 400 });

    expect(client.calls.some(c => /UPDATE orders SET payment_status/.test(String(c.sql)))).toBe(false);
    const sqls = client.calls.map(c => String(c.sql).trim());
    expect(sqls).toContain('ROLLBACK');
  });

  test('P5-N2/N3 : rolls back and does NOT create a parcel when payment_status is refunded (markPaid no-op)', async () => {
    // Angle mort corrigé : avant, seul payment_status==='paid' était exclu en
    // amont ; une commande 'refunded' ou 'failed' passait le garde-fou du
    // début de fonction, puis markPaid() faisait un no-op silencieux (garde
    // du validateur), et confirmCashAndCreateParcel continuait quand même
    // vers transitionOrderStatus + autoCreateParcel sur un paiement jamais
    // réellement acté.
    const order = {
      id: 'order-3',
      reference: 'KM-3',
      status: 'cancelled',
      payment_mode: 'cash_relais',
      payment_status: 'refunded',
      total_kmf: 5000,
      user_id: 'user-3',
    };

    const client = makeClient([
      { rows: [order] },       // 1. SELECT order
      { rows: [], rowCount: 0 }, // 2. markPaid → no-op (refunded n'est pas une source autorisée sans paymentEvent)
    ]);
    mockDb.getClient.mockResolvedValue(client);

    const { confirmCashAndCreateParcel } = require('../../services/parcel-auto-create-service');

    await expect(
      confirmCashAndCreateParcel('KM-3', { id: 'agent-1', role: 'agent_relais' })
    ).rejects.toMatchObject({ status: 409 });

    expect(mockTransitionOrderStatus).not.toHaveBeenCalled();
    const sqls = client.calls.map(c => String(c.sql).trim());
    expect(sqls).toContain('ROLLBACK');
  });
});
