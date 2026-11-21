/** @test-kind unit @test-runner jest @test-requires none */
'use strict';

const mockMarkets = jest.fn();
jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../services/market-delegation-service', () => ({
  listAuthorizedMarketsForCapability: (...args) => mockMarkets(...args),
}));

const { canReadOrder } = require('../../services/order-read-authorization');

const order = { id: 'order-1', user_id: 'client-1', relais_id: 'relay-a', market_id: 'market-km' };

describe('order detail read authorization', () => {
  beforeEach(() => jest.clearAllMocks());

  test.each(['admin', 'agent_hub'])('%s keeps central read access', async role => {
    await expect(canReadOrder({ id: 'staff', role }, order)).resolves.toBe(true);
  });

  test('client reads only own order', async () => {
    await expect(canReadOrder({ id: 'client-1', role: 'client' }, order)).resolves.toBe(true);
    await expect(canReadOrder({ id: 'client-2', role: 'client' }, order)).resolves.toBe(false);
  });

  test('relay agent reads only its assigned relay', async () => {
    await expect(canReadOrder({ id: 'agent-a', role: 'agent_relais', relais_id: 'relay-a' }, order)).resolves.toBe(true);
    await expect(canReadOrder({ id: 'agent-b', role: 'agent_relais', relais_id: 'relay-b' }, order)).resolves.toBe(false);
  });

  test('market operator reads only markets in active operations.read delegation', async () => {
    mockMarkets.mockResolvedValue([{ market_id: 'market-km' }]);
    await expect(canReadOrder({ id: 'operator', role: 'market_operator' }, order)).resolves.toBe(true);
    expect(mockMarkets).toHaveBeenCalledWith(expect.any(Object), {
      userId: 'operator', requiredCapability: 'operations.read',
    });
    await expect(canReadOrder({ id: 'operator', role: 'market_operator' }, { ...order, market_id: 'market-cm' })).resolves.toBe(false);
  });

  test('missing identity, market or unknown role fails closed', async () => {
    await expect(canReadOrder(null, order)).resolves.toBe(false);
    await expect(canReadOrder({ id: 'operator', role: 'market_operator' }, { ...order, market_id: null })).resolves.toBe(false);
    await expect(canReadOrder({ id: 'other', role: 'supplier' }, order)).resolves.toBe(false);
  });
});
