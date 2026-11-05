'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { inspect, MIGRATIONS } = require('../../scripts/recette/hub-v1-staging-cert-readonly');

test('inventory Hub staging: read only, migration gate and RCT1 left untouched', async () => {
  const executed = [];
  const client = {
    query: jest.fn(async (sql) => {
      executed.push(sql);
      if (sql === 'BEGIN READ ONLY' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('FROM public.schema_migrations')) {
        return { rows: MIGRATIONS.map(filename => ({ filename, applied_at: '2026-11-05' })) };
      }
      if (sql.includes('FROM public.product_suppliers') && sql.includes('HAVING COUNT(*) > 1')) return { rows: [] };
      if (sql.includes('SELECT o.reference')) return { rows: [{ reference:'RCT1-C',status:'in_transit',payment:'paid',simulation_scope:'RCT1',item_lines:1,purchase_lines:0 }] };
      if (sql.includes('SELECT a.authorization_type')) return { rows: [] };
      return { rows: [{ n: 0 }] };
    }),
  };
  const report = await inspect(client);
  expect(report.mode).toBe('READ_ONLY');
  expect(report.verdict).toBe('SCHEMA_AND_GUARDS_OK_TRANSACTIONAL_STAGING_E2E_NOT_RUN');
  expect(report.fixtures[0].reference).toBe('RCT1-C');
  expect(report.not_proven_by_this_audit.length).toBeGreaterThanOrEqual(5);
  expect(executed[0]).toBe('BEGIN READ ONLY');
  expect(executed.at(-1)).toBe('ROLLBACK');
  expect(executed.slice(1, -1).every(s => /^\s*SELECT\s/i.test(s))).toBe(true);
  expect(executed.join('\n')).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|CREATE|DROP)\s+(INTO|TABLE|FROM|public\.)/i);
});

test('missing migration or local-order Hub allocation is fail-closed', async () => {
  const client = {
    query: jest.fn(async (sql) => {
      if (sql === 'BEGIN READ ONLY' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('FROM public.schema_migrations')) return { rows: [] };
      if (sql.includes('SELECT o.reference') || sql.includes('SELECT a.authorization_type')) return { rows: [] };
      if (sql.includes('HAVING COUNT(*) > 1')) return { rows: [] };
      return { rows: [{ n: sql.includes('LOCAL_STOCK') ? 1 : 0 }] };
    }),
  };
  const result = await inspect(client);
  expect(result.verdict).toBe('SCHEMA_OR_GUARD_MISMATCH_NO_GO');
});
