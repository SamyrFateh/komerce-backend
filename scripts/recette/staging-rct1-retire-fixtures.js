/** @komerce-arch-lite
 * @role staging-rct1-fixture-retirement
 * @deprecated 2026-11 (LOT 1) : remplace par scripts/recette/staging-reset.js (classification exhaustive, fixtures, verification). Conserve sans suppression ; ne plus utiliser pour un reset Staging.
 * @domain catalog
 * @layer script
 * @owner backend-core
 * @purpose Retire exact RCT1 fixture products from sale without destroying orders, payments or audit history.
 * @db-read products, orders, order_items
 * @db-write-via:product-admin-service products
 * @impact-areas staging-only, catalog, recette
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { PRODUCTS } = require('./rct1/data');
const { confirmTarget } = require('./target-guard');
const { deleteProduct, updateProduct } = require('../../services/product-admin-service');
const { verifyRuntimeRevision } = require('./p1-staging-evidence');

const REFS = Object.freeze(Object.values(PRODUCTS).map(p => p.ref).sort());
const HOST = 'https://komerce-backend-production.up.railway.app';
const ISSUE = '[staging-op] retire-rct1-fixture-products';

function authorize(env, mode) {
  if (env.KOMERCE_ENV !== 'staging' || env.NODE_ENV === 'production' ||
      env.STAGING_BASE_URL !== HOST) throw Error('RCT1_STAGING_ONLY');
  if (!['--dry-run', '--apply'].includes(mode)) throw Error('RCT1_INVALID_MODE');
  if (mode === '--apply' && (env.GITHUB_EVENT_NAME !== 'issues' ||
      !env.GITHUB_ACTOR || env.GITHUB_ACTOR !== env.GITHUB_REPOSITORY_OWNER ||
      env.GITHUB_ISSUE_TITLE !== ISSUE ||
      env.RCT1_RETIRE_CONFIRM !== 'RETIRE_EXACT_RCT1_P1_TO_P5')) {
    throw Error('RCT1_OWNER_APPROVAL_REQUIRED');
  }
  return mode === '--apply';
}

function verifyRoots(rows) {
  if (rows.length > REFS.length) throw Error('RCT1_TOO_MANY_ROOTS');
  for (const p of rows) {
    if (!REFS.includes(p.product_ref) ||
        !String(p.name || '').includes('recette RCT1') ||
        !String(p.description || '').includes('recette RCT1')) {
      throw Error('RCT1_PROVENANCE_UNCONFIRMED:' + p.product_ref);
    }
  }
}

function verifyPreserved(before, after, apply) {
  if (before.length !== after.length) throw Error('RCT1_ROOTS_CHANGED');
  for (const old of before) {
    const now = after.find(p => p.id === old.id && p.product_ref === old.product_ref);
    if (!now || now.preserved_hash !== old.preserved_hash) {
      throw Error('RCT1_PRODUCT_OTHER_FIELDS_CHANGED:' + old.product_ref);
    }
    if (apply && (now.is_active !== false || now.is_available !== false)) {
      throw Error('RCT1_STILL_SELLABLE:' + old.product_ref);
    }
    if (!apply && (now.is_active !== old.is_active || now.is_available !== old.is_available)) {
      throw Error('RCT1_DRY_RUN_CHANGED:' + old.product_ref);
    }
  }
}

async function readProducts(c, lock = false) {
  const sql = `SELECT p.id, p.product_ref, p.name, p.description, p.is_active, p.is_available,
        md5((to_jsonb(p) - 'is_active' - 'is_available' - 'updated_at')::text) AS preserved_hash
      FROM products p WHERE p.product_ref = ANY($1::text[])
      ORDER BY p.product_ref` + (lock ? ' FOR UPDATE' : '');
  return (await c.query(sql, [REFS])).rows;
}

async function inspectOutsideOrders(c, ids) {
  if (!ids.length) return [];
  const { rows } = await c.query(`
    SELECT p.product_ref, count(*)::int AS outside_order_lines
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN products p ON p.id = oi.product_id
     WHERE oi.product_id = ANY($1::uuid[])
       AND o.simulation_scope IS DISTINCT FROM 'RCT1'
     GROUP BY p.product_ref ORDER BY p.product_ref`, [ids]);
  return rows;
}

async function run(mode = process.argv[2], deps = {}) {
  const env = deps.env || process.env;
  const db = deps.db || require('../../db');
  const target = deps.confirm || confirmTarget;
  const report = { phase:'rct1-fixture-retirement', mode, target:HOST, status:'BLOCKED',
    refs:REFS, before:[], after:[], missing:[], outside_orders:[], changed:0, transaction:'NOT_STARTED' };
  const file = path.resolve('test-results/staging-rct1-retirement',
    mode === '--apply' ? 'apply.json' : 'dry-run.json');
  let client;
  try {
    const apply = authorize(env, mode);
    if ((await target({ db, env }))?.confirmed !== true) throw Error('RCT1_TARGET_NOT_CONFIRMED');
    if (!deps.skipVersionCheck) {
      const res = await fetch(HOST + '/health/version', { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw Error('RCT1_RUNTIME_SHA_UNAVAILABLE');
      const data = await res.json();
      report.version = verifyRuntimeRevision(data.commit || data.sha, env.GITHUB_SHA);
    }
    client = await db.pool.connect();
    await client.query('BEGIN'); report.transaction = 'OPEN';
    await client.query("SET LOCAL lock_timeout='3500ms'");
    await client.query("SET LOCAL statement_timeout='15000ms'");
    const before = await readProducts(client, true);
    verifyRoots(before);
    report.before = before.map(p => ({ref:p.product_ref,active:p.is_active,available:p.is_available}));
    report.missing = REFS.filter(ref => !before.some(p => p.product_ref === ref));
    const outsiders = await inspectOutsideOrders(client, before.map(p => p.id));
    report.outside_orders = outsiders;
    if (outsiders.length) throw Error('RCT1_REAL_ORDER_LINK_BLOCKS_RETIREMENT');
    if (apply) {
      for (const p of before) {
        if (p.is_available) {
          const result = await updateProduct(client, p.id, { is_available:false }, null);
          if (result.status !== 200) throw Error('RCT1_AVAILABILITY_REFUSED:' + p.product_ref);
        }
        if (p.is_active) {
          const result = await deleteProduct(client, p.id);
          if (result.status !== 200 || result.body?.success !== true) {
            throw Error('RCT1_DISABLE_REFUSED:' + p.product_ref);
          }
        }
      }
    }
    const after = await readProducts(client);
    verifyPreserved(before, after, apply);
    report.after = after.map(p => ({ref:p.product_ref,active:p.is_active,available:p.is_available}));
    report.changed = apply ? before.filter(p => p.is_active || p.is_available).length : 0;
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    report.transaction = apply ? 'COMMITTED' : 'ROLLED_BACK';
    report.status = apply ? 'RCT1_PRODUCTS_RETIRED' : 'RCT1_DRY_RUN_VERIFIED';
  } catch(e) {
    report.reason = String(e.message || e).slice(0,220);
    if (client) {
      try { await client.query('ROLLBACK'); report.transaction='ROLLED_BACK'; }
      catch(_) { report.transaction='ROLLBACK_FAILED'; }
    }
    if (!deps.silent) console.error('RCT1_RETIREMENT_BLOCKED:' + report.reason);
    process.exitCode = 2;
  } finally {
    if (client) client.release();
    if (!deps.skipReport) {
      fs.mkdirSync(path.dirname(file), { recursive:true });
      fs.writeFileSync(file, JSON.stringify(report,null,2) + '\n');
    }
    if (!deps.db) await db.pool.end();
  }
  return report;
}

if (require.main === module) run();
module.exports = { REFS, HOST, ISSUE, authorize, verifyRoots, verifyPreserved, inspectOutsideOrders, run };
