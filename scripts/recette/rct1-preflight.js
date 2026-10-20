/**
 * @komerce-arch-lite
 * @role          rct1-staging-preflight
 * @domain        economic-engine
 * @layer         script
 * @owner         backend-core
 * @purpose       Inventorier en lecture seule les commandes RCT1 et confirmer le périmètre simulation.
 * @impact-areas  staging-only, economic-engine, recette
 */
'use strict';

// RCT1 preflight: strictly read-only. No installation and no state transitions.
// target-guard.js MUST be called by the workflow before this script.

const COMMERCE_30D_SQL = `
WITH scoped AS (
  SELECT o.id, o.payment_status::text AS payment_status,
         o.status::text AS status, o.total_kmf, o.wallet_applied_kmf
    FROM orders o
   WHERE o.created_at >= $1 AND o.created_at <= $2
     AND (($3::text = 'REAL' AND o.simulation_scope IS NULL)
       OR ($3::text = 'RCT1' AND o.simulation_scope = 'RCT1'))
     AND ($4::text = 'ALL'
       OR EXISTS (SELECT 1 FROM markets mk WHERE mk.id = o.market_id AND mk.code = $4))
),
order_units AS (
  SELECT oi.order_id, SUM(oi.quantity)::int AS units
    FROM order_items oi
   WHERE oi.order_id IN (SELECT id FROM scoped)
   GROUP BY oi.order_id
)
SELECT COUNT(*)::int AS created,
       COUNT(*) FILTER (WHERE s.payment_status = 'paid'
          AND s.status NOT IN ('cancelled','refunded'))::int AS paid,
       COALESCE(SUM(s.total_kmf + COALESCE(s.wallet_applied_kmf,0))
         FILTER (WHERE s.payment_status = 'paid'
          AND s.status NOT IN ('cancelled','refunded')),0)::bigint AS paid_sales_kmf,
       AVG(s.total_kmf + COALESCE(s.wallet_applied_kmf,0))
         FILTER (WHERE s.payment_status = 'paid'
          AND s.status NOT IN ('cancelled','refunded'))::bigint AS basket_kmf,
       COALESCE(SUM(u.units) FILTER (WHERE s.payment_status = 'paid'
          AND s.status NOT IN ('cancelled','refunded')),0)::int AS sold_units
  FROM scoped s
  LEFT JOIN order_units u ON u.order_id = s.id`;

async function inspectCommerceKpis(client, now = new Date()) {
  const to = new Date(now);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 30);
  const results = {};
  // Fixed scope/market allowlist: no user-supplied SQL or cross-market result merging.
  for (const [scope, market] of [
    ['RCT1', 'ALL'], ['RCT1', 'KM'], ['RCT1', 'CM'], ['RCT1', 'CG'],
    ['REAL', 'ALL'],
  ]) {
    const { rows } = await client.query(COMMERCE_30D_SQL, [
      from.toISOString(), to.toISOString(), scope, market,
    ]);
    const r = rows[0];
    results[`${scope}_${market}`] = {
      created: Number(r.created),
      paid: Number(r.paid),
      paid_sales_kmf: Number(r.paid_sales_kmf),
      basket_kmf: r.basket_kmf == null ? null : Number(r.basket_kmf),
      sold_units: Number(r.sold_units),
    };
  }
  return { period_days: 30, from: from.toISOString(), to: to.toISOString(),
    money_unit: 'KMF', source: 'independent_sql_orders_and_order_items',
    results };
}
async function inspect({ db, now = new Date() }) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const version = await client.query(
      "SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='simulation_scope') AS has_scope");
    if (!version.rows[0].has_scope) throw new Error('migration 303 absente : simulation_scope indisponible');
    const orders = await client.query(
      "SELECT reference, status::text AS status, simulation_scope, created_at FROM orders WHERE reference LIKE 'RCT1-%' OR simulation_scope = 'RCT1' ORDER BY created_at, reference LIMIT 200");
    const counts = await client.query(
      "SELECT COUNT(*)::int AS total, COUNT(*) FILTER(WHERE simulation_scope='RCT1')::int AS tagged, COUNT(*) FILTER(WHERE reference LIKE 'RCT1-%' AND simulation_scope IS DISTINCT FROM 'RCT1')::int AS untagged FROM orders WHERE reference LIKE 'RCT1-%' OR simulation_scope='RCT1'");
    const bad = orders.rows.filter(x => x.reference.startsWith('RCT1-') && x.simulation_scope !== 'RCT1');
    const commerce = await inspectCommerceKpis(client, now);
    const out = {
      mode: 'READ_ONLY', scope: 'RCT1', migration_303: true,
      totals: counts.rows[0], orders: orders.rows, commerce_kpis_30d: commerce,
      violations: bad.map(x => ({ reference: x.reference, reason: 'RCT1_SCOPE_MISSING' })),
      installation_confirmed: false,
      next: 'Installer seulement via les services canoniques après validation de ce rapport'
    };
    await client.query('ROLLBACK');
    return out;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
async function main() {
  const db = require('../../db');
  try {
    const report = await inspect({ db });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    if (report.violations.length) process.exitCode = 2;
  } finally { await db.pool.end(); }
}
if (require.main === module) main().catch(e => { process.stderr.write('RCT1 PREFLIGHT REFUS: ' + e.message + '\n'); process.exitCode = 1; });
module.exports = { inspect, inspectCommerceKpis, COMMERCE_30D_SQL };
