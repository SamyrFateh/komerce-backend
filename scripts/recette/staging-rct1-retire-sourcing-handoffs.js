/** @komerce-arch-lite
 * @role staging-rct1-sourcing-handoff-retirement
 * @domain catalog
 * @layer script
 * @owner backend-core
 * @purpose Safely retire the five separately sourced fake RCT1 catalog products.
 * @db-read sourcing_candidates, products, orders, order_items
 * @db-write-via:product-admin-service products
 * @impact-areas staging-only, catalog, recette
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { confirmTarget } = require('./target-guard');
const { verifyRuntimeRevision } = require('./p1-staging-evidence');
const { updateProduct, deleteProduct } = require('../../services/product-admin-service');

const HOST = 'https://komerce-backend-production.up.railway.app';
const ISSUE = '[staging-op] retire-rct1-sourcing-handoffs';
const EXPECTED = Object.freeze([
  { candidate_ref: 'RCT1-P1', product_ref: 'KSC-000180' },
  { candidate_ref: 'RCT1-P2', product_ref: 'KSC-000181' },
  { candidate_ref: 'RCT1-P3', product_ref: 'KSC-000182' },
  { candidate_ref: 'RCT1-P4', product_ref: 'KSC-000183' },
  { candidate_ref: 'RCT1-P5', product_ref: 'KSC-000184' },
]);

function authorize(env, mode) {
  if (env.KOMERCE_ENV !== 'staging' || env.NODE_ENV === 'production' ||
      env.STAGING_BASE_URL !== HOST) throw Error('RCT1_SOURCING_STAGING_ONLY');
  if (!['--dry-run', '--apply'].includes(mode)) throw Error('RCT1_SOURCING_INVALID_MODE');
  if (mode === '--apply' && (
    env.GITHUB_EVENT_NAME !== 'issues' ||
    !env.GITHUB_ACTOR || env.GITHUB_ACTOR !== env.GITHUB_REPOSITORY_OWNER ||
    env.GITHUB_ISSUE_TITLE !== ISSUE ||
    env.RCT1_SOURCING_RETIRE_CONFIRM !== 'RETIRE_EXACT_RCT1_SOURCING_FIVE'
  )) throw Error('RCT1_SOURCING_OWNER_APPROVAL_REQUIRED');
  return mode === '--apply';
}

function verifyRows(rows) {
  if (rows.length !== EXPECTED.length) throw Error('RCT1_SOURCING_COUNT_MISMATCH:' + rows.length);
  for (const expected of EXPECTED) {
    const matches = rows.filter(row => row.candidate_ref === expected.candidate_ref);
    if (matches.length !== 1) throw Error('RCT1_SOURCING_CANDIDATE_NOT_UNIQUE:' + expected.candidate_ref);
    const row = matches[0];
    if (row.product_ref !== expected.product_ref ||
        row.supplier_name !== 'RCT1-FICTIF-recette' ||
        !String(row.name || '').startsWith(expected.candidate_ref + ' ') ||
        !String(row.name || '').includes('FICTIF recette') ||
        !row.id) {
      throw Error('RCT1_SOURCING_PROVENANCE_UNCONFIRMED:' + expected.candidate_ref);
    }
  }
}

function verifyAfter(before, after, apply) {
  verifyRows(after);
  for (const old of before) {
    const now = after.find(row => row.id === old.id &&
      row.candidate_ref === old.candidate_ref && row.product_ref === old.product_ref);
    if (!now || old.preserved_hash !== now.preserved_hash)
      throw Error('RCT1_SOURCING_OTHER_FIELDS_CHANGED:' + old.candidate_ref);
    if (apply && (now.is_active !== false || now.is_available !== false))
      throw Error('RCT1_SOURCING_NOT_DISABLED:' + old.candidate_ref);
    if (!apply && (now.is_active !== old.is_active || now.is_available !== old.is_available))
      throw Error('RCT1_SOURCING_DRY_RUN_CHANGED:' + old.candidate_ref);
  }
}

async function readRows(client, lock = false) {
  const sql = [
    'SELECT p.id, p.product_ref, p.name, p.is_active, p.is_available,',
    'sc.id AS candidate_id, sc.candidate_ref, sc.supplier_name,',
    "md5((to_jsonb(p) - 'is_active' - 'is_available' - 'updated_at')::text) AS preserved_hash",
    'FROM sourcing_candidates sc JOIN products p ON p.id=sc.product_id',
    'WHERE sc.candidate_ref=ANY($1::text[])',
    'ORDER BY sc.candidate_ref',
    lock ? 'FOR UPDATE OF p' : ''
  ].join('\n');
  return (await client.query(sql,[EXPECTED.map(row => row.candidate_ref)])).rows;
}

async function checkLinkedData(client, rows) {
  const ids = rows.map(row=>row.id);
  const otherSources = (await client.query(
    'SELECT candidate_ref FROM sourcing_candidates WHERE product_id=ANY($1::uuid[]) AND candidate_ref <> ALL($2::text[])',
    [ids,EXPECTED.map(row=>row.candidate_ref)]
  )).rows;
  if (otherSources.length) throw Error('RCT1_SOURCING_REAL_SOURCE_ASSOCIATED');
  const outside = (await client.query(
    'SELECT p.product_ref, count(*)::int AS n FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN products p ON p.id=oi.product_id ' +
    "WHERE oi.product_id=ANY($1::uuid[]) AND o.simulation_scope IS DISTINCT FROM 'RCT1' GROUP BY p.product_ref",
    [ids]
  )).rows;
  if (outside.length) throw Error('RCT1_SOURCING_REAL_ORDERS_ASSOCIATED');
}

async function run(mode = process.argv[2], deps = {}) {
  const env = deps.env || process.env;
  const db = deps.db || require('../../db');
  const report = { phase:'rct1-sourcing-handoff-retirement',mode,status:'BLOCKED',
    target:HOST,before:[],after:[],changed:0,transaction:'NOT_STARTED' };
  const file = path.resolve('test-results/staging-rct1-sourcing-retirement',
    mode === '--apply' ? 'apply.json' : 'dry-run.json');
  let client;
  try {
    const apply = authorize(env,mode);
    if ((await (deps.confirm || confirmTarget)({db,env}))?.confirmed !== true)
      throw Error('RCT1_SOURCING_TARGET_NOT_CONFIRMED');
    if (!deps.skipVersionCheck) {
      const response=await fetch(HOST+'/health/version',{signal:AbortSignal.timeout(10000)});
      if (!response.ok) throw Error('RCT1_SOURCING_RUNTIME_SHA_UNAVAILABLE');
      const version=await response.json();
      report.version=verifyRuntimeRevision(version.commit || version.sha,env.GITHUB_SHA);
    }
    client=await db.pool.connect();
    await client.query('BEGIN'); report.transaction='OPEN';
    await client.query("SET LOCAL lock_timeout='3500ms'");
    await client.query("SET LOCAL statement_timeout='15000ms'");
    const before=await readRows(client,true);
    verifyRows(before);
    await checkLinkedData(client,before);
    report.before=before.map(row=>({candidate:row.candidate_ref,product:row.product_ref,
      active:row.is_active,available:row.is_available}));
    if (apply) {
      for (const row of before) {
        if (row.is_available) {
          const result=await updateProduct(client,row.id,{is_available:false},null);
          if (result.status!==200) throw Error('RCT1_SOURCING_AVAILABILITY_REFUSED:'+row.product_ref);
        }
        if (row.is_active) {
          const result=await deleteProduct(client,row.id);
          if (result.status!==200 || result.body?.success!==true)
            throw Error('RCT1_SOURCING_DISABLE_REFUSED:'+row.product_ref);
        }
      }
    }
    const after=await readRows(client);
    verifyAfter(before,after,apply);
    // A final verification issue is stricter than a generic dry-run:
    // it proves every RCT1 sourced handoff is already retired in the DB.
    if (!apply && env.GITHUB_ISSUE_TITLE === '[staging-op] verify-rct1-sourcing-handoffs' &&
        after.some(row=>row.is_active!==false || row.is_available!==false)) {
      throw Error('RCT1_SOURCING_FINAL_VERIFICATION_FAILED');
    }
    report.after=after.map(row=>({candidate:row.candidate_ref,product:row.product_ref,
      active:row.is_active,available:row.is_available}));
    report.changed=apply ? before.filter(row=>row.is_available||row.is_active).length : 0;
    await client.query(apply?'COMMIT':'ROLLBACK');
    report.transaction=apply?'COMMITTED':'ROLLED_BACK';
    report.status=apply?'RCT1_SOURCING_PRODUCTS_RETIRED':'RCT1_SOURCING_DRY_RUN_VERIFIED';
  } catch(error) {
    report.reason=String(error.message||error).slice(0,220);
    if (client) {
      try { await client.query('ROLLBACK'); report.transaction='ROLLED_BACK'; }
      catch(_) { report.transaction='ROLLBACK_FAILED'; }
    }
    if (!deps.silent) console.error('RCT1_SOURCING_RETIREMENT_BLOCKED:'+report.reason);
    process.exitCode=2;
  } finally {
    if (client) client.release();
    if (!deps.skipReport) {
      fs.mkdirSync(path.dirname(file),{recursive:true});
      fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
    }
    if (!deps.db) await db.pool.end();
  }
  return report;
}
if (require.main === module) run();
module.exports = { HOST, ISSUE, EXPECTED, authorize,verifyRows,verifyAfter,run };
