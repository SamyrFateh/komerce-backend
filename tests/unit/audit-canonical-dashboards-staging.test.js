'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockQuery = jest.fn();
const mockResolveReference = jest.fn();

jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));
jest.mock('../../middleware/require-non-production', () => ({
  resolveRuntimeEnvironment: () => ({ env: 'staging', source: 'test' }),
}));
jest.mock('../../services/dashboard-pilotage-market', () => ({}));
jest.mock('../../services/dashboard-commerce', () => ({}));
jest.mock('../../services/dashboard-operations', () => ({}));
jest.mock('../../services/dashboard-finance-canonical', () => ({}));
jest.mock('../../services/canonical-reference-resolver', () => ({
  resolveReference: (...args) => mockResolveReference(...args),
}));

const audit = require('../../scripts/audit-canonical-dashboards-staging');

describe('staging exact business assertion', () => {
  const market = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', code: 'KM', name: 'Comores', currency: 'KMF' };

  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [] });
  });

  test('proves exact stage, health, cause and owner then cleans the fixture', async () => {
    mockResolveReference.mockImplementationOnce(async reference => ({
      found: true,
      matches: [{
        entity_type: 'ORDER',
        customer_order_reference: reference,
        current_position: {
          stage: 'PURCHASING',
          health: 'RED',
          cause: { code: 'supplier_payment_blocked', owner_role: 'finance' },
        },
      }],
    }));

    const result = await audit.assertExactBusinessOutcome(market);

    expect(result).toMatchObject({
      stage: 'PURCHASING',
      health: 'RED',
      cause: 'supplier_payment_blocked',
      owner: 'finance',
      passed: true,
      expected: audit.EXACT_ASSERTION,
    });
    expect(result.reference).toMatch(/^AUDIT-EXACT-KM-/);
    expect(mockResolveReference).toHaveBeenCalledWith(result.reference, {
      role: 'admin',
      global: true,
    });
    expect(mockQuery).toHaveBeenCalledTimes(8);
    expect(String(mockQuery.mock.calls[7][0])).toContain('DELETE FROM users');
  });

  test('fixture seed is deterministic in business semantics and cleanup is explicit', async () => {
    const fixture = await audit.seedExactBusinessAssertion(market);
    expect(fixture.reference).toMatch(/^AUDIT-EXACT-KM-/);

    const inserts = mockQuery.mock.calls.slice(0, 4).map(call => String(call[0]));
    expect(inserts[0]).toContain('INSERT INTO users');
    expect(inserts[1]).toContain('INSERT INTO relais');
    expect(inserts[2]).toContain('INSERT INTO orders');
    expect(inserts[2]).toContain("'ordered'");
    expect(inserts[3]).toContain('INSERT INTO signals');
    expect(mockQuery.mock.calls[3][1][1]).toBe('supplier_payment_blocked');
    expect(mockQuery.mock.calls[3][1][2]).toBe('finance');

    await audit.cleanupExactBusinessAssertion(fixture);
    const cleanupSql = mockQuery.mock.calls.slice(4).map(call => String(call[0]));
    expect(cleanupSql).toEqual([
      'DELETE FROM signals WHERE id = $1',
      'DELETE FROM orders WHERE id = $1',
      'DELETE FROM relais WHERE id = $1',
      'DELETE FROM users WHERE id = $1',
    ]);
  });

  test('exact assertion fails closed when the resolved business value drifts', async () => {
    mockResolveReference.mockResolvedValueOnce({
      found: true,
      matches: [{
        entity_type: 'ORDER',
        customer_order_reference: expect.anything(),
        current_position: {
          stage: 'SUPPLIER',
          health: 'RED',
          cause: { code: 'supplier_payment_blocked', owner_role: 'finance' },
        },
      }],
    });

    await expect(audit.assertExactBusinessOutcome(market))
      .rejects.toThrow('exact_assertion_order_reference_mismatch');

    // Four inserts + four cleanup deletes prove the temporary fixture is removed
    // even when an exact assertion fails.
    expect(mockQuery).toHaveBeenCalledTimes(8);
    expect(String(mockQuery.mock.calls[7][0])).toContain('DELETE FROM users');
  });
});
