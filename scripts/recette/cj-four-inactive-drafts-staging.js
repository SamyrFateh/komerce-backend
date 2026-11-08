#!/usr/bin/env node
'use strict';
/** @komerce-arch
 * @role cj-four-staging-catalogue-handoff
 * @domain sourcing
 * @layer script
 * @criticality high
 * @inputs official staging KIR-000014 and exact owner approval
 * @outputs four inactive Catalogue drafts, no prices or market publication
 * @depends scripts/recette/cj-four-catalogue-readiness-readonly.js, services/sourcing-candidate-actions.js
 * @db-read import_runtime_runs, sourcing_candidates, products, product_skus, product_market_exposure
 * @db-write-via services/sourcing-candidate-actions.js
 * @doctrine exact_four_cj_staging_only_fail_closed
 * @impact-areas sourcing, catalog, staging
 */
const fs = require('node:fs');
const path = require('node:path');
const db = require('../../db');
const { audit, EXPECTED, RUN_REF } = require('./cj-four-catalogue-readiness-readonly');
const { confirmTarget } = require('./target-guard');
const { handoffCertifiedImport } = require('../../services/sourcing-candidate-actions');
const OUT = path.resolve('test-results/cj-four-inactive-drafts/report.json');

function pin(url) {
  try { const u = new URL(url); return u.hostname + ':' + (u.port || '5432') + u.pathname; }
  catch (_) { return null; }
}
function guard(e) {
  if (e.GITHUB_ACTIONS !== 'true' || e.KOMERCE_ENV !== 'staging' || e.NODE_ENV !== 'test'
    || e.CJ_FOUR_DRAFT_HANDOFF_APPROVED !== '1'
    || e.EXPECTED_RAILWAY_ENVIRONMENT !== 'staging'
    || e.STAGING_BASE_URL !== 'https://komerce-backend-production.up.railway.app'
    || !e.DATABASE_URL || !e.KOMERCE_STAGING_RESET_DB_PIN
    || pin(e.DATABASE_URL) !== e.KOMERCE_STAGING_RESET_DB_PIN) {
    throw new Error('CJ_FOUR_DRAFT_HANDOFF_STAGING_GUARD_REQUIRED');
  }
}
async function readback() {
  const { rows } = await db.query(
    `SELECT c.candidate_ref, c.supplier_product_id, c.state, c.product_id,
            p.product_ref, p.price_kmf, p.is_active, p.is_available, p.lifecycle_status,
            (SELECT count(*)::int FROM product_skus s WHERE s.product_id = p.id) AS sku_count,
            (SELECT count(*)::int FROM product_market_exposure e WHERE e.product_id = p.id) AS exposure_count
       FROM import_runtime_runs r JOIN sourcing_candidates c ON c.import_id = r.import_id
       LEFT JOIN products p ON p.id = c.product_id
      WHERE r.run_ref = $1 ORDER BY c.candidate_ref`, [RUN_REF]);
  const { rows: [total] } = await db.query('SELECT count(*)::int AS count FROM products');
  const identity = rows.length === EXPECTED.size
    && rows.every(r => EXPECTED.get(r.candidate_ref) === r.supplier_product_id);
  const drafts = rows.length === EXPECTED.size && rows.every(r =>
    r.product_id && r.product_ref && r.state === 'imported_to_catalog'
    && r.is_active === false && r.is_available === false && r.price_kmf == null
    && r.lifecycle_status === 'candidate' && Number(r.exposure_count) === 0
    && Number(r.sku_count) > 0);
  return { total_products: total.count, rows, identity_ok: identity,
    drafts_ok: drafts, verified: identity && drafts && total.count === EXPECTED.size };
}
async function run() {
  guard(process.env);
  const target = await confirmTarget({ db });
  if (!target?.confirmed) throw new Error('CJ_FOUR_DRAFT_HANDOFF_TARGET_NOT_CONFIRMED');
  const ready = await audit();
  if (ready.verdict !== 'FOUR_INACTIVE_DRAFTS_READINESS_PASS'
    || ready.blockers.length || ready.product_count !== 0
    || ready.candidates.length !== EXPECTED.size
    || !ready.candidates.every(c => c.ready_for_inactive_draft))
    throw new Error('CJ_FOUR_DRAFT_HANDOFF_READINESS_NOT_PASS');
  const { rows: runs } = await db.query(
    'SELECT import_id FROM import_runtime_runs WHERE run_ref = $1', [RUN_REF]);
  if (runs.length !== 1 || !runs[0].import_id)
    throw new Error('CJ_FOUR_DRAFT_HANDOFF_SOURCE_RUN_NOT_UNIQUE');
  const handoff = await handoffCertifiedImport(runs[0].import_id);
  const after = await readback();
  return { target_fingerprint: target.fingerprint, run_ref: RUN_REF,
    handoff, ...after, price_and_publication: 'NOT_CERTIFIED',
    verdict: after.verified && handoff.catalogued === EXPECTED.size
      && handoff.failed.length === 0
      ? 'FOUR_INACTIVE_DRAFTS_CREATED' : 'FOUR_DRAFTS_POSTCHECK_FAILED' };
}
async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  let report;
  try {
    report = await run();
    process.exitCode = report.verdict === 'FOUR_INACTIVE_DRAFTS_CREATED' ? 0 : 2;
  } catch (err) {
    report = { run_ref: RUN_REF, verdict: 'FOUR_DRAFT_HANDOFF_FAILED',
      error: String(err.code || err.message).slice(0, 200),
      price_and_publication: 'NOT_CERTIFIED' };
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
    console.log('[CJ_FOUR_INACTIVE_DRAFTS] ' + JSON.stringify(report));
    await db.pool.end();
  }
}
if (require.main === module) main();
module.exports = { pin, guard, readback, run };
