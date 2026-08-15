'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const mockQuery = jest.fn();
const mockEmitOrderMilestone = jest.fn();
const mockResolveOrderMilestones = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));
jest.mock('../../utils/logger', () => ({ child: () => ({ info: jest.fn(), error: jest.fn() }) }));
jest.mock('../../services/product-admin-service', () => ({ adjustStock: jest.fn() }));
jest.mock('../../services/customs-shipment-service', () => ({ isCustomsDeclaredForOrder: jest.fn().mockResolvedValue({ allowed: true }) }));
jest.mock('../../services/client-notification-service', () => ({
  emitOrderMilestone: (...args) => mockEmitOrderMilestone(...args),
  resolveOrderMilestones: (...args) => mockResolveOrderMilestones(...args),
}));
const { transitionOrderStatus } = require('../../services/order-status-machine');

beforeEach(() => {
  jest.clearAllMocks();
  mockEmitOrderMilestone.mockResolvedValue(null);
  mockResolveOrderMilestones.mockResolvedValue(1);
});

test('projette une seule notification essentielle après passage disponible', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{
      id: 'order-1', status: 'in_transit', payment_mode: 'wallet', relais_id: 'relay-1',
      pickup_secret_hash: 'already-generated', user_id: 'user-1', reference: 'K7A78R6', relais_name: 'Moroni',
    }] })
    .mockResolvedValue({ rows: [], rowCount: 1 });
  const result = await transitionOrderStatus({
    orderId: 'order-1', newStatus: 'available', actor: { id: 'admin-1', role: 'admin' }, source: 'patch',
  });
  expect(result.success).toBe(true);
  expect(mockEmitOrderMilestone).toHaveBeenCalledWith(expect.objectContaining({
    status: 'available', userId: 'user-1', orderId: 'order-1', orderReference: 'K7A78R6', relaisName: 'Moroni',
  }));
});

test('résout la notification quand le colis est retiré', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{
      id: 'order-1', status: 'available', payment_mode: 'wallet', relais_id: 'relay-1',
      pickup_secret_hash: 'hash', user_id: 'user-1', reference: 'K7A78R6', relais_name: 'Moroni',
    }] })
    .mockResolvedValue({ rows: [], rowCount: 1 });
  await transitionOrderStatus({
    orderId: 'order-1', newStatus: 'collected', actor: { id: 'relay-1', role: 'agent_relais' }, source: 'patch',
  });
  expect(mockResolveOrderMilestones).toHaveBeenCalledWith('order-1', expect.any(Object));
});

test.each([
  ['ordered', 'preparation'],
  ['preparation', 'shipped'],
])('projette aussi le passage %s vers %s', async (previousStatus, newStatus) => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{
      id: 'order-1', status: previousStatus, payment_mode: 'wallet', relais_id: 'relay-1',
      pickup_secret_hash: 'hash', user_id: 'user-1', reference: 'K7A78R6', relais_name: 'Moroni',
    }] })
    .mockResolvedValue({ rows: [], rowCount: 1 });
  await transitionOrderStatus({
    orderId: 'order-1', newStatus, actor: { id: 'admin-1', role: 'admin' }, source: 'patch',
  });
  expect(mockEmitOrderMilestone).toHaveBeenCalledWith(expect.objectContaining({ status: newStatus }));
});
