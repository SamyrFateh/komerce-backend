#!/usr/bin/env node
'use strict';
/**
 * @komerce-arch
 * @role          staging-t3-stalled-orders-readonly
 * @domain        purchasing
 * @layer         tooling
 * @criticality   low
 * @inputs        DATABASE_URL (staging), STAGING_BASE_URL
 * @outputs       repartition par motif des commandes `ordered` IMPORT selectionnees par le balayage H1 (comptes agreges, sans donnee personnelle)
 * @depends       scripts/recette/target-guard.js, services/purchasing-completion-service.js (computeCompletion, pur), services/order-physical-coverage-service.js (lecture)
 * @used-by       .github/workflows/staging-cert-prereq-readonly.yml
 * @db-read       orders, order_items, v_purchase_line_progress, purchase_lines, purchase_orders
 * @db-write      none
 * @db-txn        BEGIN READ ONLY
 * @doctrine      staging_only, read_only, no_secret_output, no_personal_data
 * @impact-areas  staging, purchasing, certification
 * @version       2026-11
 */
const fs = require('fs');
const path = require('path');
const { confirmTarget } = require('./target-guard');

// Meme selection que sweepStalledOrders (sans LIMIT).
const CANDIDATES_SQL = `
  SELECT o.id, o.created_at, o.payment_status::text AS payment_status, o.payment_mode::text AS payment_mode,
         (o.reference ~ '^(E2E|HP0|TEST)' ) AS fixture_like
    FROM orders o
   WHERE o.status = 'ordered'
     AND EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.fulfillment_source = 'IMPORT')
     AND NOT EXISTS (SELECT 1 FROM v_purchase_line_progress v
                      WHERE v.order_id = o.id AND NOT v.cancelled AND v.received_quantity < v.effective_quantity)
   ORDER BY o.created_at ASC, o.id::text ASC`;

async function classify(client) {
  const { computeCompletion } = require('../../services/purchasing-completion-service');
  const { getOrderPhysicalCoverage } = require('../../services/order-physical-coverage-service');
  const { rows: candidates } = await client.query(CANDIDATES_SQL);
  const tally = {};
  const bump = (key) => { tally[key] = (tally[key] || 0) + 1; };
  const ages = [];
  for (const o of candidates) {
    const { rows: items } = await client.query(
      `SELECT id, quantity FROM order_items WHERE order_id = $1 AND COALESCE(fulfillment_source, '') <> 'LOCAL_STOCK'`, [o.id]);
    const { rows: lines } = await client.query(
      `SELECT line_id, order_item_id, purchase_order_id, effective_quantity, received_quantity
         FROM v_purchase_line_progress WHERE order_id = $1 AND NOT cancelled`, [o.id]);
    const ids = lines.map((l) => l.line_id).filter(Boolean);
    const { rows: settled } = ids.length
      ? await client.query('SELECT id FROM purchase_lines WHERE id = ANY($1::uuid[]) AND settled_at IS NOT NULL', [ids]) : { rows: [] };
    const { rows: [legacy] } = await client.query('SELECT COUNT(*)::int AS n FROM purchase_orders WHERE order_id = $1', [o.id]);
    const verdict = computeCompletion(items, lines, new Set(settled.map((r) => r.id)));
    let coverage = 'n/a';
    if (verdict.complete) {
      const cov = await getOrderPhysicalCoverage(client, o.id);
      coverage = cov.covered ? 'covered' : 'PHYSICAL_RECEPTION_INCOMPLETE';
    }
    const reason = verdict.complete ? `COMPLETE_${coverage}` : verdict.blockers.join('+') || 'UNKNOWN';
    bump(JSON.stringify({ reason, payment_status: o.payment_status, payment_mode: o.payment_mode, purchase_lines: lines.length ? 'some' : 'none', legacy_purchase_orders: legacy.n ? 'some' : 'none', fixture_like: Boolean(o.fixture_like) }));
    ages.push(new Date(o.created_at).getTime());
  }
  const by_reason = {};
  const rows = Object.entries(tally).map(([k, n]) => ({ ...JSON.parse(k), orders: n }));
  for (const r of rows) by_reason[r.reason] = (by_reason[r.reason] || 0) + r.orders;
  return {
    candidates: candidates.length, by_reason, breakdown: rows.sort((a, b) => b.orders - a.orders),
    oldest: ages.length ? new Date(Math.min(...ages)).toISOString().slice(0, 10) : null,
    newest: ages.length ? new Date(Math.max(...ages)).toISOString().slice(0, 10) : null,
  };
}

async function assess({ db, fetchImpl = fetch, env = process.env } = {}) {
  if (env.KOMERCE_ENV !== 'staging' || env.KOMERCE_TARGET_ENV !== 'staging') throw new Error('STAGING_ONLY');
  const target = await confirmTarget({ db, fetchImpl, env });
  if (!target.confirmed) throw new Error('STAGING_FINGERPRINT_NOT_CONFIRMED');
  const client = await db.getClient();
  try {
    await client.query('BEGIN READ ONLY');
    const report = await classify(client);
    await client.query('ROLLBACK');
    return { mode: 'READ_ONLY', ...report };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* connexion fermee */ }
    throw e;
  } finally { client.release(); }
}

async function main() {
  const db = require('../../db');
  try {
    const report = await assess({ db });
    const dir = path.join('test-results', 'cert-prereq');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'prereq-readonly.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
  } finally { if (db.pool && db.pool.end) await db.pool.end(); }
}

if (require.main === module) main().catch((e) => { console.error(`REFUS: ${String(e.message)}`); process.exitCode = 2; });
module.exports = { assess, classify, CANDIDATES_SQL };
