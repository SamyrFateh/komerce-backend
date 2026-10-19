'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { run, orderSteps } = require('../../scripts/recette/rct1/engine');
const cli = require('../../scripts/recette/rct1/cli');
const manifest = require('../../scripts/recette/rct1/manifest');

function fakeDb() {
  const log = [];
  const client = { query: async (q) => { log.push(q); return { rows: [] }; }, release() {} };
  return { log, pool: { connect: async () => client } };
}
const env = { KOMERCE_ENV: 'staging', NODE_ENV: 'test' };
const confirm = async () => ({ confirmed: true });

test('ordre par dependances et cycle refuse', () => {
  const s = [{ id: 'b', deps: ['a'] }, { id: 'a' }];
  assert.deepEqual(orderSteps(s).map(x => x.id), ['a', 'b']);
  assert.throws(() => orderSteps([{ id: 'a', deps: ['b'] }, { id: 'b', deps: ['a'] }]), /CYCLE/);
  assert.throws(() => orderSteps([{ id: 'a', deps: ['z'] }]), /DEP_UNKNOWN/);
});
test('refus hors staging ou cible non confirmee', async () => {
  await assert.rejects(run({ db: fakeDb(), phase: 'plan', steps: [], env: { KOMERCE_ENV: 'production' }, confirm }), /STAGING_ONLY/);
  await assert.rejects(run({ db: fakeDb(), phase: 'plan', steps: [], env, confirm: async () => ({ confirmed: false }) }), /TARGET_NOT_CONFIRMED/);
  await assert.rejects(run({ db: fakeDb(), phase: 'nope', steps: [], env, confirm }), /PHASE_UNKNOWN/);
});
test('apply puis rejeu : ecrit une fois, rejeu a zero ecriture', async () => {
  let done = false; let applied = 0;
  const steps = [{ id: 's', inspect: async () => ({ done }), apply: async () => { applied++; done = true; return { writes: 3 }; } }];
  const a = await run({ db: fakeDb(), phase: 'apply', steps, env, confirm });
  assert.equal(a.writes, 3); assert.equal(a.ok, true);
  const r = await run({ db: fakeDb(), phase: 'replay', steps, env, confirm });
  assert.equal(r.writes, 0); assert.equal(applied, 1); assert.equal(r.ok, true);
});
test('plan et dry-run n\'appellent jamais apply ; rejeu detecte une ecriture manquante', async () => {
  const steps = [{ id: 's', inspect: async () => ({ done: false }), apply: async () => { throw new Error('no'); } }];
  const p = await run({ db: fakeDb(), phase: 'plan', steps, env, confirm });
  assert.equal(p.steps[0].done, false);
  const r = await run({ db: fakeDb(), phase: 'replay', steps, env, confirm });
  assert.equal(r.ok, false); assert.equal(r.steps[0].error, 'REPLAY_WOULD_WRITE');
});
test('non convergence detectee', async () => {
  const steps = [{ id: 's', inspect: async () => ({ done: false }), apply: async () => ({ writes: 1 }) }];
  const a = await run({ db: fakeDb(), phase: 'apply', steps, env, confirm });
  assert.equal(a.ok, false); assert.equal(a.steps[0].error, 'APPLY_NOT_CONVERGED');
});
test('verify agrege et manifeste valide', async () => {
  const steps = [{ id: 's', inspect: async () => ({ done: true }), verify: async () => ({ ok: false, expected: 1, observed: 2 }) }];
  const v = await run({ db: fakeDb(), phase: 'verify', steps, env, confirm });
  assert.equal(v.ok, false);
  assert.ok(Array.isArray(manifest.steps));
  assert.equal(typeof cli.introspect, 'function');
});
