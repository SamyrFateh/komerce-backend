/**
 * @komerce-arch-lite
 * @role          rct1-engine
 * @domain        economic-engine
 * @layer         script
 * @owner         backend-core
 * @purpose       Moteur commun RCT1 : plan, dry-run, apply, verify, replay, report sur manifeste declaratif.
 * @impact-areas  staging-only, economic-engine, recette
 */
'use strict';

// Un seul orchestrateur. Chaque etape du manifeste porte : id, deps, inspect(ctx) -> {done, detail},
// apply(ctx) -> {writes}, verify(ctx) -> {ok, expected, observed}. Aucune ecriture hors apply().
// apply : une transaction par etape ; l'etape appelle uniquement des services canoniques.
const PHASES = Object.freeze(['plan', 'dry-run', 'apply', 'verify', 'replay', 'report']);

function orderSteps(steps) {
  const byId = new Map(steps.map(s => [s.id, s]));
  const out = []; const state = new Map();
  const visit = (s) => {
    if (state.get(s.id) === 2) return;
    if (state.get(s.id) === 1) throw new Error('RCT1_STEP_CYCLE: ' + s.id);
    state.set(s.id, 1);
    for (const d of s.deps || []) {
      if (!byId.has(d)) throw new Error('RCT1_STEP_DEP_UNKNOWN: ' + s.id + '->' + d);
      visit(byId.get(d));
    }
    state.set(s.id, 2); out.push(s);
  };
  steps.forEach(visit);
  return out;
}

async function inTx(db, readOnly, fn) {
  const client = await db.pool.connect();
  try {
    await client.query(readOnly ? 'BEGIN READ ONLY' : 'BEGIN');
    const r = await fn(client);
    await client.query(readOnly ? 'ROLLBACK' : 'COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }
}

async function run({ db, phase, steps, env = process.env, confirm, only = null }) {
  if (!PHASES.includes(phase)) throw new Error('RCT1_PHASE_UNKNOWN: ' + phase);
  if (String(env.KOMERCE_ENV).toLowerCase() !== 'staging' || env.NODE_ENV === 'production') throw new Error('RCT1_STAGING_ONLY');
  const verdict = await confirm({ db, env });
  if (!verdict || !verdict.confirmed) throw new Error('RCT1_TARGET_NOT_CONFIRMED');
  const ordered = orderSteps(steps).filter(s => !only || only.includes(s.id));
  const ctx = { env, scope: 'RCT1', shared: {} };
  const report = { phase, scope: 'RCT1', target_confirmed: true, steps: [], writes: 0, ok: true };
  for (const step of ordered) {
    const row = { id: step.id };
    const readOnly = phase !== 'apply' && phase !== 'replay';
    const pre = await inTx(db, true, c => step.inspect({ ...ctx, db: c }));
    row.done = !!pre.done; row.detail = pre.detail;
    if (phase === 'apply' || phase === 'replay') {
      if (!pre.done) {
        if (phase === 'replay') { row.ok = false; row.error = 'REPLAY_WOULD_WRITE'; report.ok = false; }
        else {
          const r = await inTx(db, false, c => step.apply({ ...ctx, db: c }));
          row.writes = r.writes || 0; report.writes += row.writes;
          const post = await inTx(db, true, c => step.inspect({ ...ctx, db: c }));
          row.done = !!post.done; row.detail = post.detail;
          if (!post.done) { row.ok = false; row.error = 'APPLY_NOT_CONVERGED'; report.ok = false; }
        }
      } else row.writes = 0;
    } else if (phase === 'verify' || phase === 'report') {
      const v = step.verify ? await inTx(db, true, c => step.verify({ ...ctx, db: c })) : { ok: pre.done };
      Object.assign(row, v);
      if (v.ok === false && phase === 'verify') report.ok = false;
    }
    void readOnly;
    report.steps.push(row);
    if (row.ok === false && phase !== 'report' && phase !== 'verify') break; // dependances : ne pas poursuivre
  }
  return report;
}

module.exports = { PHASES, orderSteps, inTx, run };
