#!/usr/bin/env node
'use strict';
/**
 * @komerce-arch-lite
 * @role hub-h1h9-sonnet-t9
 * @domain logistics
 * @layer script
 * @purpose T9 (cohorte Sonnet, G2) : `create` pose UN colis fournisseur arrive sans manifeste (meme appel HTTP que l'UI,
 *          POST /api/scans/hub/receive, contents=[]) ; `check` relit en LECTURE SEULE l'alerte, l'anciennete et la vue directrice
 *          apres 48 h. Aucune reecriture d'horodatage, aucun avancement de l'objet.
 * @impact-areas hub, staging-only, test-only
 */
const fs = require('node:fs');
const path = require('node:path');
const { Actor, assertTarget } = require('./hub-v1-http-action-runner');
const RUN8 = /^[A-F0-9]{8}$/;
const refOf = (run8) => `E2E-HUB-V1-${run8}-T9-AGED`;
const sha = async (base) => String(((await (await fetch(base + '/health/version')).json()) || {}).commit || '');

async function readOnly(db, fn) {
  const c = await db.getClient();
  try {
    await c.query('BEGIN READ ONLY');
    if ((await c.query('SHOW transaction_read_only')).rows[0].transaction_read_only !== 'on') throw Error('T9_READONLY_NOT_ENFORCED');
    return await fn(c);
  } finally { await c.query('ROLLBACK').catch(() => {}); c.release(); }
}
const unitOf = (c, ref) => c.query(
  "SELECT id, state, unit_type, created_at, CURRENT_TIMESTAMP AS db_now FROM hub_physical_units WHERE reference=$1", [ref]).then((r) => r.rows);

async function create({ env = process.env, db, run8 }) {
  if (!RUN8.test(run8 || '')) throw Error('T9_RUN8_REQUIRED');
  const { base, local } = assertTarget(env);
  if (local) throw Error('T9_STAGING_ONLY');
  const ref = refOf(run8);
  const sha0 = await sha(base);
  if (!/^[a-f0-9]{40}$/i.test(sha0)) throw Error('T9_DEPLOY_SHA_UNREADABLE');
  const existing = await readOnly(db, (c) => unitOf(c, ref));
  const report = { schema: 'hub-h1h9-sonnet-t9-create/1', run8, reference: ref, sha_start: sha0, started_at: new Date().toISOString() };
  if (existing.length) { report.already_exists = true; }
  else {
    const hub = new Actor('hub_agent', base, env.E2E_AGENT_HUB_EMAIL, env.E2E_AGENT_HUB_PASSWORD);
    await hub.login();
    if (hub.role !== 'agent_hub') throw Error('T9_ROLE_MISMATCH');
    const r = await hub.call('POST', '/api/scans/hub/receive',
      { reference: ref, location_ref: 'HUB-E2E-RECEPTION', tracking_ref: `E2E-TRACK-${run8}-T9`, contents: [] });
    report.http = r.http; report.reconciliation_mode = r.json && r.json.reconciliation_mode;
    if (r.http !== 201 || report.reconciliation_mode !== 'UNRECONCILED') throw Error(`T9_CREATE_REFUSED:${r.http}:${r.code || ''}`);
  }
  const [u] = await readOnly(db, (c) => unitOf(c, ref));
  if (!u) throw Error('T9_OBJECT_NOT_FOUND_AFTER_CREATE');
  const audit = await readOnly(db, (c) => c.query('SELECT COUNT(*)::int n FROM hub_custody_events WHERE physical_unit_id=$1', [u.id]));
  report.object = { unit_type: u.unit_type, state: u.state, created_at: new Date(u.created_at).toISOString(), custody_events: audit.rows[0].n };
  report.sha_end = await sha(base);
  report.sha_stable = report.sha_end === sha0;
  report.inert = 'Aucune etape ne doit faire avancer cet objet (pas de reconcile, pas de deplacement). Les campagnes E2E filtrent la tache RECONCILE_PARCEL de cette reference.';
  return report;
}

