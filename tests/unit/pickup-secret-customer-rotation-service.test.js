/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
'use strict';

const mockGen = jest.fn();
jest.mock('../../services/pickup-secret-issuer', () => ({ generateAndStoreSecret: (...a) => mockGen(...a) }));
const mockRegen = jest.fn();
jest.mock('../../services/order-mutation-service', () => ({ recordPickupRegeneration: (...a) => mockRegen(...a) }));

const mockClient = { query: jest.fn() };
jest.mock('../../db', () => ({ withTransaction: (fn) => fn(mockClient) }));
jest.mock('../../utils/logger', () => ({ child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) }));

const { customerGenerateNewCode } = require('../../services/pickup-secret-customer-rotation-service');

const order = (o = {}) => ({ id: 'o1', reference: 'KC1', user_id: 'u1', status: 'available', relais_id: 'r1', pickup_secret_hash: 'h', ...o });
function setup(orderRow, count = 0) {
  mockClient.query.mockImplementation(async (sql) => {
    if (/FROM orders/.test(sql)) return { rows: orderRow ? [orderRow] : [] };
    if (/COUNT\(\*\)/.test(sql)) return { rows: [{ n: count }] };
    return { rows: [] };
  });
}
const wrote = (re) => mockClient.query.mock.calls.some(([s]) => re.test(s));

beforeEach(() => {
  jest.clearAllMocks();
  mockGen.mockResolvedValue({ code: 'ABC23DEF', last4: '3DEF' });
});

test('propriétaire : rotation canonique, audit, code renvoyé une fois', async () => {
  setup(order());
  const r = await customerGenerateNewCode({ orderId: 'o1', userId: 'u1' });
  expect(r.status).toBe(200);
  expect(r.body.code).toBe('ABC23DEF');
  expect(mockGen).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'o1', channel: 'customer_regenerate', excludeOrderId: 'o1' }));
  expect(mockRegen).toHaveBeenCalledWith(mockClient, { orderId: 'o1', reason: 'customer_regenerate' });
  expect(wrote(/INSERT INTO pickup_code_generations/)).toBe(true);
});

test('ancien code invalidé : nouveau secret écrit, caches en clair purgés', async () => {
  setup(order());
  await customerGenerateNewCode({ orderId: 'o1', userId: 'u1' });
  expect(mockGen).toHaveBeenCalledTimes(1);
  expect(wrote(/DELETE FROM pickup_reveal_codes/)).toBe(true);
  expect(wrote(/DELETE FROM pickup_print_tokens/)).toBe(true);
});

test('autre mockClient : 403, aucune mutation', async () => {
  setup(order({ user_id: 'u2' }));
  const r = await customerGenerateNewCode({ orderId: 'o1', userId: 'u1' });
  expect(r.status).toBe(403);
  expect(mockGen).not.toHaveBeenCalled();
  expect(wrote(/INSERT/)).toBe(false);
});

test('quota : 6e génération sur 24 h refusée (429)', async () => {
  setup(order(), 5);
  expect((await customerGenerateNewCode({ orderId: 'o1', userId: 'u1' })).status).toBe(429);
  expect(mockGen).not.toHaveBeenCalled();
});

test('5e génération autorisée', async () => {
  setup(order(), 4);
  expect((await customerGenerateNewCode({ orderId: 'o1', userId: 'u1' })).status).toBe(200);
});

test.each(['collected', 'cancelled'])('commande %s refusée (409)', async (status) => {
  setup(order({ status }));
  expect((await customerGenerateNewCode({ orderId: 'o1', userId: 'u1' })).status).toBe(409);
  expect(mockGen).not.toHaveBeenCalled();
});

test('commande non prête refusée (409)', async () => {
  setup(order({ status: 'confirmed' }));
  expect((await customerGenerateNewCode({ orderId: 'o1', userId: 'u1' })).status).toBe(409);
});

test('commande inconnue : 404', async () => {
  setup(null);
  expect((await customerGenerateNewCode({ orderId: 'o1', userId: 'u1' })).status).toBe(404);
});
