/**
 * @komerce-arch-lite
 * @role staging-finance-oracles-readonly-check
 * @domain finance
 * @layer tooling
 * @owner backend-core
 * @purpose Vérifier sur le schéma live du staging que les 15 invariants O-FIN (I1 à I15,
 *          docs/recette/G6_FINANCE_SQL_ORACLES.sql) s'exécutent, et relever le nombre de
 *          lignes en écart. Aucune donnée de ligne n'est imprimée ni conservée.
 * @db-read tables citées par docs/recette/G6_FINANCE_SQL_ORACLES.sql
 * @db-write none
 */
'use strict';
// Lecture seule à trois niveaux : PGOPTIONS (workflow), option client + BEGIN READ ONLY,
// garde statique du workflow (aucune instruction mutable dans ce fichier ni dans le SQL).
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { confirmTarget } = require('./target-guard');

const ORIGIN = 'https://komerce-backend-production.up.railway.app';
const SQL_FILE = path.resolve('docs/recette/G6_FINANCE_SQL_ORACLES.sql');
const OUTPUT = path.resolve('test-results/staging-finance-oracles/report.json');

function requiredEnvironment(env = process.env) {
  if (env.KOMERCE_ENV !== 'staging' || env.NODE_ENV === 'production'
    || env.STAGING_BASE_URL !== ORIGIN || !env.DATABASE_URL
    || !/default_transaction_read_only=on/.test(env.PGOPTIONS || '')) {
    throw Error('STAGING_READONLY_CONFIGURATION_REQUIRED');
  }
}

// Découpe par en-têtes « -- I<n> », puis par « ; » ; retire les commentaires de ligne.
function parseOracles(text) {
  const blocks = [];
  let cur = null;
  for (const line of text.split('\n')) {
    const m = /^-- (I\d+)\b/.exec(line);
    if (m) { cur = { id: m[1], title: line.slice(3).trim(), body: [] }; blocks.push(cur); continue; }
    if (cur) cur.body.push(line.replace(/--.*$/, ''));
  }
  return blocks.map((b) => ({
    id: b.id, title: b.title,
    statements: b.body.join('\n').split(';').map((s) => s.trim()).filter((s) => /^(SELECT|WITH)\b/i.test(s)),
  }));
}

async function main() {
  requiredEnvironment();
  const sqlText = fs.readFileSync(SQL_FILE, 'utf8');
  const oracles = parseOracles(sqlText);
  const report = {
    kind: 'REAL_STAGING_READ_ONLY_FINANCE_ORACLES', issue: 3987, schema_version: 1,
    generated_at: new Date().toISOString(), live_commit: null, database_target_confirmed: false,
    sql_sha256: require('node:crypto').createHash('sha256').update(sqlText).digest('hex'),
    executed_with: 'default_transaction_read_only=on + BEGIN READ ONLY', oracles: [],
  };
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('sslmode=require')
      ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' } : false,
    options: '-c default_transaction_read_only=on',
    connectionTimeoutMillis: 7000, query_timeout: 30000,
  });
  try {
    await client.connect();
    const verdict = await confirmTarget({
      db: { query: (...a) => client.query(...a) },
      env: { ...process.env, EXPECTED_RAILWAY_ENVIRONMENT: 'staging' },
    });
    if (verdict.confirmed !== true) throw Error('TARGET_IDENTITY_UNVERIFIED');
    report.database_target_confirmed = true;
    try {
      const v = await fetch(ORIGIN + '/health/version', { signal: AbortSignal.timeout(8000) });
      const j = await v.json();
      report.live_commit = String(j.commit || j.sha || '').slice(0, 40) || null;
    } catch (_) { report.live_commit = null; }

    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '25s'");
    for (const o of oracles) {
      const entry = { id: o.id, title: o.title, statements: [] };
      for (const [i, stmt] of o.statements.entries()) {
        const sp = `s_${o.id}_${i}`;
        try {
          await client.query(`SAVEPOINT ${sp}`);
          const r = await client.query(`SELECT count(*)::int AS n FROM (${stmt}) q`);
          await client.query(`RELEASE SAVEPOINT ${sp}`);
          entry.statements.push({ index: i, valid: true, violations: r.rows[0].n });
        } catch (err) {
          await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {});
          entry.statements.push({ index: i, valid: false, error: String(err.message).slice(0, 300) });
        }
      }
      entry.valid = entry.statements.length > 0 && entry.statements.every((s) => s.valid);
      entry.violations = entry.statements.reduce((a, s) => a + (s.violations || 0), 0);
      report.oracles.push(entry);
    }
    await client.query('ROLLBACK');
  } finally {
    await client.end().catch(() => {});
    fs.writeFileSync(OUTPUT, JSON.stringify(report, null, 2));
  }
  for (const o of report.oracles) {
    const errs = o.statements.filter((s) => !s.valid).map((s) => `#${s.index}: ${s.error}`).join(' | ');
    console.log(`${o.id}\t${o.valid ? 'VALID' : 'INVALID'}\tviolations=${o.violations}${errs ? '\t' + errs : ''}`);
  }
  console.log(`statements=${report.oracles.reduce((a, o) => a + o.statements.length, 0)} live_commit=${report.live_commit}`);
}

if (require.main === module) {
  main().catch((err) => { console.error(String(err.message).slice(0, 300)); process.exit(1); });
}
module.exports = { parseOracles };
