'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { inspect, inspectCommerceKpis, COMMERCE_30D_SQL } = require('../../scripts/recette/rct1-preflight');

const fixedNow = new Date('2026-10-20T16:00:00.000Z');
const empty = { created: 0, paid: 0, paid_sales_kmf: '0', basket_kmf: null, sold_units: 0 };

test('audit KPI : cohorte 30 jours, 5 selections fixes et 7 unités RCT1 payées', async () => {
  const calls = [];
  const client = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (params[2] === 'RCT1' && params[3] === 'ALL') {
      return { rows: [{ created: 7, paid: 6, paid_sales_kmf: '106390', basket_kmf: '17732', sold_units: 7 }] };
    }
    return { rows: [empty] };
  } };
  const out = await inspectCommerceKpis(client, fixedNow);
  assert.equal(out.period_days, 30);
  assert.equal(out.from, '2026-09-20T16:00:00.000Z');
  assert.equal(out.to, '2026-10-20T16:00:00.000Z');
  assert.equal(out.results.RCT1_ALL.sold_units, 7);
  assert.equal(out.results.RCT1_ALL.paid_sales_kmf, 106390);
  assert.equal(out.results.RCT1_ALL.basket_kmf, 17732);
  assert.equal(out.results.REAL_ALL.basket_kmf, null);
  assert.deepEqual(calls.map(c => c.params.slice(2)), [
    ['RCT1', 'ALL'], ['RCT1', 'KM'], ['RCT1', 'CM'], ['RCT1', 'CG'], ['REAL', 'ALL'],
  ]);
  assert.ok(calls.every(c => c.sql === COMMERCE_30D_SQL));
  assert.match(COMMERCE_30D_SQL, /wallet_applied_kmf/);
  assert.match(COMMERCE_30D_SQL, /SUM\(u\.units\)/);
  assert.match(COMMERCE_30D_SQL, /simulation_scope IS NULL/);
  assert.match(COMMERCE_30D_SQL, /simulation_scope = 'RCT1'/);
  assert.doesNotMatch(COMMERCE_30D_SQL, /\b(?:INSERT|UPDATE|DELETE|ALTER|TRUNCATE|DROP)\b/i);
});

test('preflight complet : transaction READ ONLY, résultats agrégés et ROLLBACK systématique', async () => {
  const calls = [];
  let released = 0;
  const client = { query: async (sql, params = []) => {
    calls.push(sql);
    if (sql.includes('information_schema.columns')) return { rows: [{ has_scope: true }] };
    if (sql.includes('SELECT reference, status::text')) return { rows: [
      { reference: 'RCT1-E1', simulation_scope: 'RCT1' },
    ] };
    if (sql.includes('COUNT(*)::int AS total')) return { rows: [{ total: 1, tagged: 1, untagged: 0 }] };
    if (sql.includes('WITH scoped')) return { rows: [empty] };
    if (sql === 'BEGIN READ ONLY' || sql === 'ROLLBACK') return { rows: [] };
    throw new Error('unexpected query');
  }, release: () => { released++; } };
  const result = await inspect({ db: { pool: { connect: async () => client } }, now: fixedNow });
  assert.equal(result.mode, 'READ_ONLY');
  assert.equal(result.commerce_kpis_30d.period_days, 30);
  assert.equal(result.violations.length, 0);
  assert.equal(calls[0], 'BEGIN READ ONLY');
  assert.equal(calls.at(-1), 'ROLLBACK');
  assert.equal(released, 1);
  assert.ok(calls.every(q => /^(?:BEGIN READ ONLY|ROLLBACK|SELECT|WITH)\b/.test(q)));
});
