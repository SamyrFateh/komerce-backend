'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({
  getClient: jest.fn(),
  pool: { end: jest.fn() },
}));

const db = require('../../db');
const {
  assertStaging,
  purgeOrderedV2History,
  resetShowcaseV2,
} = require('../../scripts/showcase-v2-reset');

describe('showcase-v2 full staging reset', () => {
  const oldEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'test';
    process.env.KOMERCE_ENV = 'staging';
    process.env.KOMERCE_ALLOW_SHOWCASE_SEED = '1';
    process.env.DATABASE_URL = 'postgres://staging.example/test';
  });

  afterAll(() => {
    process.env = oldEnv;
  });

  test('refuse explicitement la production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertStaging()).toThrow('interdit en production');
  });

  test('purge seulement V2, y compris son historique order_items, et préserve V1', async () => {
    let snapshotCount = 0;
    const queries = [];
    const client = {
      release: jest.fn(),
      query: jest.fn(async (sql, params) => {
        queries.push({ sql: String(sql), params });
        const text = String(sql);
        if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [], rowCount: 0 };
        if (text.includes('AS v1_active')) {
          snapshotCount += 1;
          return {
            rows: [snapshotCount === 1
              ? { v1_active: 500, v2_products: 12, v2_candidates: 500, v2_imports: 4, v2_order_items: 2 }
              : { v1_active: 500, v2_products: 0, v2_candidates: 0, v2_imports: 0, v2_order_items: 0 }],
          };
        }
        if (text.includes('DELETE FROM order_items')) return { rows: [{ id: 'oi-1' }, { id: 'oi-2' }], rowCount: 2 };
        if (text.includes('DELETE FROM sourcing_candidates')) return { rows: [], rowCount: 500 };
        if (text.includes('DELETE FROM products')) return { rows: [], rowCount: 12 };
        if (text.includes('DELETE FROM supplier_catalog_imports')) return { rows: [], rowCount: 4 };
        throw new Error(`SQL inattendu: ${text}`);
      }),
    };
    db.getClient.mockResolvedValue(client);

    const result = await resetShowcaseV2();
    expect(result.deleted).toEqual({ order_items: 2, candidates: 500, products: 12, imports: 4 });
    expect(result.after.v1_active).toBe(500);
    expect(result.after.v2_products).toBe(0);
    expect(result.after.v2_candidates).toBe(0);
    expect(result.after.v2_order_items).toBe(0);
    expect(client.release).toHaveBeenCalledTimes(1);

    const destructive = queries.filter(({ sql }) => sql.includes('DELETE FROM'));
    expect(destructive.some(({ sql, params }) => sql.includes('order_items') && params?.includes('SHOWCASE-V2-%'))).toBe(true);
    expect(destructive.some(({ sql, params }) => sql.includes('products') && params?.includes('SHOWCASE-V2-%'))).toBe(true);
    expect(destructive.some(({ params }) => params?.includes('SHOWCASE-V1-%'))).toBe(false);
  });

  test('la purge de l’historique ne cible que les order_items reliés à SHOWCASE-V2', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 2 }) };
    await purgeOrderedV2History(client);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM order_items'),
      ['SHOWCASE-V2-%'],
    );
    expect(client.query.mock.calls[0][0]).toContain('USING products');
    expect(client.query.mock.calls[0][0]).toContain('p.product_ref LIKE $1');
  });

  test('rollback si la purge reste incomplète', async () => {
    let snapshotCount = 0;
    const client = {
      release: jest.fn(),
      query: jest.fn(async (sql) => {
        const text = String(sql);
        if (text === 'BEGIN' || text === 'ROLLBACK') return { rows: [], rowCount: 0 };
        if (text.includes('AS v1_active')) {
          snapshotCount += 1;
          return { rows: [snapshotCount === 1
            ? { v1_active: 500, v2_products: 1, v2_candidates: 1, v2_imports: 1, v2_order_items: 1 }
            : { v1_active: 500, v2_products: 0, v2_candidates: 0, v2_imports: 0, v2_order_items: 1 }] };
        }
        if (text.includes('DELETE FROM order_items')) return { rows: [], rowCount: 1 };
        if (text.includes('DELETE FROM sourcing_candidates')) return { rows: [], rowCount: 1 };
        if (text.includes('DELETE FROM products')) return { rows: [], rowCount: 1 };
        if (text.includes('DELETE FROM supplier_catalog_imports')) return { rows: [], rowCount: 1 };
        throw new Error(`SQL inattendu: ${text}`);
      }),
    };
    db.getClient.mockResolvedValue(client);

    await expect(resetShowcaseV2()).rejects.toThrow('Reset V2 incomplet');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });
});
