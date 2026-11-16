/**
 * @komerce-arch-lite
 * @role staging-claude-par-g6-readonly-proof
 * @domain recette
 * @layer tooling
 * @owner backend-core
 * @purpose Preuves PostgreSQL en lecture seule de la cohorte CLAUDE-PAR (G6) : manifeste derive, SHA-256 consigne avant verdicts, oracles O-FIN/O-HUB/O-ECO par cohorte.
 * @db-read users, orders, order_items, wallets, refunds, purchase_lines, hub_*, parcels, relais, local_stock, product_market_exposure
 * @db-write none
 */
'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { Client } = require('pg');
const { confirmTarget } = require('./target-guard');
const ORIGIN = 'https://komerce-backend-production.up.railway.app';
const OUT = path.resolve('test-results/claude-par-g6');
const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'claude-par-g6-run.json'), 'utf8'));
const RUN8 = String(CFG.run8 || '').toUpperCase();
const NAME_LIKE = `CLAUDE-PAR-G6 ${RUN8}%`;
const rep = { agent: 'CLAUDE-PAR', run8: RUN8, phase: CFG.phase, label: CFG.label, started_at: new Date().toISOString(), staging_sha: null, manifest: null, manifest_sha256: null, oracles: {}, readiness: {}, errors: {} };
// scope: [colonne de la sortie, ensemble du manifeste]
const SCOPE = { I1: ['id', 'wallet_ids'], I2: ['id', 'wallet_ids'], I3: ['id', 'order_ids'], I4: ['id', 'order_ids'], I5: ['id', 'order_ids'], I6: ['id', 'order_ids'], I7: ['id', 'order_ids'],
  I8a: ['stripe_event_id', 'psp_event_ids'], I8b: ['order_id', 'order_ids'], I9: ['user_id', 'user_ids'], I10: ['return_order_item_id', 'order_item_ids'], I11: ['order_id', 'order_ids'],
  I12a: ['order_id', 'order_ids'], I12b: ['order_id', 'order_ids'], I13: ['purchase_order_id', 'purchase_order_ids'], I14: ['id', 'order_ids'], I15a: ['id', 'order_ids'], I15b: ['id', 'refund_ids'],
  H1: ['id', 'order_ids'], H2: ['order_id', 'order_ids'], H3: ['id', 'order_ids'], H4: ['order_item_id', 'order_item_ids'], H5a: ['line_id', 'purchase_line_ids'], H5b: ['id', 'allocation_ids'],
  H6: ['id', 'order_item_ids'], H7: null, H8: ['id', 'physical_unit_ids'], H9: ['id', 'physical_unit_ids'] };
