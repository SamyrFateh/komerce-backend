'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({
  query: jest.fn(),
}));

const db = require('../../db');
const {
  marketTags,
  marketProfile,
  isProductionRuntime,
  createOrder,
  cleanup,
  main,
} = require('../../scripts/seed-market-test-data');

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_EXIT_CODE = process.exitCode;

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.NODE_ENV;
  delete process.env.KOMERCE_ENV;
  process.exitCode = undefined;
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
  process.exitCode = ORIGINAL_EXIT_CODE;
});

test('namespace chaque fixture par code marché', () => {
  expect(marketTags('cm')).toEqual({
    code: 'CM',
    refPrefix: 'SEEDTEST-CM-',
    relaisName: 'SEEDTEST CM relais',
    productNamePrefix: 'SEEDTEST CM produit',
  });
  expect(marketTags('CG').refPrefix).toBe('SEEDTEST-CG-');
  expect(marketTags('KM').refPrefix).toBe('SEEDTEST-KM-');
});

test('les profils de relais ne réutilisent pas le +269 hors Comores', () => {
  expect(marketProfile({ code: 'KM', name: 'Comores' }).phonePrefix).toBe('+269');
  expect(marketProfile({ code: 'CM', name: 'Cameroun' }).phonePrefix).toBe('+237');
  expect(marketProfile({ code: 'CG', name: 'Congo' }).phonePrefix).toBe('+242');
});

test('refuse production depuis NODE_ENV ou KOMERCE_ENV', () => {
  process.env.NODE_ENV = 'production';
  expect(isProductionRuntime()).toBe(true);

  delete process.env.NODE_ENV;
  process.env.KOMERCE_ENV = 'production';
  expect(isProductionRuntime()).toBe(true);

  process.env.KOMERCE_ENV = 'staging';
  expect(isProductionRuntime()).toBe(false);
});

test('createOrder écrit explicitement le market_id canonique dans orders', async () => {
  jest.spyOn(Math, 'random').mockReturnValue(0);
  db.query
    .mockResolvedValueOnce({ rows: [{ id: 'order-1' }] })
    .mockResolvedValueOnce({ rows: [] });

  await createOrder({
    marketId: 'market-cm-id',
    marketCode: 'CM',
    relaisId: 'relais-cm-id',
    products: [{ id: 'product-cm-1', price_kmf: 12000 }],
  });

  Math.random.mockRestore();

  const [orderSql, orderParams] = db.query.mock.calls[0];
  expect(orderSql).toMatch(/INSERT INTO orders/);
  expect(orderSql).toMatch(/reference, relais_id, market_id/);
  expect(orderParams[0]).toMatch(/^SEEDTEST-CM-/);
  expect(orderParams[1]).toBe('relais-cm-id');
  expect(orderParams[2]).toBe('market-cm-id');
});

test('createOrder fail-closed si marketId manque', async () => {
  await expect(createOrder({
    marketId: null,
    marketCode: 'CM',
    relaisId: 'relais-cm-id',
    products: [{ id: 'product-cm-1', price_kmf: 12000 }],
  })).rejects.toThrow(/marketId is required/);
  expect(db.query).not.toHaveBeenCalled();
});

test('cleanup cible simultanément le tag ET le market_id du marché demandé', async () => {
  db.query
    .mockResolvedValueOnce({ rows: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }] })
    .mockResolvedValue({ rows: [] });

  await cleanup({ id: 'market-cm-id', code: 'CM', name: 'Cameroun' });

  const [selectSql, selectParams] = db.query.mock.calls[0];
  expect(selectSql).toMatch(/reference LIKE \$1 AND market_id = \$2/);
  expect(selectParams).toEqual(['SEEDTEST-CM-%', 'market-cm-id']);

  const [deleteOrdersSql, deleteOrdersParams] = db.query.mock.calls[2];
  expect(deleteOrdersSql).toMatch(/DELETE FROM orders/);
  expect(deleteOrdersSql).toMatch(/market_id = \$2/);
  expect(deleteOrdersParams[1]).toBe('market-cm-id');

  const [deleteProductsSql, deleteProductsParams] = db.query.mock.calls[3];
  expect(deleteProductsSql).toMatch(/DELETE FROM products/);
  expect(deleteProductsParams).toEqual(['SEEDTEST CM produit%']);

  const [deleteRelaisSql, deleteRelaisParams] = db.query.mock.calls[4];
  expect(deleteRelaisSql).toMatch(/market_id = \$2/);
  expect(deleteRelaisParams).toEqual(['SEEDTEST CM relais', 'market-cm-id']);
});

test('--cleanup sans --market est refusé avant toute lecture DB', async () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

  await main(['node', 'seed-market-test-data.js', '--cleanup']);

  expect(process.exitCode).toBe(1);
  expect(db.query).not.toHaveBeenCalled();
  errorSpy.mockRestore();
});
