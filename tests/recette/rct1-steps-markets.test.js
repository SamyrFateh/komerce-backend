'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { steps, marketStep, leadStep } = require('../../scripts/recette/rct1/steps-markets');
const { MARKET_PROVISIONING, MARKET_PROVISIONING_PARAMS, MARKET_ORDERS } = require('../../scripts/recette/rct1/data');
const { orderSteps } = require('../../scripts/recette/rct1/engine');
const manifest = require('../../scripts/recette/rct1/manifest');

const db = (rows) => ({ query: async () => ({ rows: rows() }) });

test('manifeste complet resolvable avec CM/CG, J et K', () => {
  assert.equal(orderSteps(manifest.steps).length, manifest.steps.length);
  const ids = steps.map(s => s.id);
  for (const id of ['lead.CM', 'lead.CG', 'market.CM', 'market.CG', 'actor.operator-cm', 'actor.operator-cg', 'check.J.market-mismatch', 'check.K.isolation']) assert.ok(ids.includes(id), id);
});
test('parametres de recette : fictifs, prestataire mtn_momo, plafonds 1 000 000, aucun prix CG', () => {
  const l = MARKET_PROVISIONING_PARAMS.financial_limits;
  assert.deepEqual(Object.values(l), [1000000, 1000000, 1000000, 1000000]);
  assert.equal(MARKET_PROVISIONING_PARAMS.payment_provider.provider, 'mtn_momo');
  assert.ok(MARKET_ORDERS.every(o => o.market === 'CM'));
  assert.ok(MARKET_PROVISIONING.CM.currency === 'XAF' && MARKET_PROVISIONING.CG.currency === 'XAF');
});
test('marche : done seulement si ACTIVE et is_active', async () => {
  const st = marketStep(MARKET_PROVISIONING.CM);
  assert.equal((await st.inspect({ db: db(() => [{ code: 'CM', currency: 'XAF', is_active: true, lifecycle_status: 'ACTIVE' }]) })).done, true);
  assert.equal((await st.inspect({ db: db(() => [{ code: 'CM', currency: 'XAF', is_active: false, lifecycle_status: 'DRAFT' }]) })).done, false);
  assert.equal((await st.inspect({ db: db(() => []) })).done, false);
});
test('responsable : done si le compte existe avec le role operateur', async () => {
  const st = leadStep(MARKET_PROVISIONING.CG);
  assert.equal((await st.inspect({ db: db(() => [{ id: 'u', role: 'market_operator' }]) })).done, true);
  assert.equal((await st.inspect({ db: db(() => []) })).done, false);
});
