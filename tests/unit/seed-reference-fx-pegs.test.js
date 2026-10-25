'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db', () => ({ getClient: jest.fn() }));

const { seedFxPegs, OFFICIAL_FX_PEGS } = require('../../scripts/seed-reference-data');

const clientFor = ({ table = true, upgraded = true, inserted = 1 } = {}) => {
  const queries = [];
  const query = jest.fn(async (sql, params = []) => {
    queries.push({ sql, params });
    if (sql.includes('to_regclass')) return { rows: [{ present: table }] };
    if (sql.includes('pg_constraint')) return { rows: [{ present: upgraded }] };
    if (sql.includes('INSERT INTO fx_pegs')) return { rowCount: inserted };
    throw new Error('Unexpected SQL: ' + sql);
  });
  return { query, queries };
};

describe('CI schema-only : parités officielles FX', () => {
  test('reconstruit exclusivement les 2 pegs officiels historiques, sans observation EUR/USD', async () => {
    const c = clientFor();
    const r = await seedFxPegs(c);
    expect(r).toEqual({ skipped: false, count: 2 });
    const inserts = c.queries.filter(q => q.sql.includes('INSERT INTO fx_pegs'));
    expect(inserts.map(q => q.params[0])).toEqual(['DJF', 'AED']);
    expect(inserts.map(q => q.params[1])).toEqual([177.721, 3.6725]);
    expect(inserts.every(q => q.sql.includes('WHERE NOT EXISTS') && q.sql.includes('ON CONFLICT')
      && !q.sql.includes('DO UPDATE'))).toBe(true);
    expect(c.queries.some(q => /fx_rate_observations|UPDATE fx_pegs/i.test(q.sql))).toBe(false);
  });

  test('attend la migration 314 si le schéma ne supporte pas encore les deux pegs', async () => {
    const c = clientFor({ upgraded: false });
    expect(await seedFxPegs(c)).toEqual({ skipped: true, count: 0 });
    expect(c.queries.filter(q => q.sql.includes('INSERT INTO fx_pegs'))).toHaveLength(0);
  });

  test('la table absente ne provoque aucune insertion', async () => {
    const c = clientFor({ table: false });
    expect(await seedFxPegs(c)).toEqual({ skipped: true, count: 0 });
    expect(c.query).toHaveBeenCalledTimes(1);
  });

  test('idempotence : conserve les pegs existants, aucun UPDATE', async () => {
    const c = clientFor({ inserted: 0 });
    expect(await seedFxPegs(c)).toEqual({ skipped: false, count: 0 });
    expect(OFFICIAL_FX_PEGS).toHaveLength(2);
  });

  test('ne masque pas une erreur SQL du seed', async () => {
    const c = clientFor();
    c.query.mockImplementation(async sql => {
      if (sql.includes('to_regclass') || sql.includes('pg_constraint')) return { rows: [{ present: true }] };
      throw new Error('fx_peg_rate_band');
    });
    await expect(seedFxPegs(c)).rejects.toThrow('fx_peg_rate_band');
  });
});
