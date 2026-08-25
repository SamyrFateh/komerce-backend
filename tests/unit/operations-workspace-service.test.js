'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockQuery = jest.fn();
const mockTransition = jest.fn();
const mockDistributeOrder = jest.fn();
const mockProcessScan = jest.fn();
const mockScanIntoParcel = jest.fn();
const mockConfirmCash = jest.fn();

jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));
jest.mock('../../services/order-status-machine', () => ({
  transitionOrderStatus: (...args) => mockTransition(...args),
}));
jest.mock('../../services/auto-parcel', () => ({
  distributeOrder: (...args) => mockDistributeOrder(...args),
}));
jest.mock('../../services/scan-engine', () => ({
  processScan: (...args) => mockProcessScan(...args),
}));
jest.mock('../../services/inventory-service', () => ({
  scanIntoParcel: (...args) => mockScanIntoParcel(...args),
}));
jest.mock('../../services/parcel-auto-create-service', () => ({
  confirmCashAndCreateParcel: (...args) => mockConfirmCash(...args),
}));
jest.mock('../../services/pickup-secret-service', () => ({
  cacheCodeForReveal: jest.fn(async () => true),
}));
jest.mock('../../utils/logger', () => ({
  child: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}));

const workspace = require('../../services/operations-workspace');

const MARKET = Object.freeze({
  id: 'market-cm-id',
  code: 'CM',
  name: 'Cameroun',
  currency: 'XAF',
});

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [] });
  mockTransition.mockResolvedValue({ success: true });
  mockDistributeOrder.mockResolvedValue({ success: true, parcel_ref: 'PCL-CM-001' });
  mockProcessScan.mockResolvedValue({
    success: true,
    parcel: { status: 'shipped' },
    catchup_events: [],
    incidents: [],
  });
  mockScanIntoParcel.mockResolvedValue({ assigned: true, matched_proposal: true });
});

test('buildWorkspace scope toutes ses lectures DB par le market id serveur', async () => {
  await workspace.buildWorkspace({ market: MARKET });

  expect(mockQuery).toHaveBeenCalledTimes(6);
  for (const call of mockQuery.mock.calls) {
    expect(call[1]).toContain('market-cm-id');
    expect(String(call[0])).toMatch(/market_id\s*=\s*\$1|market_id\s*=\s*\$2/);
  }
});

test('scope public ne divulgue jamais UUID marché', () => {
  const scope = workspace.publicMarket(MARKET);

  expect(scope).toEqual({ code: 'CM', name: 'Cameroun', currency: 'XAF' });
  expect(JSON.stringify(scope)).not.toContain('market-cm-id');
});

test('buildQueues ne crée aucune transition métier côté présentation', () => {
  const queues = workspace.buildQueues(
    [
      { reference: 'CMD-1', status: 'confirmed', payment_mode: 'stripe_eur', payment_status: 'paid' },
      { reference: 'CMD-2', status: 'pending', payment_mode: 'cash_relais', payment_status: 'pending' },
    ],
    [
      { reference: 'PCL-1', status: 'preparation' },
      { reference: 'PCL-2', status: 'in_transit' },
      { reference: 'PCL-3', status: 'available' },
    ]
  );

  expect(queues.hub.to_order.map(row => row.reference)).toEqual(['CMD-1']);
  expect(queues.hub.to_ship.map(row => row.reference)).toEqual(['PCL-1']);
  expect(queues.relay.cash_pending.map(row => row.reference)).toEqual(['CMD-2']);
  expect(queues.relay.to_receive.map(row => row.reference)).toEqual(['PCL-2']);
  expect(queues.relay.to_collect.map(row => row.reference)).toEqual(['PCL-3']);
});

