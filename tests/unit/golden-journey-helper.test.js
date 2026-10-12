'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockProject = jest.fn();

jest.mock('../../services/golden-e2e-cockpit', () => ({
  projectGoldenEvidence: (...args) => mockProject(...args),
}));

const {
  assertGoldenReference,
  resolveGoldenOrder,
  projectGoldenJourney,
} = require('../helpers/goldenJourney');

beforeEach(() => jest.clearAllMocks());

test('refuse toute référence hors namespace Golden', () => {
  expect(() => assertGoldenReference('CMD-KM-1')).toThrow(/K-GOLDEN/);
  expect(() => assertGoldenReference('K-GOLDEN-ABC')).not.toThrow();
});

test('résout la commande Golden par référence sans mutation', async () => {
  const order = { id: 'order-1', reference: 'K-GOLDEN-ABC' };
  const db = { query: jest.fn().mockResolvedValue({ rows: [order] }) };

  await expect(resolveGoldenOrder(db, order.reference)).resolves.toEqual(order);
  expect(db.query).toHaveBeenCalledTimes(1);
  expect(db.query.mock.calls[0][0].trim()).toMatch(/^SELECT /i);
});

test('projette exactement la vérité canonique du cockpit', async () => {
  const order = { id: 'order-1', reference: 'K-GOLDEN-ABC' };
  const projection = { steps: [{ key: 'CLIENT_ORDER', passed: true }] };
  const db = { query: jest.fn().mockResolvedValue({ rows: [order] }) };
  mockProject.mockResolvedValue(projection);

  await expect(projectGoldenJourney(db, order.reference)).resolves.toEqual(projection);
  expect(mockProject).toHaveBeenCalledWith(db, order);
});
