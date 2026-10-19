'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { steps, confirmCashStep } = require('../../scripts/recette/rct1/steps-ops');
const { ORDERS } = require('../../scripts/recette/rct1/data');
const { orderSteps } = require('../../scripts/recette/rct1/engine');
const manifest = require('../../scripts/recette/rct1/manifest');

const db = (rows) => ({ query: async () => ({ rows }) });
test('une etape d\'encaissement par commande, dependance sur la commande', () => {
  const cash = steps.filter(s => s.id.startsWith('ops.cash-confirm.'));
  assert.equal(cash.length, ORDERS.length);
  assert.ok(cash.every(s => s.deps[0].startsWith('order.RCT1-')));
  assert.equal(orderSteps(manifest.steps).length, manifest.steps.length);
});
test('inspect : paye ET colis present', async () => {
  const s = confirmCashStep(ORDERS[0]);
  assert.equal((await s.inspect({ db: db([{ id: 'o', payment_status: 'paid', parcels: 1 }]) })).done, true);
  assert.equal((await s.inspect({ db: db([{ id: 'o', payment_status: 'paid', parcels: 0 }]) })).done, false);
  assert.equal((await s.inspect({ db: db([{ id: 'o', payment_status: 'pending', parcels: 0 }]) })).done, false);
  assert.equal((await s.inspect({ db: db([]) })).done, false);
});
