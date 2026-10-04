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

      // F2 adds a read-only incident-policy lookup before irreversible parcel
      // transitions. Legacy scripted tests are not about incident policy, so this
      // observational query is neutral by default and does not consume their
      // positional result queue. Dedicated F2 tests exercise blocking rows.
      if (
        normalized.includes('FROM parcels p') &&
        normalized.includes('JOIN incidents i') &&
        normalized.includes("i.status IN ('open', 'investigating')")
      ) {
        return { rows: [], rowCount: 0 };
      }

      if (
        normalized === 'SELECT lifecycle_status FROM markets WHERE id=$1::uuid LIMIT 1'
      ) {
        return { rows: [{ lifecycle_status: 'ACTIVE' }], rowCount: 1 };
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
