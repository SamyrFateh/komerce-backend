'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../utils/logger', () => ({ child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) }));
jest.mock('../../services/order-status-machine', () => ({ transitionOrderStatus: jest.fn() }));
jest.mock('../../utils/parcelSync', () => ({ safeSyncScanToParcels: jest.fn() }));

const { transitionOrderStatus } = require('../../services/order-status-machine');
const { safeSyncScanToParcels } = require('../../utils/parcelSync');
const { resolveQrCollection, issueOrRotateQrToken } = require('../../services/qr-collection-core');

describe('qr-collection-core', () => {
  beforeEach(() => jest.clearAllMocks());

  test('collection: commande absente -> rollback + 404', async () => {
    const client = { query: jest.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({}) };
    const out = await resolveQrCollection({ client, token: 'tok', user: { id: 'u1', role: 'customer' } });
    expect(out.ok).toBe(false);
    expect(out.response.status).toBe(404);
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
  });

  test('collection valide passe par la machine de statut et invalide le QR', async () => {
    const order = { id: 'o1', reference: 'K-1', status: 'available', qr_token: 'tok', qr_expires_at: new Date(Date.now() + 60000), relais_name: 'R1' };
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [order] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'scan-1' }] }) };
    transitionOrderStatus.mockResolvedValue({ success: true });
    safeSyncScanToParcels.mockResolvedValue(undefined);
    const out = await resolveQrCollection({ client, token: 'tok', user: { id: 'u1', role: 'customer' } });
    expect(out.ok).toBe(true);
    expect(transitionOrderStatus).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'o1', newStatus: 'collected', dbClient: client }));
    expect(client.query.mock.calls[1][0]).toContain('qr_token = NULL');
    expect(safeSyncScanToParcels).toHaveBeenCalledWith(expect.objectContaining({ order_id: 'o1', step: 'collected' }), client);
  });

  test('émission QR: rotation atomique sur commande available', async () => {
    const order = { id: 'o1', reference: 'K-1', status: 'available', qr_token: 'old' };
    const client = { query: jest.fn().mockResolvedValueOnce({ rows: [order] }).mockResolvedValueOnce({ rowCount: 1 }) };
    const out = await issueOrRotateQrToken({ client, orderId: 'o1', expirationHours: 1 });
    expect(out.ok).toBe(true);
    expect(out.rotated).toBe(true);
    expect(out.token).toMatch(/^[a-f0-9]{48}$/);
    expect(client.query.mock.calls[1][0]).toContain('UPDATE orders SET qr_token');
  });
});
