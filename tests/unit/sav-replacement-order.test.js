'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../services/order-service', () => ({ getUniqueRef: jest.fn().mockResolvedValue('KMC-NEW') }));
jest.mock('../../services/order-status-machine', () => ({ transitionOrderStatus: jest.fn().mockResolvedValue({ success: true }) }));
jest.mock('../../services/order-checkout-persistence', () => ({ requireOrderLocalStockAllocation: jest.fn() }));
jest.mock('../../services/purchasing-trigger-service', () => ({ triggerPurchasing: jest.fn() }));
const { create, startProcurement } = require('../../services/sav-replacement-order');
const { requireOrderLocalStockAllocation } = require('../../services/order-checkout-persistence');
const { transitionOrderStatus } = require('../../services/order-status-machine');
const { triggerPurchasing } = require('../../services/purchasing-trigger-service');

const dossier = { id: 'request', order_id: 'original', return_order_item_id: 'item', return_quantity: 2, market_id: 'KM' };
const actor = { id: 'admin', role: 'admin' };
function database(source) {
  return { query: jest.fn(async sql => {
    if (sql.includes('FROM order_items oi')) return { rows: [{ product_id: 'product', fulfillment_source: source }] };
    if (sql.includes('INSERT INTO orders')) return { rows: [{ id: 'new', reference: 'KMC-NEW' }] };
    return { rows: [] };
  }) };
}

beforeEach(() => jest.clearAllMocks());

test('réclame une preuve physique de la quantité exacte avant toute écriture', async () => {
  const client = database('IMPORT');
  await expect(create({ client, dossier, receipt: { quantity: 1 }, actor })).rejects.toMatchObject({
    code: 'COMPENSATION_RESHIP_RECEIPT_REQUIRED',
  });
  expect(client.query).not.toHaveBeenCalled();
});

test.each(['LOCAL_STOCK', 'IMPORT'])('nouveau parcours %s par les services normaux', async source => {
  const client = database(source);
  requireOrderLocalStockAllocation.mockResolvedValue({ id: 'allocation' });
  const out = await create({ client, dossier, receipt: { quantity: 2 }, actor });
  expect(out).toEqual({ id: 'new', reference: 'KMC-NEW', fulfillment_source: source });
  expect(client.query).toHaveBeenCalledWith(expect.stringContaining('sku_id, variant_combo, fulfillment_source'), ['item', 'new', 2]);
  expect(requireOrderLocalStockAllocation).toHaveBeenCalledTimes(source === 'LOCAL_STOCK' ? 1 : 0);
  expect(transitionOrderStatus.mock.calls.map(([input]) => [input.orderId, input.newStatus])).toEqual([
    ['new', 'confirmed'], ['new', 'ordered'],
  ]);
});

test('un import sans source reste visible comme besoin en attente', async () => {
  triggerPurchasing.mockResolvedValue({ purchase_orders: [{ status: 'no_supplier' }] });
  await expect(startProcurement('new')).resolves.toBe('sourcing_pending');
});
