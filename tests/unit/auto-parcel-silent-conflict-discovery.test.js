'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * Diagnostic on REAL service with simulated pg results: a successful query
 * with rowCount=0 (ON CONFLICT DO NOTHING) must not be reported as inserted.
 * This suite documents the EXISTING counterexample, not a fix.
 * A future fix should replace the diagnostic expectation with items_assigned=0.
 */
jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
const db = require('../../db');
const { distributeOrder } = require('../../services/auto-parcel');

function seedThenInsert(rowCount) {
  db.query
    .mockResolvedValueOnce({ rows: [{
      id: 'order-A', reference: 'CMD-A', status: 'ordered',
      relais_id: 'relay-KM', relais_island: 'Anjouan'
    }] })
    .mockResolvedValueOnce({ rows: [] })   // no currently attached lines
    .mockResolvedValueOnce({ rows: [{ id:'line-A', quantity: 1, product_id: 'product-A' }] })
    .mockResolvedValueOnce({ rows: [{
      id:'parcel-A', reference:'KOM-P-2026-000015', item_count: 0, order_count: 0
    }] })
    .mockResolvedValueOnce({ rows: [], rowCount }); // actual INSERT result
}

describe('Governance discovery — conflict counted as parcel allocation', () => {
  beforeEach(() => db.query.mockReset());

  it('control: real insertion reports exactly one allocated line', async () => {
    seedThenInsert(1);
    const observed = await distributeOrder('order-A');
    expect(observed.success).toBe(true);
    expect(observed.items_assigned).toBe(1);
    expect(db.query.mock.calls[4][0]).toContain('ON CONFLICT DO NOTHING');
  });

  it('counterexample: PostgreSQL conflict rowCount=0 still reports one allocated line', async () => {
    seedThenInsert(0);
    const observed = await distributeOrder('order-A');
    expect(observed.success).toBe(true);
    expect(observed.items_assigned).toBe(1); // EXISTING BUG, not the desired behavior
    expect(db.query.mock.calls[4][0]).toContain('ON CONFLICT DO NOTHING');
    expect(db.query.mock.results[4].type).toBe('return');
  });
});
