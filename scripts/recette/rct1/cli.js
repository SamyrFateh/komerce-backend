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

// Tables de reference rejouables localement (jamais de donnees personnes ni de secrets).
const DUMP_ALLOWLIST = Object.freeze(['business_rules', 'boutique_categories', 'boutique_subcategories', 'cost_components',
  'exchange_rates', 'markets', 'market_operating_assignments', 'assignment_capability_ceiling', 'capability_registry',
  'finance_config', 'currency_parities', 'loyalty_tiers', 'customs_categories', 'customs_rates', 'transport_rails', 'logistics_rails']);
async function dump(db, tables) {
  const out = {};
  for (const t of tables) {
    if (!DUMP_ALLOWLIST.includes(t)) { out[t] = { error: 'not_allowlisted' }; continue; }
    try { out[t] = await inTx(db, true, async (c) => (await c.query(`SELECT * FROM ${t} LIMIT 2000`)).rows); }
    catch (e) { out[t] = { error: String(e.message).slice(0, 100) }; }
  }
  return out;
}
async function tableCounts(db) {
  return inTx(db, true, async (c) => (await c.query(
    `SELECT relname AS t, n_live_tup::int AS n FROM pg_stat_user_tables WHERE n_live_tup > 0 ORDER BY relname`)).rows);
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
    if (phase === 'dump' || phase === 'tables') {
      const v = await confirmTarget({ db });
      if (!v.confirmed) throw new Error('RCT1_TARGET_NOT_CONFIRMED');
      const tables = String(process.env.RCT1_TABLES || '').split(',').filter(t => /^[a-z_0-9]+$/.test(t));
      process.stdout.write('RCT1JSON' + JSON.stringify(phase === 'dump' ? await dump(db, tables) : await tableCounts(db)) + '\n');
      return;
    }
    if (phase === 'pricing-probe') {
      // Lecture seule : position de prix du moteur pour les prix locaux RCT1 (aucune ecriture).
      const v = await confirmTarget({ db });
      if (!v.confirmed) throw new Error('RCT1_TARGET_NOT_CONFIRMED');
      const { LOCAL_PRICES } = require('./steps-pricing');
      const { PRODUCTS } = require('./data');
      const engine = require('../../../services/pricing-engine');
      const cdr = require('../../../services/pricing-cdr');
      const out = [];
      for (const lp of LOCAL_PRICES) {
        const pr = (await db.query('SELECT id FROM products WHERE product_ref=$1', [PRODUCTS[lp.product].ref])).rows[0];
        const m = (await db.query('SELECT id FROM markets WHERE code=$1', [lp.market])).rows[0];
        const config = await cdr.loadGlobalConfig({ marketId: m.id });
        const r = await engine.recommend({ product_id: pr.id, current_price_kmf: lp.amount, final_price_kmf: lp.amount, pricing_strategy: 'market_local' }, { config });
        out.push({ market: lp.market, product: lp.product, price: lp.amount, strategy_risk: r.strategy_risk, variable_cost_complete_kmf: r.variable_cost_complete_kmf, cdr_kmf: r.fully_loaded_cost_reference_kmf, margin_pct: r.estimated_margin_pct });
      }
      // Balayage P3 : plus petit prix hors zone « contributive_low_buffer » (donnee de decision, aucune ecriture).
      const p3 = (await db.query('SELECT id FROM products WHERE product_ref=$1', [PRODUCTS.P3.ref])).rows[0];
      const km = (await db.query("SELECT id FROM markets WHERE code='KM'")).rows[0];
      const cfg = await cdr.loadGlobalConfig({ marketId: km.id });
      const sweep = [];
      for (let price = 6000; price <= 14000; price += 500) {
        const r = await engine.recommend({ product_id: p3.id, current_price_kmf: price, final_price_kmf: price, pricing_strategy: 'market_local' }, { config: cfg });
        sweep.push([price, r.strategy_risk]);
        if (r.strategy_risk === 'contributive' || r.strategy_risk === 'covered') break;
      }
      out.push({ p3_sweep: sweep });
      process.stdout.write(JSON.stringify(out, null, 1) + '\n');
      return;
    }
    if (phase === 'finance-probe') {
      // Lecture seule : finance canonique avec et sans perimetre RCT1 (preuve d'isolation).
      const v = await confirmTarget({ db });
      if (!v.confirmed) throw new Error('RCT1_TARGET_NOT_CONFIRMED');
      const fin = require('../../../services/dashboard-finance-canonical');
      const view = (r) => ({
        trend: (r.trend || []).map(t => ({ paid_orders: t.paid_orders, revenue_kmf: t.revenue_kmf, consolidated_margin_kmf: t.consolidated_margin_kmf, actual_orders: t.actual_orders })),
        orders: (r.costing_orders || []).filter(o => String(o.reference).startsWith('RCT1-')).map(o => ({ ref: o.reference, status: o.status, sale: o.sale_total_kmf, real_cost: o.real_cost_kmf, margin: o.consolidated_margin_kmf, cost_status: o.cost_status, missing: o.missing_cost_types })),
        incomplete: (r.incomplete_cost_orders || []).filter(o => String(o.reference).startsWith('RCT1-')).map(o => o.reference),
      });
      const withScope = view(await fin.buildFinance({ simulation_scope: 'RCT1', period: '90' }, {}));
      const noScope = view(await fin.buildFinance({ period: '90' }, {}));
      process.stdout.write(JSON.stringify({ with_scope: withScope, without_scope: { ...noScope, rct1_orders_visible: noScope.orders.length } }, null, 1) + '\n');
      return;
    }
    if (phase === 'gate-probe') {
      // Lecture seule : conditions du garde marche KM (politique, couverture hypothetique) + preuve du flag snapshot deploye.
      const v = await confirmTarget({ db });
      if (!v.confirmed) throw new Error('RCT1_TARGET_NOT_CONFIRMED');
      const km = (await db.query("SELECT id FROM markets WHERE code='KM'")).rows[0];
      const policy = require('../../../services/pricing-market-decision-policy');
      const { computeMarketCoverage } = require('../../../services/pricing-market-coverage');
      const out = { policies: (await policy.listMarketDecisionPolicyHistory(km.id)).length, coverage: [] };
      const hyp = { version: 'probe', source: 'rct1-gate-probe', evidence_ref: 'probe-readonly', maturity_threshold: 0.8, coverage_threshold: 1.0, disposed_contribution_treatment: 'EXCLUDE_FROM_NUMERATOR', effective_from: '2026-01-01T00:00:00Z' };
      for (const [from, to] of [['2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z'], ['2026-07-21T00:00:00Z', '2026-10-19T23:59:59Z']]) {
        try {
          const c = await computeMarketCoverage({ marketId: km.id, from, to, coveragePolicy: hyp, dispositionPolicy: { version: 'probe', source: 'probe', max_ratio: 0.2 } });
          out.coverage.push({ from, status: c.coverage_status, reason: c.reason, authorization: c.authorization, maturity: c.maturity && { status: c.maturity.decision_status, ratio: c.maturity.maturity_ratio, mature_orders: c.maturity.mature_orders }, n3: c.structure && { decisional: c.structure.market_n3_decisional, total: c.structure.market_n3_total_kmf }, mature_contribution: c.contribution && c.contribution.contribution_before_risk_kmf, ratio: c.coverage_ratio });
        } catch (e) { out.coverage.push({ from, error: String(e.message).slice(0, 150) }); }
      }
      out.snapshot_flag_evidence = (await db.query(`SELECT (o.simulation_scope IS NOT NULL) AS rct1_scope, COUNT(*)::int AS orders, COUNT(*) FILTER (WHERE EXISTS(SELECT 1 FROM order_item_cost_imputations i WHERE i.order_id=o.id))::int AS with_imputation FROM orders o GROUP BY 1`)).rows;
      process.stdout.write(JSON.stringify(out, null, 1) + '\n');
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
module.exports = { introspect, inventory, INVENTORY, dump, DUMP_ALLOWLIST };
