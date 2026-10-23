'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const { RULES, validateReadOnlySql, runDataRules } = require('../../scripts/lib/logic-data-detectors');

describe('audit:logic — neuf contrôles PostgreSQL de données (contrat SQL)', () => {
  test('chaque règle est SELECT-only, limitée et a une référence d échantillon', () => {
    expect(RULES.map(r => r.rule)).toEqual([
      'LD-01', 'LD-02a', 'LD-02b', 'LD-03', 'LD-04', 'LD-05', 'LD-06', 'LD-07a', 'LD-07b',
    ]);
    for (const r of RULES) {
      expect(validateReadOnlySql(r.sql)).toBe(true);
      expect(r.sql).toMatch(/SELECT .+ AS ref/i);
      expect(r.sql).toMatch(/LIMIT \$1/);
    }
    expect(validateReadOnlySql('UPDATE orders SET status = 1')).toBe(false);
    expect(validateReadOnlySql('SELECT 1; DELETE FROM orders')).toBe(false);
  });

  test.each([
    ['LD-01', 'NOT EXISTS', 'ii.parcel_id'],
    ['LD-02a', 'po.market_id<>lo.market_id', 'po.market_id IS NOT NULL'],
    ['LD-02b', '<>lo.relais_id', 'lo.relais_id IS NOT NULL'],
    ['LD-03', 'pi.created_at>p.shipped_at', 'p.shipped_at IS NOT NULL'],
    ['LD-04', "o.status='collected'", 'SUM(pi.qty_collected)'],
    ['LD-05', "se.actor_role='relay_agent'", 'u.relais_id<>'],
    ['LD-06', "o.payment_status='pending'", "se.status='applied'"],
    ['LD-07a', "r.status='pending'", "INTERVAL '48 hours'"],
    ['LD-07b', "o.payment_status='refunded'", "r.status='completed'"],
  ])('%s — garde métier explicite', (id, a, b) => {
    const q = RULES.find(r => r.rule === id).sql;
    expect(q).toContain(a);
    expect(q).toContain(b);
  });

  test('tous les détecteurs peuvent renvoyer une référence sans exposer des données personnelles', async () => {
    const seen = [];
    const client = {
      query: jest.fn(async (sql, params) => {
        seen.push([sql, params]);
        return { rows: [{ ref: 'opaque-uuid' }] };
      }),
    };
    const results = await runDataRules(client, { sampleSize: 5 });
    expect(results).toHaveLength(9);
    expect(results.every(r => r.status === 'ANOMALIE_DONNEES_A_VERIFIER')).toBe(true);
    expect(results.every(r => r.samples[0] === 'opaque-uuid')).toBe(true);
    expect(results.every(r => r.exhaustiveCount === false)).toBe(true);
    expect(seen.every(([, params]) => params[0] === 6)).toBe(true);
  });

  test('aucun match — absence d anomalie détectée, jamais certification', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const results = await runDataRules(client);
    expect(results.every(r => r.status === 'AUCUNE_ANOMALIE_DETECTEE')).toBe(true);
    expect(results.every(r => r.detectedAtLeast === 0)).toBe(true);
  });

  test('dépassement de la fenêtre — rapport tronqué sans comptage fictif', async () => {
    const rows = [{ ref: 'a' }, { ref: 'b' }, { ref: 'c' }];
    const results = await runDataRules({ query: async () => ({ rows }) }, { sampleSize: 2 });
    expect(results[0]).toMatchObject({
      samples: ['a', 'b'], sampleTruncated: true, detectedAtLeast: 3, exhaustiveCount: false,
    });
  });

  test('une requête non exécutée ou échouée fait échouer tout le contrôle', async () => {
    await expect(runDataRules({ query: async () => { throw Error('permission denied'); } }))
      .rejects.toThrow('permission denied');
    await expect(runDataRules({}, {})).rejects.toThrow('client PostgreSQL');
    await expect(runDataRules({ query() {} }, { sampleSize: 999 })).rejects.toThrow('sampleSize');
  });
});
