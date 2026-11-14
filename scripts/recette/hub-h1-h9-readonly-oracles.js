/**
 * @komerce-arch-lite
 * @role hub-h1-h9-readonly-oracles
 * @domain hub
 * @layer tooling
 * @owner backend-core
 * @purpose Certification Hub #3998 (S7) : exécuter les oracles SQL H1 à H9 en lecture seule sur le
 *          staging, uniquement sur un SHA confirmé par /health/version (post-fusion de #4014),
 *          et rendre PASS / FAIL / NOT_PROVEN par oracle. Aucun état n'est modifié.
 * @db-read orders, order_items, v_purchase_line_progress, parcel_items, parcels, purchase_lines,
 *          hub_purchase_allocations, hub_physical_units, hub_physical_unit_placements,
 *          hub_box_bags, international_shipment_hub_units
 * @db-write none
 */
'use strict';
// Lecture seule garantie à trois niveaux (cf. economic-engine-staging-readonly-census.js) :
//  1. PGOPTIONS='-c default_transaction_read_only=on' ; 2. client ouvert avec la même option + BEGIN READ ONLY ;
//  3. garde statique du workflow et test unitaire (aucune instruction SQL mutable).
// Barrière de SHA : sans HUB_EXPECTED_SHA (fichier hub-h1-h9-expected-sha.txt) égal au commit
// publié par /health/version, AUCUNE connexion base n'est ouverte et le verdict est NOT_PROVEN.
const fs = require('node:fs');
const path = require('node:path');

