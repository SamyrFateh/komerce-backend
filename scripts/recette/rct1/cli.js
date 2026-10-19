/**
 * @komerce-arch-lite
 * @role          rct1-cli
 * @domain        economic-engine
 * @layer         script
 * @owner         backend-core
 * @purpose       Point d'entree du moteur RCT1 (phase en argument) et introspection de schema en lecture seule.
 * @impact-areas  staging-only, economic-engine, recette
 */
'use strict';
const { run, PHASES, inTx } = require('./engine');
const { confirmTarget } = require('../target-guard');

async function introspect(db, tables) {
  return inTx(db, true, async (c) => {
    const { rows } = await c.query(
      `SELECT table_name, string_agg(column_name || ':' || data_type || CASE WHEN is_nullable='NO' THEN '!' ELSE '' END, ', ' ORDER BY ordinal_position) AS cols
         FROM information_schema.columns WHERE table_schema='public' AND table_name = ANY($1) GROUP BY table_name ORDER BY table_name`,
      [tables]);
    return rows;
  });
}

// Inventaire lecture seule : une transaction par requete (une erreur n'invalide pas les autres).
const INVENTORY = Object.freeze({
  markets: "SELECT code, currency, minor_unit, is_active, lifecycle_status FROM markets ORDER BY code",
  users_by_role: "SELECT role::text AS role, COUNT(*)::int AS n FROM users GROUP BY 1 ORDER BY 1",
  rct1_users: "SELECT id, role::text AS role, full_name, relais_id FROM users WHERE full_name ILIKE 'RCT1%' OR email ILIKE 'rct1%' ORDER BY full_name",
  admins: "SELECT id, full_name, role::text AS role, last_login_at FROM users WHERE role::text IN ('admin','superadmin','super_admin') ORDER BY created_at LIMIT 5",
  relais_by_market: "SELECT m.code, COUNT(r.id)::int AS n, COUNT(*) FILTER (WHERE r.is_active)::int AS active FROM markets m LEFT JOIN relais r ON r.market_id=m.id GROUP BY m.code ORDER BY m.code",
  rct1_relais: "SELECT id, name, market_id, is_active FROM relais WHERE name ILIKE 'RCT1%' OR id::text LIKE '5eed1000%'",
  products: "SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_active)::int AS active, COUNT(*) FILTER (WHERE product_ref LIKE 'RCT1-%')::int AS rct1 FROM products",
  rct1_products: "SELECT id, product_ref, name, price_kmf, is_active, is_available, lifecycle_status, sourcing_source, weight_kg FROM products WHERE product_ref LIKE 'RCT1-%' ORDER BY product_ref",
  orders: "SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE simulation_scope IS NOT NULL)::int AS scoped FROM orders",
  assignments: "SELECT m.code, a.status, a.id FROM market_operating_assignments a JOIN markets m ON m.id=a.market_id ORDER BY m.code",
  rates: "SELECT * FROM exchange_rates ORDER BY 1 LIMIT 10",
  cost_components_relay: "SELECT key, scope, scope_value, default_value, provenance, is_active FROM cost_components WHERE key ILIKE '%relay%' OR key ILIKE '%relais%' ORDER BY key LIMIT 20",
  suppliers: "SELECT COUNT(*)::int AS n FROM suppliers",
  shipments: "SELECT COUNT(*)::int AS n FROM shipments",
  taxonomy: "SELECT c.key, c.db_keys, c.is_active, (SELECT string_agg(s.key, ',') FROM boutique_subcategories s WHERE s.category_key=c.key) AS subs FROM boutique_categories c ORDER BY c.display_order LIMIT 15",
  sample_active_product: "SELECT product_ref, category, subcategory, price_kmf, weight_kg, stock, sourcing_source, lifecycle_status, inventory_model, image_url IS NOT NULL AS has_image FROM products WHERE is_active LIMIT 2",
  transport_rules: "SELECT key, value FROM business_rules WHERE key IN ('SEA_KMF_PER_KG_COMMERCIAL','AIR_KMF_PER_KG_TAXABLE','FREIGHT_KMF_PER_KG','CUSTOMS_DEFAULT_PCT','AED_KMF_FALLBACK','CASH_PAYMENT_TIMEOUT_HOURS')",
  migrations_tail: "SELECT * FROM schema_migrations ORDER BY 1 DESC LIMIT 3",
});
async function inventory(db) {
  const out = {};
  for (const [k, q] of Object.entries(INVENTORY)) {
    try { out[k] = await inTx(db, true, async (c) => (await c.query(q)).rows); }
    catch (e) { out[k] = { error: String(e.message).slice(0, 120) }; }
  }
  return out;
}

async function main() {
  const phase = process.argv[2];
  const db = require('../../../db');
  try {
    if (phase === 'introspect') {
      const tables = String(process.env.RCT1_TABLES || '').split(',').filter(t => /^[a-z_0-9]+$/.test(t));
      const v = await confirmTarget({ db });
      if (!v.confirmed) throw new Error('RCT1_TARGET_NOT_CONFIRMED');
      process.stdout.write(JSON.stringify(await introspect(db, tables), null, 1) + '\n');
      return;
    }
    if (phase === 'inventory') {
      const v = await confirmTarget({ db });
      if (!v.confirmed) throw new Error('RCT1_TARGET_NOT_CONFIRMED');
      process.stdout.write(JSON.stringify(await inventory(db), null, 1) + '\n');
      return;
    }
    if (!PHASES.includes(phase)) throw new Error('RCT1_PHASE_UNKNOWN');
    const { steps } = require('./manifest');
    const only = process.env.RCT1_ONLY ? process.env.RCT1_ONLY.split(',') : null;
    const report = await run({ db, phase, steps, confirm: confirmTarget, only });
    process.stdout.write(JSON.stringify(report, null, 1) + '\n');
    if (!report.ok) process.exitCode = 2;
  } finally { if (db.pool && db.pool.end) await db.pool.end(); }
}
if (require.main === module) main().catch(e => { process.stderr.write('RCT1 REFUS: ' + e.message + '\n'); process.exitCode = 1; });
module.exports = { introspect, inventory, INVENTORY };
