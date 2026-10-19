/**
 * @komerce-arch-lite
 * @role          rct1-cli
 * @domain        economic-engine
 * @layer         script
 * @owner         backend-core
 * @purpose       Point d'entree du moteur RCT1 (phase en argument) et introspection de schema en lecture seule.
 * @impact-areas  staging-only, economic-engine, recette
 */
'use strict';
const { run, PHASES, inTx } = require('./engine');
const { confirmTarget } = require('../target-guard');

async function introspect(db, tables) {
  return inTx(db, true, async (c) => {
    const { rows } = await c.query(
      `SELECT table_name, string_agg(column_name || ':' || data_type || CASE WHEN is_nullable='NO' THEN '!' ELSE '' END, ', ' ORDER BY ordinal_position) AS cols
         FROM information_schema.columns WHERE table_schema='public' AND table_name = ANY($1) GROUP BY table_name ORDER BY table_name`,
      [tables]);
    return rows;
  });
}

async function main() {
  const phase = process.argv[2];
  const db = require('../../../db');
  try {
    if (phase === 'introspect') {
      const tables = String(process.env.RCT1_TABLES || '').split(',').filter(t => /^[a-z_0-9]+$/.test(t));
      const v = await confirmTarget({ db });
      if (!v.confirmed) throw new Error('RCT1_TARGET_NOT_CONFIRMED');
      process.stdout.write(JSON.stringify(await introspect(db, tables), null, 1) + '\n');
      return;
    }
    if (!PHASES.includes(phase)) throw new Error('RCT1_PHASE_UNKNOWN');
    const { steps } = require('./manifest');
    const only = process.env.RCT1_ONLY ? process.env.RCT1_ONLY.split(',') : null;
    const report = await run({ db, phase, steps, confirm: confirmTarget, only });
    process.stdout.write(JSON.stringify(report, null, 1) + '\n');
    if (!report.ok) process.exitCode = 2;
  } finally { if (db.pool && db.pool.end) await db.pool.end(); }
}
if (require.main === module) main().catch(e => { process.stderr.write('RCT1 REFUS: ' + e.message + '\n'); process.exitCode = 1; });
module.exports = { introspect };
