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
    // Filtre facultatif par cohorte (lecture seule, comptes uniquement). Sans variable : comportement inchangé.
    const cohortScope = (process.env.ORACLE_COHORT_SCOPE || '').trim() || null;
    const cohortRefs = (process.env.ORACLE_COHORT_REFS || '').split(',').map((x) => x.trim()).filter(Boolean);
    let cohort = null;
    if (cohortScope || cohortRefs.length) {
      const c = await client.query(
        'SELECT id::text AS id, reference FROM orders WHERE ($1::text IS NOT NULL AND simulation_scope = $1) OR reference = ANY($2::text[])',
        [cohortScope, cohortRefs]);
      cohort = { ids: c.rows.map((r) => r.id), refs: c.rows.map((r) => r.reference).filter(Boolean) };
      report.cohort = { scope: cohortScope, refs_requested: cohortRefs.length, orders: cohort.ids.length };
    }
    for (const o of oracles) {
      const entry = { id: o.id, title: o.title, statements: [] };
      for (const [i, stmt] of o.statements.entries()) {
        const sp = `s_${o.id}_${i}`;
        try {
          await client.query(`SAVEPOINT ${sp}`);
          const r = await client.query(`SELECT count(*)::int AS n FROM (${stmt}) q`);
          await client.query(`RELEASE SAVEPOINT ${sp}`);
          const st = { index: i, valid: true, violations: r.rows[0].n };
          if (cohort) {
            const probe = await client.query(`SELECT * FROM (${stmt}) q LIMIT 0`);
            const keys = probe.fields.map((f) => f.name);
            const idCols = keys.filter((k) => ['id', 'order_id', 'reference_id'].includes(k));
            const refCols = keys.filter((k) => k === 'reference');
            if (idCols.length || refCols.length) {
              const cond = [...idCols.map((k) => `q.${k}::text = ANY($1::text[])`),
                ...refCols.map((k) => `q.${k}::text = ANY($2::text[])`)].join(' OR ');
              const cr = await client.query(`SELECT count(*)::int AS n FROM (${stmt}) q WHERE cardinality($1::text[]) >= 0 AND cardinality($2::text[]) >= 0 AND (${cond})`,
                [cohort.ids, cohort.refs]);
              st.cohort_violations = cr.rows[0].n;
            } else { st.cohort_violations = null; st.cohort_applicable = false; }
          }
          entry.statements.push(st);
        } catch (err) {
          await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {});
          entry.statements.push({ index: i, valid: false, error: String(err.message).slice(0, 300) });
        }
      }
      entry.valid = entry.statements.length > 0 && entry.statements.every((s) => s.valid);
      entry.violations = entry.statements.reduce((a, s) => a + (s.violations || 0), 0);
      if (cohort) entry.cohort_violations = entry.statements.reduce((a, s) => a + (s.cohort_violations || 0), 0);
      report.oracles.push(entry);
    }
    // Diagnostic agrégé des écarts I7 et I15 (aucune ligne, uniquement des comptes).
    const i7 = oracles.find((o) => o.id === 'I7').statements[0];
    const i15 = oracles.find((o) => o.id === 'I15').statements[0];
    const diag = `
      WITH a AS (SELECT id FROM (${i7}) x), b AS (SELECT id FROM (${i15}) y),
      u AS (SELECT id, (id IN (SELECT id FROM a)) AS in_i7, (id IN (SELECT id FROM b)) AS in_i15
              FROM (SELECT id FROM a UNION SELECT id FROM b) z)
      SELECT u.in_i7, u.in_i15, o.payment_mode, mk.code AS market,
             to_char(date_trunc('month', o.created_at), 'YYYY-MM') AS month,
             (o.simulation_scope IS NOT NULL) AS simulated, o.status,
             (o.cash_paid_at IS NOT NULL) AS has_cash_paid_at,
             (o.payment_received_at IS NOT NULL) AS has_payment_received_at,
             (COALESCE(o.total_kmf, 0) = 0) AS zero_total, count(*)::int AS n
        FROM u JOIN orders o ON o.id = u.id LEFT JOIN markets mk ON mk.id = o.market_id
       GROUP BY 1,2,3,4,5,6,7,8,9,10 ORDER BY n DESC`;
    try {
      await client.query('SAVEPOINT s_diag');
      report.diagnostic_i7_i15 = (await client.query(diag)).rows;
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT s_diag').catch(() => {});
      report.diagnostic_i7_i15 = { error: String(err.message).slice(0, 300) };
    }
    // Contrôle SQL F3 (#4025) : l'état d'intention durable que lit routes/orders/cancel.js existe sur le schéma live.
    try {
      await client.query('SAVEPOINT s_intents');
      report.durable_intents = (await client.query(
        `SELECT provider, status, count(*)::int AS n FROM refund_execution_intents GROUP BY 1,2 ORDER BY 1,2`)).rows;
      report.durable_intents_columns = (await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name='refund_execution_intents' ORDER BY ordinal_position`)
      ).rows.map((r) => r.column_name);
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT s_intents').catch(() => {});
      report.durable_intents = { error: String(err.message).slice(0, 300) };
    }
    await client.query('ROLLBACK');
  } finally {
    await client.end().catch(() => {});
    fs.writeFileSync(OUTPUT, JSON.stringify(report, null, 2));
  }
  for (const o of report.oracles) {
    const errs = o.statements.filter((s) => !s.valid).map((s) => `#${s.index}: ${s.error}`).join(' | ');
    console.log(`${o.id}\t${o.valid ? 'VALID' : 'INVALID'}\tviolations=${o.violations}${cohort_suffix(o)}${errs ? '\t' + errs : ''}`);
  }
  console.log('INTENTS ' + JSON.stringify(report.durable_intents));
  console.log('DIAG ' + JSON.stringify(report.diagnostic_i7_i15));
  console.log(`statements=${report.oracles.reduce((a, o) => a + o.statements.length, 0)} live_commit=${report.live_commit}`);
}

function cohort_suffix(o) {
  return o.cohort_violations === undefined ? '' : `\tcohort=${o.cohort_violations}${o.statements.some((s) => s.cohort_applicable === false) ? '(partiel: instruction sans colonne commande)' : ''}`;
}

if (require.main === module) {
  main().catch((err) => { console.error(String(err.message).slice(0, 300)); process.exit(1); });
}
module.exports = { parseOracles };
