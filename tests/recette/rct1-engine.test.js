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
test('inventaire : requetes lecture seule uniquement', () => {
  for (const q of Object.values(cli.INVENTORY)) assert.match(q, /^SELECT /);
  assert.equal(typeof cli.inventory, 'function');
});
test('inventaire : rattachement relais E2E contre etalon RCT1 sans fuite de credentials', () => {
  const sql = cli.INVENTORY.relay_agents_e2e_binding;
  assert.match(sql, /FROM users u LEFT JOIN relais r ON r\.id = u\.relais_id/);
  assert.match(sql, /LEFT JOIN markets m ON m\.id = r\.market_id/);
  assert.match(sql, /r\.is_active AS relais_active/);
  assert.match(sql, /UNASSIGNED/);
  assert.match(sql, /INACTIVE_RELAIS/);
  assert.match(sql, /E2E%/);
  assert.match(sql, /RCT1 Agent relais%/);
  assert.doesNotMatch(sql, /password_hash|u\.email|u\.phone/i);
});
test('ONLY : etapes hors selection inspectees (contexte partage) sans ecriture', async () => {
  let applied = 0;
  const steps = [
    { id: 'a', inspect: async (c) => { c.shared.x = 1; return { done: true }; }, apply: async () => { applied++; return { writes: 1 }; } },
    { id: 'b', deps: ['a'], inspect: async (c) => ({ done: c.shared.x === 1 }), apply: async () => ({ writes: 0 }) },
  ];
  const r = await run({ db: fakeDb(), phase: 'apply', steps, env, confirm, only: ['b'] });
  assert.deepEqual(r.steps.map(s => s.id), ['b']);
  assert.equal(applied, 0); assert.equal(r.ok, true);
});
test('dump : liste blanche de tables de reference, jamais de personnes', async () => {
  assert.ok(!cli.DUMP_ALLOWLIST.some(t => /user|order|password|payment/.test(t)));
  const refused = await cli.dump(fakeDb(), ['users']);
  assert.equal(refused.users.error, 'not_allowlisted');
});

test('un echec bloque ses seuls dependants, les scenarios independants continuent', async () => {
  const done = new Set();
  const st = (id, deps, fail) => ({ id, deps, inspect: async () => ({ done: done.has(id) }), apply: async () => { if (fail) throw new Error('boom'); done.add(id); return { writes: 1 }; } });
  const rep = await run({ db: fakeDb(), phase: 'apply', steps: [st('a', []), st('b', ['a'], true), st('c', ['b']), st('d', ['a'])], env: { KOMERCE_ENV: 'staging', NODE_ENV: 'test' }, confirm: async () => ({ confirmed: true }) });
  assert.equal(rep.ok, false);
  const by = Object.fromEntries(rep.steps.map(r => [r.id, r]));
  assert.equal(by.b.error, 'boom');
  assert.equal(by.c.error, 'BLOCKED_BY:b');
  assert.equal(by.d.done, true);
});
