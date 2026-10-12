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


test('désigne la première frontière métier non prouvée', () => {
  const { nextGoldenBoundary } = require('../helpers/goldenJourney');
  const projection = { steps: [
    { key: 'CLIENT_ORDER', passed: true },
    { key: 'HUB_INBOUND', passed: true },
    { key: 'CUSTOMS', passed: false, evidence: 'PENDING' },
    { key: 'RELAY_AVAILABLE', passed: false },
  ] };
  expect(nextGoldenBoundary(projection)).toMatchObject({ key: 'CUSTOMS', passed: false });
});

test('ne propose aucune progression lorsque toutes les frontières sont prouvées', () => {
  const { PROGRESSIVE_BOUNDARIES, nextGoldenBoundary } = require('../helpers/goldenJourney');
  const projection = { steps: PROGRESSIVE_BOUNDARIES.map(key => ({ key, passed: true })) };
  expect(nextGoldenBoundary(projection)).toBeNull();
});


test('la clôture financière reste observation-only dans le driver', async () => {
  const helper = require('../helpers/goldenJourney');
  const order = { id: 'order-1', reference: 'K-GOLDEN-CLOSE' };
  const steps = helper.PROGRESSIVE_BOUNDARIES.map(key => ({
    key,
    passed: key !== 'FINANCIAL_CLOSE',
    evidence: key === 'FINANCIAL_CLOSE' ? 'FINANCIAL_CLOSE_PENDING' : 'MATCHED',
  }));
  const db = { query: jest.fn().mockResolvedValue({ rows: [order] }) };
  mockProject.mockResolvedValue({ steps });

  const result = await helper.advanceGoldenJourney(db, order.reference);
  expect(result.next).toMatchObject({ key: 'FINANCIAL_CLOSE' });
  expect(db.query.mock.calls.every(([sql]) => /^SELECT /i.test(sql.trim()))).toBe(true);
});
