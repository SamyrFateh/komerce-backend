'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { included, markdown } = require('../../scripts/audit-logic');

test('audit:logic analyse les sources applicatives et outils suivis, jamais les jeux de test', () => {
  expect(included('services/refund-service.js')).toBe(true);
  expect(included('routes/parcels.js')).toBe(true);
  expect(included('scripts/lib/arch-drift-core.js')).toBe(true);
  expect(included('tests/e2e-api/foo.e2e.test.js')).toBe(false);
  expect(included('migrations/050_example.js')).toBe(false);
  expect(included('node_modules/mod/index.js')).toBe(false);
});

test('le rapport refuse de faire passer une suspicion pour un bug confirmé', () => {
  const report = markdown({
    sha: 'testSHA', base: 'baseSHA', scannedFiles: 5, changedFiles: 1,
    findings: [{
      rule: 'LS-03', priority: 'P1', category: 'FIN', novelty: 'NEW',
      file: 'services/paypal-client.js', line: 8, snippet: 'Date.now()',
    }],
    newFindings: 1,
    gates: [{ name: 'Gouvernance', status: 'PASS' }],
  });
  expect(report).toContain('suspicion');
  expect(report).toContain('P1');
  expect(report).toContain('**Portée :**');
  expect(report).not.toContain('1 bug confirmé');
});

test('la lecture de données est transactionnelle READ ONLY, sans COMMIT', async () => {
  const { readOnlyDataChecks } = require('../../scripts/audit-logic');
  const sql = [];
  const client = {
    query: jest.fn(async (statement) => {
      sql.push(statement);
      return { rows: [] };
    }),
    release: jest.fn(),
  };
  const db = { connect: jest.fn().mockResolvedValue(client), pool: { end: jest.fn().mockResolvedValue() } };
  const prior = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://explicit-readonly-contract';
  try {
    const results = await readOnlyDataChecks(db);
    expect(results).toHaveLength(9);
    expect(sql[0]).toBe('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(sql[1]).toMatch(/^SET LOCAL statement_timeout/);
    expect(sql.slice(2, -1).every(s => /^SELECT /i.test(s))).toBe(true);
    expect(sql.at(-1)).toBe('ROLLBACK');
    expect(sql).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(db.pool.end).toHaveBeenCalledTimes(1);
  } finally {
    if (prior === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prior;
  }
});

test('une requête SQL échouée laisse ROLLBACK et libère la connexion', async () => {
  const { readOnlyDataChecks } = require('../../scripts/audit-logic');
  const sql = [];
  const client = {
    query: jest.fn(async statement => {
      sql.push(statement);
      if (/^SELECT/.test(statement)) throw Error('statement timeout');
      return { rows: [] };
    }),
    release: jest.fn(),
  };
  const db = { connect: async () => client, pool: { end: jest.fn().mockResolvedValue() } };
  const prior = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://explicit-readonly-contract';
  try {
    await expect(readOnlyDataChecks(db)).rejects.toThrow('statement timeout');
    expect(sql.at(-1)).toBe('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
    expect(db.pool.end).toHaveBeenCalled();
  } finally {
    if (prior === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prior;
  }
});
