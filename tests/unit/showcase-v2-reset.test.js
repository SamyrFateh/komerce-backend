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

  test('purge seulement V2 et prouve que V1 reste identique', async () => {
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
              ? { v1_active: 500, v2_products: 12, v2_candidates: 500, v2_imports: 4 }
              : { v1_active: 500, v2_products: 0, v2_candidates: 0, v2_imports: 0 }],
          };
        }
        if (text.includes('FROM order_items')) return { rows: [{ count: 0 }] };
        if (text.includes('DELETE FROM sourcing_candidates')) return { rows: [], rowCount: 500 };
        if (text.includes('DELETE FROM products')) return { rows: [], rowCount: 12 };
        if (text.includes('DELETE FROM supplier_catalog_imports')) return { rows: [], rowCount: 4 };
        throw new Error(`SQL inattendu: ${text}`);
      }),
    };
    db.getClient.mockResolvedValue(client);

    const result = await resetShowcaseV2();
    expect(result.deleted).toEqual({ candidates: 500, products: 12, imports: 4 });
    expect(result.after.v1_active).toBe(500);
    expect(result.after.v2_products).toBe(0);
    expect(result.after.v2_candidates).toBe(0);
    expect(client.release).toHaveBeenCalledTimes(1);

    const destructive = queries.filter(({ sql }) => sql.includes('DELETE FROM'));
    expect(destructive.some(({ sql, params }) => sql.includes('products') && params?.includes('SHOWCASE-V2-%'))).toBe(true);
    expect(destructive.some(({ params }) => params?.includes('SHOWCASE-V1-%'))).toBe(false);
  });

  test('refuse la purge si un V2 apparaît dans une commande', async () => {
    const client = {
      release: jest.fn(),
      query: jest.fn(async (sql) => {
        const text = String(sql);
        if (text === 'BEGIN' || text === 'ROLLBACK') return { rows: [], rowCount: 0 };
        if (text.includes('AS v1_active')) {
          return { rows: [{ v1_active: 500, v2_products: 1, v2_candidates: 1, v2_imports: 1 }] };
        }
        if (text.includes('FROM order_items')) return { rows: [{ count: 1 }] };
        throw new Error(`SQL destructif ne devait pas être atteint: ${text}`);
      }),
    };
    db.getClient.mockResolvedValue(client);

    await expect(resetShowcaseV2()).rejects.toThrow('ligne(s) de commande');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });
});