// Lecture seule, au plus tot 48 h apres created_at. Echoue (verdict T9_NOT_YET_48H) si le seuil n'est pas atteint.
async function check({ db, run8, expectedCreatedAt }) {
  if (!RUN8.test(run8 || '')) throw Error('T9_RUN8_REQUIRED');
  const { getDirectorTodo, getDossier, TASK_OVERDUE_AFTER_H } = require('../../services/hub-procurement-dossier');
  if (TASK_OVERDUE_AFTER_H !== 48) throw Error('T9_UNEXPECTED_THRESHOLD');
  const ref = refOf(run8);
  return readOnly(db, async (c) => {
    const [u] = await unitOf(c, ref);
    if (!u) return { verdict: 'T9_FAIL_OBJECT_MISSING', reference: ref };
    const now = new Date(u.db_now);
    const created = new Date(u.created_at);
    const out = { schema: 'hub-h1h9-sonnet-t9-check/1', mode: 'READ_ONLY', reference: ref, checked_at: now.toISOString(),
      created_at: created.toISOString(), state: u.state, checks: {} };
    out.checks.timestamp_not_rewritten = expectedCreatedAt ? created.toISOString() === new Date(expectedCreatedAt).toISOString() : 'NOT_COMPARED';
    out.checks.state_unchanged = u.state === 'RECEIVED';
    out.checks.no_placement = (await c.query('SELECT COUNT(*)::int n FROM hub_physical_unit_placements WHERE physical_unit_id=$1', [u.id])).rows[0].n === 0;
    const ageH = Math.floor((now - created) / 3600000);
    out.age_hours_real = ageH;
    if (ageH < 48) return { ...out, verdict: 'T9_NOT_YET_48H' };
    const dir = await getDirectorTodo({ now }, c);
    const id = `RECONCILE_PARCEL:${u.id}`;
    const task = (dir.tasks || []).find((t) => t.id === id);
    out.checks.director_view_lists_task = Boolean(task);
    if (task) {
      out.checks.alert_overdue = task.overdue === true && dir.overdue_count >= 1;
      out.checks.displayed_age_hours = task.age_hours;
      out.checks.displayed_age_matches_real = task.age_hours === Math.max(0, Math.floor((now - Date.parse(task.since)) / 3600000));
      out.checks.since_equals_created_at = new Date(task.since).toISOString() === created.toISOString();
    }
    const ok = Object.values(out.checks).every((v) => v === true || v === 'NOT_COMPARED' || typeof v === 'number');
    return { ...out, verdict: ok ? 'T9_PG_PASS_UI_NOT_PROVEN' : 'T9_FAIL' };
  });
}

async function main() {
  const mode = process.argv[2];
  const db = require('../../db');
  try {
    if (process.env.KOMERCE_ENV !== 'staging' || process.env.KOMERCE_TARGET_ENV !== 'staging') throw Error('T9_STAGING_ONLY');
    const { confirmTarget } = require('./target-guard');
    if (!(await confirmTarget({ db })).confirmed) throw Error('T9_TARGET_MISMATCH');
    const run8 = String(process.env.T9_RUN8 || '').toUpperCase();
    const report = mode === 'create' ? await create({ db, run8 })
      : mode === 'check' ? await check({ db, run8, expectedCreatedAt: process.env.T9_EXPECTED_CREATED_AT })
        : (() => { throw Error('T9_MODE_create_or_check'); })();
    const dir = path.join('test-results', 'hub-h1h9-sonnet');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `t9-${mode}-${run8}.json`), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
    if (/FAIL/.test(report.verdict || '') || report.sha_stable === false) process.exitCode = 1;
  } finally { if (db.pool && db.pool.end) await db.pool.end(); }
}
if (require.main === module) main().catch((e) => { console.error('T9_REFUSED:' + String(e.message).slice(0, 200)); process.exitCode = 2; });
module.exports = { create, check, refOf };
