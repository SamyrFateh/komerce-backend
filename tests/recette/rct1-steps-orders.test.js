'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { steps, orderStep, expectedTransportKmf } = require('../../scripts/recette/rct1/steps-orders');
const { ORDERS } = require('../../scripts/recette/rct1/data');
const { orderSteps } = require('../../scripts/recette/rct1/engine');
const manifest = require('../../scripts/recette/rct1/manifest');

const db = (fn) => ({ query: async (sql) => ({ rows: fn(sql) }) });
const rule = [{ v: '65' }];

test('transport attendu : poids x tarif, import seulement', async () => {
  assert.equal(await expectedTransportKmf(db(() => rule), [{ product: 'P1', qty: 1 }]), 65);
  assert.equal(await expectedTransportKmf(db(() => rule), [{ product: 'P3', qty: 1 }]), 0);
  assert.equal(await expectedTransportKmf(db(() => rule), [{ product: 'P1', qty: 2 }]), 130);
});
test('manifeste complet resolvable ; une etape par commande', () => {
  assert.equal(steps.length, ORDERS.length);
  assert.equal(orderSteps(manifest.steps).length, manifest.steps.length);
});
test('inspect : total observe compare a l\'attendu independant', async () => {
  const e1 = orderStep(ORDERS[0]);
  const ok = (sql) => /business_rules/.test(sql) ? rule : /FROM orders/.test(sql)
    ? [{ id: 'o', total_kmf: '15065', simulation_scope: 'RCT1', pm: 'cash_relais', status: 'pending' }] : [{ n: 1, q: 1 }];
  const r = await e1.inspect({ db: db(ok) });
  assert.equal(r.done, true); assert.equal(r.detail.expected_total_kmf, 15065);
  const bad = (sql) => /FROM orders/.test(sql) ? [{ id: 'o', total_kmf: '15000', simulation_scope: 'RCT1', pm: 'cash_relais' }] : ok(sql);
  assert.equal((await e1.inspect({ db: db(bad) })).done, false);
  const unscoped = (sql) => /FROM orders/.test(sql) ? [{ id: 'o', total_kmf: '15065', simulation_scope: null, pm: 'cash_relais' }] : ok(sql);
  assert.equal((await e1.inspect({ db: db(unscoped) })).done, false);
  assert.equal((await e1.inspect({ db: db((sql) => /business_rules/.test(sql) ? rule : []) })).done, false);
});
