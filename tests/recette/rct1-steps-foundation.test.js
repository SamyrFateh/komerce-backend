'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { steps, adminStep, relayStep, actorStep, productStep } = require('../../scripts/recette/rct1/steps-foundation');
const { ACTORS, RELAYS, PRODUCTS } = require('../../scripts/recette/rct1/data');
const { orderSteps } = require('../../scripts/recette/rct1/engine');

const db = (rows) => ({ query: async (sql) => ({ rows: rows(sql) }) });

test('manifeste : ordre resolvable, ids uniques, aucun admin cree', () => {
  const ids = steps.map(s => s.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(orderSteps(steps).length, steps.length);
  assert.ok(ACTORS.every(a => a.email.endsWith('@recette.komerce.invalid') && !('password' in a)));
  assert.ok(ACTORS.every(a => a.role !== 'admin'));
});
test('admin existant requis, jamais cree', async () => {
  const shared = {};
  const ok = await adminStep.inspect({ db: db(() => [{ id: 'a1', full_name: 'Admin Komerce' }]), shared });
  assert.equal(ok.done, true); assert.equal(shared.adminId, 'a1');
  assert.equal((await adminStep.inspect({ db: db(() => []), shared: {} })).done, false);
  await assert.rejects(adminStep.apply(), /RCT1_ADMIN_NOT_CREATED_BY_ENGINE/);
});
test('relais : inspect done si actif, apply exige le marche', async () => {
  const step = relayStep(RELAYS[0]);
  assert.equal((await step.inspect({ db: db(() => [{ id: 'r', is_active: true, island_code: 'MORONI' }]) })).done, true);
  assert.equal((await step.inspect({ db: db(() => [{ id: 'r', is_active: true, island_code: 'NGZ' }]) })).done, false);
  assert.equal((await step.inspect({ db: db(() => []) })).done, false);
  await assert.rejects(step.apply({ db: db(() => []) }), /MARKET_MISSING/);
});
test('acteur : role, relais et scope operateur controles', async () => {
  const agent = actorStep(ACTORS.find(a => a.key === 'agent-relais-km'));
  const rows = (sql) => /FROM users/.test(sql) ? [{ id: 'u', role: 'agent_relais', relais_id: 'r1' }] : [{ id: 'r1' }];
  assert.equal((await agent.inspect({ db: db(rows) })).done, true);
  const bad = (sql) => /FROM users/.test(sql) ? [{ id: 'u', role: 'agent_relais', relais_id: null }] : [{ id: 'r1' }];
  assert.equal((await agent.inspect({ db: db(bad) })).done, false);
  const op = actorStep(ACTORS.find(a => a.key === 'operator-km'));
  assert.equal((await op.inspect({ db: db((sql) => /FROM users/.test(sql) ? [{ id: 'u', role: 'market_operator' }] : []) })).done, false);
  assert.equal((await op.inspect({ db: db((sql) => /FROM users/.test(sql) ? [{ id: 'u', role: 'market_operator' }] : [{ ok: 1 }]) })).done, true);
  assert.equal((await op.inspect({ db: db(() => []) })).done, false);
});
test('produit : prix, poids, publication, nom, categorie komerce et stock local controles', async () => {
  // Referentiel douane vide dans le mock : le classifieur canonique replie sur « autre ».
  const route = (rows) => (sql) => /FROM customs_categories/.test(sql) ? [] : rows(sql);
  const base = (p, extra = {}) => ({ id: 'p', name: p.name, category: 'autre', boutique_category_key: p.category, boutique_subcategory_key: p.subcategory,
    is_active: true, is_available: true, price_kmf: String(p.price_kmf), cost_kmf: String(p.cost_kmf), stock: 100, weight_kg: '1', ...extra });
  const p1 = productStep('P1', PRODUCTS.P1);
  const good = [base(PRODUCTS.P1)];
  assert.equal((await p1.inspect({ db: db(route(() => good)) })).done, true);
  assert.equal((await p1.inspect({ db: db(route(() => [{ ...good[0], price_kmf: '15001' }])) })).done, false);
  assert.equal((await p1.inspect({ db: db(route(() => [{ ...good[0], cost_kmf: null }])) })).done, false);
  assert.equal((await p1.inspect({ db: db(route(() => [{ ...good[0], name: 'autre nom' }])) })).done, false);
  assert.equal((await p1.inspect({ db: db(route(() => [{ ...good[0], category: 'Maison' }])) })).done, false);
  assert.equal((await p1.inspect({ db: db(route(() => [{ ...good[0], boutique_category_key: null }])) })).done, false);
  const p3 = productStep('P3', PRODUCTS.P3);
  const p3rows = route((sql) => /FROM products/.test(sql) ? [base(PRODUCTS.P3)]
    : /FROM markets/.test(sql) ? [{ id: 'm' }] : [{ qty_physical: 5, commercial_exposure: 'ENABLED' }]);
  assert.equal((await p3.inspect({ db: db(p3rows) })).done, true);
  const p3bad = (sql) => /local_stock/.test(sql) ? [{ qty_physical: 4, commercial_exposure: 'ENABLED' }] : p3rows(sql);
  assert.equal((await p3.inspect({ db: db(p3bad) })).done, false);
});
