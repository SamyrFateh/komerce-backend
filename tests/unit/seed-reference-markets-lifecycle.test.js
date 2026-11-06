'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db', () => ({ getClient: jest.fn() }));

const { seedMarkets, REFERENCE_MARKETS } = require('../../scripts/seed-reference-data');

const clientFor = ({ withLifecycle }) => {
  const queries = [];
  const query = jest.fn(async (sql, params = []) => {
    queries.push({ sql, params });
    if (sql.includes('to_regclass')) return { rows: [{ present: true }] };
    if (sql.includes('information_schema')) return { rows: [{ present: withLifecycle }] };
    if (sql.includes('INSERT INTO markets')) return { rowCount: 1 };
    throw new Error('Unexpected SQL: ' + sql);
  });
  return { query, queries };
};

describe('seed marches : ne touche jamais au lifecycle d un marche existant', () => {
  test.each([true, false])('withLifecycle=%s : ON CONFLICT ne reecrit ni lifecycle_status ni is_active', async (withLifecycle) => {
    const c = clientFor({ withLifecycle });
    const r = await seedMarkets(c);
    expect(r).toEqual({ skipped: false, count: REFERENCE_MARKETS.length });
    const inserts = c.queries.filter(q => q.sql.includes('INSERT INTO markets'));
    expect(inserts).toHaveLength(REFERENCE_MARKETS.length);
    for (const q of inserts) {
      const conflict = q.sql.split('ON CONFLICT')[1];
      expect(conflict).toBeDefined();
      expect(conflict).not.toMatch(/lifecycle_status/);
      expect(conflict).not.toMatch(/is_active/);
    }
  });
});