function parseSql(file) { // [{label, sql}] ; label = dernier "-- Ixx/Hxx" vu, suffixe a/b pour les requetes multiples
  const lines = fs.readFileSync(path.resolve('docs/recette', file), 'utf8').split('\n'); const out = []; let label = null, buf = [], seen = {};
  for (const l of lines) {
    const m = l.match(/^-- ((?:I|H|Q)\d+[ab]?)\b/); if (m) { label = m[1]; continue; }
    if (/^\s*--/.test(l)) continue; if (!l.trim() && !buf.length) continue; buf.push(l);
    if (/;\s*$/.test(l)) { const n = seen[label] = (seen[label] || 0) + 1; out.push({ label, n, sql: buf.join('\n').replace(/;\s*$/, '') }); buf = []; }
  }
  const cnt = {}; out.forEach(o => { cnt[o.label] = (cnt[o.label] || 0) + 1; });
  return out.map(o => ({ key: cnt[o.label] > 1 ? o.label + 'ab'[o.n - 1] : o.label, sql: o.sql }));
}
async function sec(c, name, sql, params = []) {
  try { await c.query(`SAVEPOINT s`); const r = await c.query(sql, params); await c.query('RELEASE SAVEPOINT s'); return r.rows; }
  catch (e) { await c.query('ROLLBACK TO SAVEPOINT s').catch(() => {}); rep.errors[name] = String(e.message).slice(0, 200); return null; }
}
const ids = (rows, col = 'id') => (rows || []).map(r => String(r[col]));
async function manifest(c) {
  const M = { agent: 'CLAUDE-PAR', run8: RUN8, market: 'KM,CM,CG', staging_sha: rep.staging_sha, started_at: rep.started_at, stabilized_at: new Date().toISOString() };
  const users = await sec(c, 'm_users', `SELECT id FROM users WHERE full_name ILIKE $1`, [NAME_LIKE]); M.user_ids = ids(users);
  const g = async (n, sql, p) => ids(await sec(c, 'm_' + n, sql, [p]));
  M.wallet_ids = await g('wal', 'SELECT id FROM wallets WHERE user_id = ANY($1::uuid[])', M.user_ids);
  M.order_ids = await g('ord', 'SELECT id FROM orders WHERE user_id = ANY($1::uuid[])', M.user_ids);
  M.order_item_ids = await g('oi', 'SELECT id FROM order_items WHERE order_id = ANY($1::uuid[])', M.order_ids);
  M.refund_ids = await g('ref', 'SELECT id FROM refunds WHERE order_id = ANY($1::uuid[])', M.order_ids);
  M.purchase_line_ids = await g('pl', 'SELECT id FROM purchase_lines WHERE order_item_id = ANY($1::uuid[])', M.order_item_ids);
  M.purchase_order_ids = await g('po', 'SELECT DISTINCT purchase_order_id AS id FROM purchase_lines WHERE id = ANY($1::uuid[]) AND purchase_order_id IS NOT NULL', M.purchase_line_ids);
  M.allocation_ids = await g('al', 'SELECT id FROM hub_purchase_allocations WHERE order_id = ANY($1::uuid[])', M.order_ids);
  M.parcel_ids = await g('pa', 'SELECT id FROM parcels WHERE order_id = ANY($1::uuid[])', M.order_ids);
  M.physical_unit_ids = await g('pu', 'SELECT id FROM hub_physical_units WHERE order_id = ANY($1::uuid[])', M.order_ids);
  M.psp_event_ids = [];
  for (const k of Object.keys(M)) if (Array.isArray(M[k])) M[k].sort();
  return M;
}
async function main() {
  if (process.env.KOMERCE_ENV !== 'staging' || !process.env.DATABASE_URL || !/default_transaction_read_only=on/.test(process.env.PGOPTIONS || '')) throw Error('STAGING_READONLY_CONFIGURATION_REQUIRED');
  fs.mkdirSync(OUT, { recursive: true });
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes('sslmode=require') ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' } : false, options: '-c default_transaction_read_only=on', connectionTimeoutMillis: 7000, query_timeout: 30000 });
  let tx = false;
  try {
    await c.connect();
    const v = await confirmTarget({ db: { query: (...a) => c.query(...a) }, env: { ...process.env, EXPECTED_RAILWAY_ENVIRONMENT: 'staging' } });
    if (v.confirmed !== true) throw Error('TARGET_IDENTITY_UNVERIFIED');
    rep.staging_sha = String((await (await fetch(ORIGIN + '/health/version')).json()).commit || '');
    await c.query('BEGIN READ ONLY'); tx = true; await c.query("SET LOCAL statement_timeout='20000ms'");
    if ((await c.query('SHOW transaction_read_only')).rows[0].transaction_read_only !== 'on') throw Error('READ_ONLY_NOT_ENFORCED');
    // 1) manifeste derive puis SHA-256 consigne AVANT tout verdict
    const M = await manifest(c); rep.manifest = Object.fromEntries(Object.entries(M).map(([k, x]) => [k, Array.isArray(x) ? { count: x.length } : x]));
    rep.manifest_sha256 = crypto.createHash('sha256').update(JSON.stringify(M)).digest('hex');
    fs.writeFileSync(path.join(OUT, 'cohort-manifest.json'), JSON.stringify(M, null, 2));
    console.log('MANIFEST_SHA256', rep.manifest_sha256, 'run8', RUN8);
    // 2) baseline precedente (cles par requete)
    let base = null; try { base = JSON.parse(fs.readFileSync(path.resolve('baseline/oracle-keys.json'), 'utf8')); } catch (_) {}
    // 3) oracles
    const keysOut = {};
    for (const [file, tag] of [['G6_FINANCE_SQL_ORACLES.sql', 'O-FIN'], ['G6_HUB_SQL_ORACLES.sql', 'O-HUB']]) {
      for (const q of parseSql(file)) {
        const rows = await sec(c, q.key, q.sql);
        const sc = SCOPE[q.key];
        const o = { oracle: tag, global_rows: rows ? rows.length : null };
        if (rows === null) o.verdict = 'NOT_PROVEN_INVALID_QUERY';
        else if (sc === null) { o.verdict = 'NOT_PROVEN'; o.motif = 'liaison placement->allocation->commande non demontree'; }
        else if (!sc) { o.verdict = 'NOT_PROVEN'; o.motif = 'portee non definie'; }
        else if (rows.length && !(sc[0] in rows[0])) { o.verdict = 'NOT_PROVEN'; o.motif = 'cle de portee absente de la sortie'; }
        else if (sc[1] === 'psp_event_ids' && !M.psp_event_ids.length) { o.verdict = 'NOT_APPLICABLE'; o.motif = 'aucun webhook PSP simule par la cohorte'; }
        else {
          const set = new Set(M[sc[1]]); const keys = rows.map(r => String(r[sc[0]])); keysOut[q.key] = keys;
          const inC = keys.filter(k => set.has(k)), out = keys.filter(k => !set.has(k));
          const hist = out.filter(k => base && (base[q.key] || []).includes(k)).length;
          o.cohort_rows = inC.length; o.historique = base ? hist : 'baseline_absente'; o.anomalie_hors_cohorte = base ? out.length - hist : 'baseline_absente';
          o.cohort_manifest_set_size = set.size;
          o.verdict = inC.length ? 'FAIL_COHORT_ROWS' : (set.size ? 'PASS_ZERO_COHORT_ROWS' : 'NOT_PROVEN_COHORT_EMPTY');
          if (inC.length) o.sample_cohort_keys = inC.slice(0, 5);
        }
        rep.oracles[q.key] = o;
      }
    }
    fs.writeFileSync(path.join(OUT, 'oracle-keys.json'), JSON.stringify(keysOut));
    // O-ECO : diagnostics de configuration (comptes, qualification manuelle)
    rep.oracles_eco = {};
    for (const q of parseSql('G6_ECO_SQL_CONTROLS.sql')) { const rows = await sec(c, q.key, q.sql); rep.oracles_eco[q.key] = rows ? { rows: rows.length, sample: rows.slice(0, 6) } : 'INVALID'; }
    // 4) readiness / cohorte (lecture)
    const R = rep.readiness;
    R.markets = await sec(c, 'r_m', `SELECT code, id FROM markets ORDER BY code`);
    R.claude_par_accounts = await sec(c, 'r_acc', `SELECT u.role::text AS role, m.code AS relay_market, (u.relais_id IS NOT NULL) AS has_relais FROM users u LEFT JOIN relais r ON r.id=u.relais_id LEFT JOIN markets m ON m.id=r.market_id WHERE u.email ILIKE 'claude-par-%' ORDER BY 1`);
    R.relais_by_market = await sec(c, 'r_rel', `SELECT m.code, r.is_active, COUNT(*)::int AS n FROM relais r JOIN markets m ON m.id=r.market_id GROUP BY 1,2 ORDER BY 1`);
    R.local_stock = await sec(c, 'r_ls', `SELECT m.code, ls.commercial_exposure, COUNT(*)::int AS products, SUM(ls.qty_physical)::int AS qty FROM local_stock ls JOIN markets m ON m.id=ls.market_id GROUP BY 1,2 ORDER BY 1`);
    R.exposure = await sec(c, 'r_ex', `SELECT m.code, e.commercial_exposure, COUNT(*)::int AS n FROM product_market_exposure e JOIN markets m ON m.id=e.market_id GROUP BY 1,2 ORDER BY 1`);
    R.orders_by_status = await sec(c, 'r_ob', `SELECT status::text AS status, COUNT(*)::int AS n FROM orders GROUP BY 1 ORDER BY 1`);
    R.e2e_marked_clients = await sec(c, 'r_e2e', `SELECT COUNT(*)::int AS n FROM e2e_test_accounts e JOIN users u ON u.id=e.user_id WHERE u.role='client'`);
    await c.query('ROLLBACK'); tx = false;
    rep.staging_sha_end = String((await (await fetch(ORIGIN + '/health/version')).json()).commit || '');
    rep.sha_stable = rep.staging_sha === rep.staging_sha_end;
  } catch (e) { rep.fatal = String(e.message || e).slice(0, 300); process.exitCode = 1; }
  finally { if (tx) await c.query('ROLLBACK').catch(() => {}); await c.end().catch(() => {}); }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(rep, null, 2));
  const verd = {}; for (const [k, o] of Object.entries(rep.oracles)) verd[o.verdict] = (verd[o.verdict] || 0) + 1;
  console.log(JSON.stringify({ sha: rep.staging_sha, sha_stable: rep.sha_stable, manifest_sha256: rep.manifest_sha256, verdicts: verd, errors: rep.errors, fatal: rep.fatal || null }));
}
main();