const ORIGIN = 'https://komerce-backend-production.up.railway.app';
const SQL_FILE = path.join(__dirname, 'sql', 'hub-h1-h9-readonly.sql');
const OUTPUT = path.resolve('test-results/staging-hub-h1-h9/oracles.json');
const MAX_ROWS = 50;
// Lignes à rapprocher plutôt que FAIL automatique (doctrine : rupture/incident légitimes, attente datée).
const NEEDS_RECONCILIATION = new Set(['H2', 'H5b', 'H8', 'H9']);
const MUTATING = /\b(INSERT\s+INTO|UPDATE\s+[a-z_."]+\s+SET|DELETE\s+FROM|TRUNCATE|ALTER\s+(TABLE|SEQUENCE|FUNCTION)|DROP\s|CREATE\s|GRANT\s|REVOKE\s|COPY\s|CALL\s|DO\s+\$|SELECT\s+[^;]*\bpg_advisory|SELECT\s+[^;]*\bnextval|FOR\s+(UPDATE|SHARE))\b/i;

function parseOracles(text) {
  const blocks = [];
  let current = null;
  for (const line of String(text).split('\n')) {
    const m = /^-- (H[1-9][ab]?) —/.exec(line);
    if (m) { current = { id: m[1], lines: [] }; blocks.push(current); continue; }
    if (current) current.lines.push(line);
  }
  return blocks
    .map(b => ({ id: b.id, sql: b.lines.filter(l => !/^\s*--/.test(l)).join('\n').trim() }))
    .filter(b => /^SELECT\b/i.test(b.sql));
}

function assertReadOnlySql(oracles) {
  for (const o of oracles) {
    if (!/^SELECT\b/i.test(o.sql) || MUTATING.test(o.sql) || o.sql.replace(/;\s*$/, '').includes(';')) {
      throw Error(`ORACLE_NOT_READ_ONLY_${o.id}`);
    }
  }
}

function verdictOf(id, rowCount) {
  if (rowCount === 0) return 'PASS';
  return NEEDS_RECONCILIATION.has(id) ? 'FAIL_TO_RECONCILE' : 'FAIL';
}

function summarize(results) {
  if (results.some(r => r.verdict === 'NOT_PROVEN')) return 'NOT_PROVEN';
  if (results.some(r => r.verdict === 'FAIL')) return 'FAIL';
  if (results.some(r => r.verdict === 'FAIL_TO_RECONCILE')) return 'FAIL_TO_RECONCILE';
  return 'PASS';
}

function expectedSha(env = process.env) {
  const sha = String(env.HUB_EXPECTED_SHA || '').trim();
  return /^[0-9a-f]{7,40}$/i.test(sha) ? sha.toLowerCase() : null;
}

function shaMatches(expected, live) {
  const e = String(expected || '').toLowerCase();
  const l = String(live || '').toLowerCase();
  return Boolean(e && l && (l.startsWith(e) || e.startsWith(l)));
}

function requiredEnvironment(env = process.env) {
  if (env.KOMERCE_ENV !== 'staging' || env.NODE_ENV === 'production'
    || env.STAGING_BASE_URL !== ORIGIN || !env.DATABASE_URL
    || !/default_transaction_read_only=on/.test(env.PGOPTIONS || '')) {
    throw Error('STAGING_READONLY_CONFIGURATION_REQUIRED');
  }
}

function writeReport(report) {
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(report, null, 2));
}

async function main() {
  requiredEnvironment();
  const oracles = parseOracles(fs.readFileSync(SQL_FILE, 'utf8'));
  assertReadOnlySql(oracles);
  const report = {
    kind: 'HUB_H1_H9_STAGING_READ_ONLY_ORACLES', issue: 3998, schema_version: 1,
    generated_at: new Date().toISOString(), expected_sha: expectedSha(), live_commit: null,
    database_target_confirmed: false, no_business_writes: true, scope: 'GLOBAL_STAGING_NOT_COHORT_FILTERED',
    overall: 'NOT_PROVEN', results: [],
  };
  if (!report.expected_sha) {
    report.reason = 'HUB_EXPECTED_SHA_ABSENT (#4014 non fusionnée/déployée ou SHA non renseigné) : aucune connexion base ouverte';
    writeReport(report); console.log(JSON.stringify({ overall: report.overall, reason: report.reason })); return;
  }
  const v = await fetch(`${ORIGIN}/health/version`, { signal: AbortSignal.timeout(8000) });
  const j = await v.json();
  report.live_commit = String(j.commit || j.sha || '').slice(0, 40) || null;
  if (!shaMatches(report.expected_sha, report.live_commit)) {
    report.reason = 'LIVE_SHA_MISMATCH : le staging ne sert pas le SHA attendu';
    writeReport(report); console.log(JSON.stringify({ overall: report.overall, reason: report.reason })); process.exitCode = 1; return;
  }
  const { Client } = require('pg');
  const { confirmTarget } = require('./target-guard');
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('sslmode=require')
      ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' } : false,
    options: '-c default_transaction_read_only=on', connectionTimeoutMillis: 7000, query_timeout: 20000,
  });
  let tx = false;
  try {
    await client.connect();
    const verdict = await confirmTarget({
      db: { query: (...a) => client.query(...a) },
      env: { ...process.env, EXPECTED_RAILWAY_ENVIRONMENT: 'staging' },
    });
    if (verdict.confirmed !== true) throw Error('TARGET_IDENTITY_UNVERIFIED');
    report.database_target_confirmed = true;
    await client.query('BEGIN READ ONLY'); tx = true;
    await client.query("SET LOCAL statement_timeout='15000ms'");
    const ro = await client.query('SHOW transaction_read_only');
    if (ro.rows[0].transaction_read_only !== 'on') throw Error('READ_ONLY_NOT_ENFORCED');
    for (const o of oracles) {
      try {
        await client.query(`SAVEPOINT s_${o.id}`);
        const r = await client.query(o.sql);
        await client.query(`RELEASE SAVEPOINT s_${o.id}`);
        report.results.push({ id: o.id, verdict: verdictOf(o.id, r.rowCount), row_count: r.rowCount,
          sample: r.rows.slice(0, MAX_ROWS) });
      } catch (err) {
        await client.query(`ROLLBACK TO SAVEPOINT s_${o.id}`).catch(() => {});
        report.results.push({ id: o.id, verdict: 'NOT_PROVEN', error: String(err.message).slice(0, 300) });
      }
    }
    report.overall = summarize(report.results);
  } finally {
    if (tx) await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  }
  writeReport(report);
  console.log(JSON.stringify({ overall: report.overall, results: report.results.map(r => `${r.id}:${r.verdict}`) }));
  if (report.overall !== 'PASS') process.exitCode = 1;
}

if (require.main === module) {
  main().catch(err => { console.error(String(err.message || err).slice(0, 300)); process.exit(2); });
}
module.exports = { parseOracles, assertReadOnlySql, verdictOf, summarize, shaMatches, expectedSha };