test('runDistribution ne distribue que les commandes présélectionnées dans le marché', async () => {
  mockQuery.mockResolvedValueOnce({
    rows: [
      { id: 'order-cm-1', reference: 'CMD-CM-001', relais_id: 'relay-cm', relais_market_id: 'market-cm-id' },
      { id: 'order-cm-2', reference: 'CMD-CM-002', relais_id: null, relais_market_id: null },
    ],
  });
  mockDistributeOrder
    .mockResolvedValueOnce({ success: true, parcel_ref: 'PCL-CM-001' })
    .mockResolvedValueOnce({ success: true, queued: true });

  const result = await workspace.runDistribution(MARKET);

  expect(mockQuery.mock.calls[0][1]).toEqual(['market-cm-id']);
  expect(mockDistributeOrder.mock.calls).toEqual([
    ['order-cm-1'],
    ['order-cm-2'],
  ]);
  expect(result).toEqual(expect.objectContaining({ attempted: 2, distributed: 1, queued: 1, errors: 0 }));
  expect(JSON.stringify(result)).not.toContain('order-cm-1');
});

test('runDistribution bloque tout avant mutation si un relais appartient à un autre marché', async () => {
  mockQuery.mockResolvedValueOnce({
    rows: [
      { id: 'order-cm-1', reference: 'CMD-CM-001', relais_id: 'relay-cg', relais_market_id: 'market-cg-id' },
    ],
  });

  await expect(workspace.runDistribution(MARKET)).rejects.toMatchObject({
    code: 'relay_market_mismatch',
    status: 409,
  });
  expect(mockDistributeOrder).not.toHaveBeenCalled();
});

test('scanParcel résout le colis dans le marché avant d appeler le moteur append-only', async () => {
  mockQuery.mockResolvedValueOnce({
    rows: [{
      id: 'parcel-cm-id',
      reference: 'PCL-CM-001',
      status: 'preparation',
      order_id: 'order-cm-id',
      relais_id: 'relay-cm',
      order_market_id: 'market-cm-id',
      relais_market_id: 'market-cm-id',
    }],
  });

  const result = await workspace.scanParcel('PCL-CM-001', 'ship', MARKET, {
    id: 'admin-1',
    role: 'admin',
    full_name: 'Admin Test',
  });

  expect(mockQuery.mock.calls[0][1]).toEqual(['PCL-CM-001', 'market-cm-id']);
  expect(mockProcessScan).toHaveBeenCalledWith(expect.objectContaining({
    parcel_id: 'parcel-cm-id',
    event_type: 'shipped',
    metadata: expect.objectContaining({ market_code: 'CM' }),
  }));
  expect(result.reference).toBe('PCL-CM-001');
});

test('assignInventory revalide article et colis dans le même marché avant mutation', async () => {
  mockQuery
    .mockResolvedValueOnce({
      rows: [{ id: 'item-cm-id', status: 'proposed', order_id: 'order-cm-id', market_id: 'market-cm-id' }],
    })
    .mockResolvedValueOnce({
      rows: [{
        id: 'parcel-cm-id',
        reference: 'PCL-CM-001',
        status: 'preparation',
        order_id: 'order-cm-id',
        relais_id: 'relay-cm',
        order_market_id: 'market-cm-id',
        relais_market_id: 'market-cm-id',
      }],
    });

  const result = await workspace.assignInventory('item-cm-id', 'PCL-CM-001', MARKET);

  expect(mockScanIntoParcel).toHaveBeenCalledWith('item-cm-id', 'parcel-cm-id');
  expect(result).toEqual(expect.objectContaining({ parcel_ref: 'PCL-CM-001', assigned: true }));
});

test('assignInventory refuse un colis fermé même dans le bon marché', async () => {
  mockQuery
    .mockResolvedValueOnce({
      rows: [{ id: 'item-cm-id', status: 'proposed', order_id: 'order-cm-id', market_id: 'market-cm-id' }],
    })
    .mockResolvedValueOnce({
      rows: [{
        id: 'parcel-cm-id',
        reference: 'PCL-CM-001',
        status: 'shipped',
        order_id: 'order-cm-id',
        relais_id: 'relay-cm',
        order_market_id: 'market-cm-id',
        relais_market_id: 'market-cm-id',
      }],
    });

  await expect(workspace.assignInventory('item-cm-id', 'PCL-CM-001', MARKET)).rejects.toMatchObject({
    code: 'inventory_parcel_not_open',
    status: 409,
  });
  expect(mockScanIntoParcel).not.toHaveBeenCalled();
});
