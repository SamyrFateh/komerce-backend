'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * Fulfillment mixte — Lot C : le verdict transactionnel doit être figé sur
 * order_items à l'INSERT et l'allocation locale doit suivre exactement ce
 * snapshot.
 */

const mockAllocateForOrderItem = jest.fn();
const mockResolveFrozenClassification = jest.fn();

jest.mock('../../services/order-status-machine', () => ({
  appendOrderHistoryNote: jest.fn(),
}));
jest.mock('../../services/pickup-secret-service', () => ({
  ensureSecretGenerated: jest.fn(),
}));
jest.mock('../../services/wallet-service', () => ({
  debit: jest.fn(),
}));
jest.mock('../../services/local-stock-service', () => ({
  FULFILLMENT_SOURCE: Object.freeze({ LOCAL_STOCK: 'LOCAL_STOCK', IMPORT: 'IMPORT' }),
  allocateForOrderItem: (...args) => mockAllocateForOrderItem(...args),
}));
jest.mock('../../services/customs-classification', () => ({
  resolveFrozenClassification: (...args) => mockResolveFrozenClassification(...args),
}));
jest.mock('../../utils/logger', () => ({
  child: () => ({ error: jest.fn() }),
}));

const { insertOrderItemsWithStock } = require('../../services/order-checkout-persistence');

const PRODUCT_ID = '11111111-1111-1111-1111-111111111111';
const MARKET_ID = '22222222-2222-2222-2222-222222222222';
const ORDER_ID = '33333333-3333-3333-3333-333333333333';

function baseItem(source) {
  return {
    product_id: PRODUCT_ID,
    quantity: 2,
    _effective_unit_price_kmf: 4500,
    _fulfillment_source: source,
  };
}

function context(item) {
  return {
    items: [item],
    productMap: { [PRODUCT_ID]: { id: PRODUCT_ID, category: 'Maison' } },
    order: { id: ORDER_ID },
    relais: { market_id: MARKET_ID },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockResolveFrozenClassification.mockResolvedValue({
    customs_category_key: 'DEFAULT',
    sh_code: null,
    douane_pct: 0,
    tva_pct: 0,
    taxe_add_pct: 0,
    classification_defaulted: true,
  });
});

test('IMPORT est figé sur order_items et ne tente aucune allocation locale', async () => {
  const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };

  await insertOrderItemsWithStock(client, context(baseItem('IMPORT')));

  expect(client.query).toHaveBeenCalledTimes(1);
  const [sql, params] = client.query.mock.calls[0];
  expect(sql).toMatch(/fulfillment_source/);
  expect(params.at(-1)).toBe('IMPORT');
  expect(mockAllocateForOrderItem).not.toHaveBeenCalled();
});

test('LOCAL_STOCK est figé puis alloué sous le même client transactionnel', async () => {
  const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
  mockAllocateForOrderItem.mockResolvedValue({ id: 'alloc-1' });

  await insertOrderItemsWithStock(client, context(baseItem('LOCAL_STOCK')));

  const [, params] = client.query.mock.calls[0];
  expect(params.at(-1)).toBe('LOCAL_STOCK');
  expect(mockAllocateForOrderItem).toHaveBeenCalledWith(client, {
    productId: PRODUCT_ID,
    marketId: MARKET_ID,
    orderId: ORDER_ID,
    quantity: 2,
  });
});

test('un checkout réel ne peut insérer une ligne sans verdict de fulfillment', async () => {
  const client = { query: jest.fn() };
  const item = baseItem(undefined);

  await expect(insertOrderItemsWithStock(client, context(item)))
    .rejects.toMatchObject({ code: 'fulfillment_source_invalid' });

  expect(client.query).not.toHaveBeenCalled();
  expect(mockResolveFrozenClassification).not.toHaveBeenCalled();
  expect(mockAllocateForOrderItem).not.toHaveBeenCalled();
});

test('un verdict LOCAL_STOCK sans allocation est un drift invariant, jamais un fallback IMPORT', async () => {
  const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
  mockAllocateForOrderItem.mockResolvedValue(null);

  await expect(insertOrderItemsWithStock(client, context(baseItem('LOCAL_STOCK'))))
    .rejects.toMatchObject({ code: 'local_stock_verdict_drift' });
});
