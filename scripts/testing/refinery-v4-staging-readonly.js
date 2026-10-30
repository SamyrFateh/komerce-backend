'use strict';
/**
 * STAGING READ-ONLY coverage proof. No writes; no product names or credentials emitted.
 * Connection must be supplied by GitHub's dedicated staging audit secret.
 */
const { Client } = require('pg');
const { buildRefineryWorklist } = require('../../services/refinery-worklist');
const { listRegistry } = require('../../services/catalog-registry');

async function main() {
  if (process.env.KOMERCE_ENV !== 'staging' || process.env.REFINERY_STAGING_READONLY !== '1') {
    throw new Error('staging_readonly_explicit_guard_required');
  }
  if (!process.env.RAILWAY_DATABASE_URL) throw new Error('staging_database_secret_missing');
  const connectionString = process.env.RAILWAY_DATABASE_URL;
  const db = new Client({
    connectionString,
    ssl: connectionString.includes('sslmode=require') ? { rejectUnauthorized: true } : false,
    connectionTimeoutMillis: 10000,
    query_timeout: 15000,
  });
  await db.connect();
  try {
    await db.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    try {
      const [work, catalog] = await Promise.all([
        buildRefineryWorklist({refinery_limit:20},db),
        listRegistry({finalized_only:true,limit:20},db),
      ]);
      const c = work.coverage;
      const covered = c.in_approval_queue + c.unprepared_candidates + c.active_recheck;
      const unaccountedActive = Math.max(0,c.active_products-c.handoff_already_active);
      console.log(JSON.stringify({
        verdict:'READ_ONLY_AUDIT',
        owner:'Raffinerie vs Catalogue',
        approval_pending:c.in_approval_queue,
        drafts_source_unrecognized:c.unprepared_candidates,
        active_handoff_recheck:c.active_recheck,
        active_handoff_total:c.handoff_already_active,
        active_total_global:c.active_products,
        active_without_handoff_estimate:unaccountedActive,
        refinery_work_total_estimate:covered,
        catalog_finalized_total:catalog.page.total,
        redacted:'no identity, name, contact or secret emitted',
      }));
    } finally {
      await db.query('ROLLBACK');
    }
  } finally {
    await db.end();
  }
}

main().catch(err => {
  const message = String(err && (err.code || err.message) || 'unknown');
  // Avoid leaking connection strings from database exception text.
  console.error('STAGING_READONLY_AUDIT_FAILED:', message.slice(0,160).replace(/postgres(?:ql)?:\/\/[^\s]+/ig,'[redacted]'));
  process.exitCode = 1;
});
