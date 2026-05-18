'use strict';

function makeClient(script = []) {
  const calls = [];
  const queue = [...script];

  const client = {
    calls,
    released: false,
    query: jest.fn(async (sql, params = []) => {
      calls.push({ sql, params });
      const normalized = String(sql).replace(/\s+/g, ' ').trim();

      if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') {
        return { rows: [], rowCount: 0 };
      }

      const next = queue.shift();
      if (!next) {
        throw new Error(`No mock query result for SQL: ${normalized}`);
      }
      if (typeof next === 'function') return next(sql, params, calls);
      if (next.error) throw next.error;
      return { rows: next.rows || [], rowCount: next.rowCount ?? (next.rows ? next.rows.length : 0) };
    }),
    release: jest.fn(() => { client.released = true; }),
  };

  return client;
}

function expectTransactionCommitted(client) {
  const sqls = client.calls.map(c => String(c.sql).trim());
  expect(sqls).toContain('BEGIN');
  expect(sqls).toContain('COMMIT');
  expect(sqls).not.toContain('ROLLBACK');
  expect(client.release).toHaveBeenCalled();
}

function expectTransactionRolledBack(client) {
  const sqls = client.calls.map(c => String(c.sql).trim());
  expect(sqls).toContain('BEGIN');
  expect(sqls).toContain('ROLLBACK');
  expect(client.release).toHaveBeenCalled();
}

module.exports = { makeClient, expectTransactionCommitted, expectTransactionRolledBack };
