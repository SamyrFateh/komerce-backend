'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const { makeClient, expectTransactionCommitted } = require('../integration/test-harness/mock-db');

jest.mock('../../db', () => ({
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));
jest.mock('../../services/order-cost-snapshot', () => ({
  lockEstimatedCostsForOrder: jest.fn().mockResolvedValue({ locked: true }),
}));

const db = require('../../db');
const { allocateParcelRealCosts } = require('../../services/cost-allocation');

beforeEach(() => jest.clearAllMocks());

function findRelayInsert(client) {
  return client.query.mock.calls.find((c) => {
    const sql = String(c[0]);
    return sql.includes('INSERT INTO order_item_real_cost_allocations') && sql.includes("'relay'");
  });
}

describe('LOT 1A-3 — allocation réelle commission relais', () => {
  test('cost_components gagne sur finance_config.standard et la provenance est tracée', async () => {
    const client = makeClient([
      { rows: [{ id: 'parcel-001', order_id: 'order-001', status: 'collected' }] },
      { rows: [], rowCount: 0 },
      { rows: [{ order_item_id: 'oi-001', quantity: '2', weight_kg: '1' }] },
      { rows: [{ component_value: '620.0000', legacy_standard_value: 500 }] },
      { rows: [], rowCount: 1 },
    ]);
    db.pool.connect.mockResolvedValue(client);

    const result = await allocateParcelRealCosts('parcel-001');

    const insert = findRelayInsert(client);
    expect(insert).toBeDefined();
    expect(insert[1][3]).toBe(1240); // 620 × quantité 2
    expect(insert[1][4]).toBe('cost_components.commission_relais_kmf');
    expect(result.relay_commission_kmf).toBe(620);
    expect(result.relay_commission_source).toBe('cost_components.commission_relais_kmf');
    expectTransactionCommitted(client);
  });

  test('finance_config.standard reste le fallback legacy si le composant est absent', async () => {
    const client = makeClient([
      { rows: [{ id: 'parcel-002', order_id: 'order-002', status: 'collected' }] },
      { rows: [], rowCount: 0 },
      { rows: [{ order_item_id: 'oi-002', quantity: '1', weight_kg: '1' }] },
      { rows: [{ component_value: null, legacy_standard_value: '600' }] },
      { rows: [], rowCount: 1 },
    ]);
    db.pool.connect.mockResolvedValue(client);

    const result = await allocateParcelRealCosts('parcel-002');

    const insert = findRelayInsert(client);
    expect(insert).toBeDefined();
    expect(insert[1][3]).toBe(600);
    expect(insert[1][4]).toBe('finance_config.commission_relais_standard_kmf');
    expect(result.relay_commission_source).toBe('finance_config.commission_relais_standard_kmf');
  });
});
