'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../services/order-status-machine', () => ({ transitionOrderStatus: jest.fn() }));
jest.mock('../../utils/parcels', () => ({ computeOrderStatus: jest.fn() }));
jest.mock('../../utils/logger', () => ({ child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })) }));

const { transitionOrderStatus } = require('../../services/order-status-machine');
const { computeOrderStatus } = require('../../utils/parcels');
const { evaluateOrderParcelLinkRules } = require('../../utils/orderParcelLinkRules');

describe('orderParcelLinkRules', () => {
  beforeEach(() => jest.clearAllMocks());

  function dbWith(parcels, orderRows = [{ id: 'order-001', status: 'available' }]) {
    return { query: jest.fn()
      .mockResolvedValueOnce({ rows: parcels })
      .mockResolvedValueOnce({ rows: orderRows }) };
  }

  it('retourne null sans colis ou sans commande', async () => {
    await expect(evaluateOrderParcelLinkRules('order-001', dbWith([]))).resolves.toBeNull();
    const db = { query: jest.fn().mockResolvedValueOnce({ rows: [{ status: 'available' }] }).mockResolvedValueOnce({ rows: [] }) };
    await expect(evaluateOrderParcelLinkRules('order-001', db)).resolves.toBeNull();
  });

  it('delegue a la machine et retourne R1 si tous collectes', async () => {
    const db = dbWith([{ status: 'collected' }], [{ id: 'order-001', status: 'available' }]);
    computeOrderStatus.mockReturnValueOnce('collected');
    transitionOrderStatus.mockResolvedValueOnce({ success: true, noop: false });

    await expect(evaluateOrderParcelLinkRules('order-001', db)).resolves.toBe('R1_ALL_COLLECTED');
    expect(transitionOrderStatus).toHaveBeenCalledWith({
      orderId: 'order-001', newStatus: 'collected', actor: { id: null, role: 'system' }, source: 'system', note: '[linkRules] computed=collected',
    });
  });

  it('retourne R3 si statut avance vers un autre statut', async () => {
    const db = dbWith([{ status: 'shipped' }], [{ id: 'order-001', status: 'confirmed' }]);
    computeOrderStatus.mockReturnValueOnce('shipped');
    transitionOrderStatus.mockResolvedValueOnce({ success: true, noop: false });

    await expect(evaluateOrderParcelLinkRules('order-001', db)).resolves.toBe('R3_STATUS_ADVANCED');
  });

  it('retourne null si transition refusee ou noop', async () => {
    const db1 = dbWith([{ status: 'shipped' }], [{ id: 'order-001', status: 'confirmed' }]);
    computeOrderStatus.mockReturnValueOnce('shipped');
    transitionOrderStatus.mockResolvedValueOnce({ success: false, noop: false });
    await expect(evaluateOrderParcelLinkRules('order-001', db1)).resolves.toBeNull();

    const db2 = dbWith([{ status: 'shipped' }], [{ id: 'order-001', status: 'confirmed' }]);
    computeOrderStatus.mockReturnValueOnce('shipped');
    transitionOrderStatus.mockResolvedValueOnce({ success: true, noop: true });
    await expect(evaluateOrderParcelLinkRules('order-001', db2)).resolves.toBeNull();
  });

  it('retourne R2 si tous les colis sont cancelled et commande non collected', async () => {
    const db = dbWith([{ status: 'cancelled' }, { status: 'cancelled' }], [{ id: 'order-001', status: 'available' }]);
    computeOrderStatus.mockReturnValueOnce('available');

    await expect(evaluateOrderParcelLinkRules('order-001', db)).resolves.toBe('R2_ALL_PARCELS_CANCELLED');
    expect(transitionOrderStatus).not.toHaveBeenCalled();
  });

  it('ne retourne pas R2 si la commande est deja collected', async () => {
    const db = dbWith([{ status: 'cancelled' }], [{ id: 'order-001', status: 'collected' }]);
    computeOrderStatus.mockReturnValueOnce('collected');

    await expect(evaluateOrderParcelLinkRules('order-001', db)).resolves.toBeNull();
  });
});
