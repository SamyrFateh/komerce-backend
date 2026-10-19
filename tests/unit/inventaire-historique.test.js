'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const { runInventory } = require('../../scripts/recette/inventaire-historique');

describe('inventaire historique (lecture seule)', () => {
  test('refuse sans KOMERCE_TARGET_ENV', async () => {
    await expect(runInventory({ db: { query: jest.fn() }, env: {} })).rejects.toMatchObject({ code: 'TARGET_ENV_MISSING' });
  });

  test('transaction READ ONLY, aucune écriture, cible identifiée sans secret', async () => {
    const db = { query: jest.fn(async (sql) => {
      if (/current_database/.test(sql)) return { rows: [{ database: 'staging_db', server_version: '16' }] };
      return { rows: [] };
    }) };
    const out = await runInventory({ db, env: { KOMERCE_TARGET_ENV: 'staging' } });
    const sqls = db.query.mock.calls.map((c) => c[0]);
    expect(sqls[0]).toBe('BEGIN READ ONLY');
    expect(sqls[sqls.length - 1]).toBe('ROLLBACK');
    expect(sqls.some((q) => /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP)\b/i.test(q))).toBe(false);
    expect(out.mode).toBe('lecture_seule');
    expect(out.target.database).toBe('staging_db');
    expect(JSON.stringify(out)).not.toMatch(/postgres(ql)?:\/\//);
    expect(out.parcel_market_violations).toEqual([]);
  });
});
