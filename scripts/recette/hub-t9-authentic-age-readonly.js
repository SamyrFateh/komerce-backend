#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role hub-t9-authentic-staging-age-readonly
 * @domain logistics
 * @layer script
 * @purpose Read actual persisted Hub task timestamps using database CURRENT_TIMESTAMP;
 *          never fabricate 48h, never write staging, never print business IDs.
 * @impact-areas hub, staging-only, test-only
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { getDirectorTodo, TASK_OVERDUE_AFTER_H } =
  require('../../services/hub-procurement-dossier');

const PHYSICAL = new Set([
  'RECONCILE_PARCEL', 'CLOSE_BAG', 'DEPOSIT_BAG', 'BOX_BAGS',
  'BOX_UNSHIPPED', 'PARCEL_CAPACITY_WAIT',
]);

function assess(director, now) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw Error('T9_REAL_CLOCK_REQUIRED');
  if (director.overdue_after_hours !== 48 || TASK_OVERDUE_AFTER_H !== 48)
    throw Error('T9_UNEXPECTED_THRESHOLD');
  const tasks = Array.isArray(director.tasks) ? director.tasks : [];
  const valid = [];
  let unknown = 0;
  for (const t of tasks) {
    const since = t.since == null ? NaN : Date.parse(t.since);
    if (!Number.isFinite(since)) {
      if (t.age_hours != null || t.overdue === true) throw Error('T9_INVALID_TIMESTAMP_PROJECTED_AS_AGED');
      unknown++; continue;
    }
    const expected = Math.max(0, Math.floor((now.getTime() - since) / 3600000));
    if (t.age_hours !== expected || t.overdue !== (expected >= 48))
      throw Error('T9_PERSISTED_AGE_PROJECTION_INCONSISTENT');
    valid.push({ kind: String(t.kind), market: String(t.market?.code || '?'),
      age_hours: expected, overdue: expected >= 48 });
  }
  if (director.overdue_count !== valid.filter(x => x.overdue).length)
    throw Error('T9_DIRECTOR_OVERDUE_COUNT_INCONSISTENT');
  const due = valid.filter(x => x.overdue);
  const physical = due.filter(x => PHYSICAL.has(x.kind));
  const countByKind = {};
  for (const t of due) countByKind[t.kind] = (countByKind[t.kind] || 0) + 1;
  return {
    schema: 'komerce-hub-t9-readonly-age/1',
    generated_at: now.toISOString(),
    source_clock: 'POSTGRESQL_CURRENT_TIMESTAMP',
    source_records: 'PERSISTED_SINCE_NO_DATE_UPDATE',
    scope: 'ALL_ACTIVE_STAGING_MARKETS',
    mode: 'READ_ONLY',
    threshold_hours: 48,
    observed_tasks: tasks.length,
    tasks_with_valid_persisted_date: valid.length,
    unknown_dates: unknown,
    overdue_count: due.length,
    physical_overdue_count: physical.length,
    overdue_by_kind: countByKind,
    physical_samples_without_ids: physical.slice(0, 10),
    verdict: physical.length
      ? 'T9_AUTHENTIC_PHYSICAL_TASK_48H_PG_PASS_UI_NOT_PROVEN'
      : due.length ? 'T9_AGED_NONPHYSICAL_TASKS_ONLY_PHYSICAL_NOT_PROVEN'
        : 'T9_NO_AGED_TASKS_PRESENT_NOT_PROVEN',
    not_proven: [
      'Le vrai geste Chromium sur un colis/sac âgé de 48h dans le même périmètre',
      'Un redémarrage du backend T5',
      'Une attente de 48h démarrée pendant cette campagne',
    ],
  };
}

async function inspect(client) {
  await client.query('BEGIN READ ONLY');
  try {
    const mode = await client.query('SHOW transaction_read_only');
    if (mode.rows[0]?.transaction_read_only !== 'on') throw Error('T9_READONLY_NOT_ENFORCED');
    const { rows } = await client.query('SELECT CURRENT_TIMESTAMP AS db_now');
    const now = new Date(rows[0].db_now);
    const projection = await getDirectorTodo({ now }, client);
    return assess(projection, now);
  } finally {
    await client.query('ROLLBACK');
  }
}

async function main() {
  if (process.env.KOMERCE_ENV !== 'staging' || process.env.KOMERCE_TARGET_ENV !== 'staging')
    throw Error('T9_STAGING_ONLY');
  if (!process.env.DATABASE_URL) throw Error('T9_DATABASE_URL_REQUIRED');
  // The workflow verifies the Railway fingerprint before executing this reader.
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const client = await pool.connect();
    let report;
    try { report = await inspect(client); } finally { client.release(); }
    const dir = path.join(process.cwd(), 'test-results', 'hub-v1-cert');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'hub-t9-authentic-age-readonly.json'),
      JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(JSON.stringify({
      verdict: report.verdict,
      generated_at: report.generated_at,
      observed: report.observed_tasks,
      older_than_48h: report.overdue_count,
      physical_older_than_48h: report.physical_overdue_count,
      mode: report.mode,
    }) + '\n');
  } finally { await pool.end(); }
}

if (require.main === module) main().catch(err => {
  process.stderr.write('HUB_T9_READONLY_FAIL: ' + String(err.message) + '\n');
  process.exitCode = 2;
});

module.exports = { assess, inspect, PHYSICAL };
