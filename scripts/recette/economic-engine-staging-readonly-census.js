/**
 * @komerce-arch-lite
 * @role staging-economic-engine-readonly-census
 * @domain economic-engine
 * @layer tooling
 * @owner backend-core
 * @purpose Contre-expertise N1/N2/N3 (#3830) : relever la configuration économique
 *          effective du staging, les frais réels enregistrés et le calcul du moteur
 *          sur quelques produits réels, sans aucune écriture.
 * @db-read finance_config, cost_components, risk_provisions, charges, markets, products,
 *          orders, order_items, parcels, customs_shipments, customs_shipment_fees,
 *          customs_shipment_parcels, order_item_real_cost_allocations,
 *          order_item_cost_imputations, market_cost_attributions,
 *          economic_structure_cost_events, local_stock_allocations
 * @db-write none
 */
'use strict';
// Lecture seule garantie à trois niveaux :
//  1. PGOPTIONS='-c default_transaction_read_only=on' (workflow) : toute session, y compris
//     le pool db.js utilisé par le moteur, refuse les écritures ;
//  2. client d'audit ouvert avec la même option + BEGIN READ ONLY ;
//  3. garde statique du workflow (aucune instruction SQL mutable dans ce fichier).
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { confirmTarget } = require('./target-guard');

const ORIGIN = 'https://komerce-backend-production.up.railway.app';
const OUTPUT = path.resolve('test-results/staging-economic-readonly/census.json');

function requiredEnvironment(env = process.env) {
  if (env.KOMERCE_ENV !== 'staging' || env.NODE_ENV === 'production'
    || env.STAGING_BASE_URL !== ORIGIN || !env.DATABASE_URL
    || !/default_transaction_read_only=on/.test(env.PGOPTIONS || '')) {
    throw Error('STAGING_READONLY_CONFIGURATION_REQUIRED');
  }
}

const report = {
  kind: 'REAL_STAGING_READ_ONLY_ECONOMIC_CENSUS', issue: 3830, schema_version: 1,
  generated_at: new Date().toISOString(), live_commit: null, database_target_confirmed: false,
  executed_with: 'default_transaction_read_only=on + BEGIN READ ONLY', no_business_writes: true,
  sections: {}, errors: {},
};

async function section(client, name, sql, params = []) {
  try {
    await client.query(`SAVEPOINT s_${name}`);
    const r = await client.query(sql, params);
    await client.query(`RELEASE SAVEPOINT s_${name}`);
    report.sections[name] = r.rows;
    return r.rows;
  } catch (err) {
    await client.query(`ROLLBACK TO SAVEPOINT s_${name}`).catch(() => {});
    report.errors[name] = String(err.message).slice(0, 300);
    return [];
  }
}

function pickEngine(res) {
  if (!res) return null;
  const keep = {};
  for (const k of Object.keys(res)) {
    if (/kmf|pct|price|cost|status|warnings|breakdown|allocation|decision|confidence|reason|provenance|customs|structure|details|_meta|market/i.test(k)) keep[k] = res[k];
  }
  return keep;
}

async function main() {
  requiredEnvironment();
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('sslmode=require')
      ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' } : false,
    options: '-c default_transaction_read_only=on',
    connectionTimeoutMillis: 7000, query_timeout: 20000,
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
    try {
      const v = await fetch(ORIGIN + '/health/version', { signal: AbortSignal.timeout(8000) });
      const j = await v.json();
      report.live_commit = String(j.commit || j.sha || '').slice(0, 40) || null;
    } catch (_) { report.live_commit = null; }

    await client.query('BEGIN READ ONLY'); tx = true;
    await client.query("SET LOCAL statement_timeout='15000ms'");
    const ro = await client.query('SHOW transaction_read_only');
    report.transaction_read_only = ro.rows[0].transaction_read_only;
    if (report.transaction_read_only !== 'on') throw Error('READ_ONLY_NOT_ENFORCED');

    // ── A. Configuration effective ──
    await section(client, 'finance_config', 'SELECT * FROM finance_config');
    await section(client, 'cost_components', 'SELECT * FROM cost_components ORDER BY is_active DESC, category, key');
    await section(client, 'risk_provisions', 'SELECT * FROM risk_provisions ORDER BY is_active DESC');
    await section(client, 'charges', 'SELECT id, family, name, amount_kmf, is_recurring, recurrence_period, is_active, notes FROM charges ORDER BY is_active DESC, amount_kmf DESC');
    await section(client, 'markets', 'SELECT id, code, name, currency, is_active FROM markets ORDER BY code');
    await section(client, 'applied_migrations_tail', `SELECT * FROM schema_migrations ORDER BY 1 DESC LIMIT 15`);

    // ── B. Réalité des volumes ──
    await section(client, 'orders_by_market', `
      SELECT m.code AS market, (o.simulation_scope IS NOT NULL) AS simulation,
             COUNT(DISTINCT o.id)::int AS orders,
             COUNT(oi.id)::int AS lines, COALESCE(SUM(oi.quantity),0)::int AS units,
             ROUND(COALESCE(SUM(oi.quantity),0)::numeric / NULLIF(COUNT(DISTINCT o.id),0), 2) AS units_per_order,
             ROUND(COUNT(oi.id)::numeric / NULLIF(COUNT(DISTINCT o.id),0), 2) AS lines_per_order
        FROM orders o LEFT JOIN markets m ON m.id = o.market_id
        LEFT JOIN order_items oi ON oi.order_id = o.id
       WHERE o.payment_status = 'paid' AND o.status NOT IN ('cancelled','refunded')
       GROUP BY 1, 2 ORDER BY 1, 2`);
    await section(client, 'parcels_profile', `
      SELECT p.status::text AS status, COUNT(*)::int AS parcels,
             COUNT(*) FILTER (WHERE p.shipment_id IS NOT NULL)::int AS in_shipment,
             ROUND(AVG(p.weight_kg)::numeric, 3) AS avg_weight_kg
        FROM parcels p GROUP BY 1 ORDER BY 2 DESC`);
    await section(client, 'shipments', `
      SELECT cs.reference, cs.shipment_date, cs.transport_mode, cs.is_active, cs.nb_parcels,
             cs.total_weight_kg, cs.cif_value_kmf, cs.freight_kmf, cs.customs_paid_kmf, cs.allocation_method,
             (SELECT COUNT(*) FROM customs_shipment_parcels x WHERE x.shipment_id = cs.id)::int AS linked_parcels,
             (SELECT COALESCE(SUM(f.amount_kmf),0) FROM customs_shipment_fees f WHERE f.shipment_id = cs.id) AS fees_kmf
        FROM customs_shipments cs ORDER BY cs.created_at DESC LIMIT 30`);
    await section(client, 'shipment_fees_by_type', `
      SELECT fee_type, kind, currency, COUNT(*)::int AS n, SUM(amount_kmf) AS total_kmf,
             COUNT(*) FILTER (WHERE proof_ref IS NOT NULL AND proof_ref <> '')::int AS with_proof
        FROM customs_shipment_fees GROUP BY 1, 2, 3 ORDER BY 5 DESC NULLS LAST`);
    await section(client, 'real_allocations', `
      SELECT cost_type, source, allocation_method, is_actual, confidence, COUNT(*)::int AS n,
             SUM(amount_kmf) AS total_kmf
        FROM order_item_real_cost_allocations GROUP BY 1, 2, 3, 4, 5 ORDER BY 7 DESC NULLS LAST`);
    await section(client, 'estimated_imputations', `
      SELECT COUNT(*)::int AS n, COUNT(DISTINCT order_id)::int AS orders FROM order_item_cost_imputations`);
    await section(client, 'market_cost_attributions', `
      SELECT m.code AS market, a.event_kind, a.allocation_key, COUNT(*)::int AS n, SUM(a.amount_kmf) AS total_kmf
        FROM market_cost_attributions a LEFT JOIN markets m ON m.id = a.market_id
       GROUP BY 1, 2, 3 ORDER BY 1, 5 DESC`);
    await section(client, 'structure_events', `SELECT * FROM economic_structure_cost_events ORDER BY 1 DESC LIMIT 30`);
    await section(client, 'catalogue_coverage', `
      SELECT COUNT(*)::int AS active,
             COUNT(*) FILTER (WHERE cost_kmf IS NULL OR cost_kmf <= 0)::int AS without_cost,
             COUNT(*) FILTER (WHERE weight_kg IS NULL OR weight_kg <= 0)::int AS without_weight,
             COUNT(*) FILTER (WHERE volume_cm3 IS NULL OR volume_cm3 <= 0)::int AS without_volume,
             COUNT(*) FILTER (WHERE category IS NULL)::int AS without_category,
             PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY cost_kmf) AS median_cost_kmf
        FROM products WHERE is_active`);
    await section(client, 'local_stock', `SELECT COUNT(*)::int AS allocations FROM local_stock_allocations`);

    // ── C. Produits témoins ──
    const pick = async (name, order) => (await section(client, name, `
      SELECT id, product_ref, name, category, cost_kmf, price_kmf, weight_kg, volume_cm3
        FROM products WHERE is_active AND cost_kmf > 0 AND volume_cm3 > 0
       ORDER BY ${order} LIMIT 1`))[0];
    const small = await pick('sample_small', 'volume_cm3 ASC, cost_kmf ASC');
    const bulky = await pick('sample_bulky', 'volume_cm3 DESC');
    const median = await pick('sample_median_cost', `ABS(cost_kmf - (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY cost_kmf) FROM products WHERE is_active AND cost_kmf > 0))`);
    await client.query('ROLLBACK'); tx = false;

    // ── C bis. Moteur réel (pool db.js, session read-only via PGOPTIONS) ──
    const engine = require('../../services/pricing-engine');
    const cdr = require('../../services/pricing-cdr');
    const markets = (report.sections.markets || []).filter(m => m.is_active).slice(0, 3);
    report.engine_runs = [];
    for (const p of [small, bulky, median].filter(Boolean)) {
      for (const m of [{ id: null, code: 'GLOBAL' }, ...markets]) {
        const run = { product_ref: p.product_ref, market: m.code };
        try {
          const config = await cdr.loadGlobalConfig(m.id ? { marketId: m.id } : {});
          const res = await engine.recommend({ product_id: p.id }, { config: { ...config, market_id: m.id || null } });
          run.result = pickEngine(res);
          // Contrôle « somme du détail = total utilisé par le plancher »
          const raw = cdr.computeCDR({ ...p, cost_kmf: Number(p.cost_kmf) }, {
            config, volume_m3: Number(p.volume_cm3) / 1e6, channel: 'cash_relais',
          });
          const d = raw.details || {};
          const shown = ['product_cost','sourcing','hub','packaging','freight','customs','port_transitaire','distribution','payment','risks']
            .reduce((s, k) => s + Number(d[k] || 0), 0);
          run.cdr_check = {
            variable_used_for_floor: raw.variable_cost_estimated_kmf,
            sum_of_displayed_lines: Math.round(shown),
            hidden_gap_kmf: Math.round(raw.variable_cost_estimated_kmf - shown),
            fixed_per_article_kmf: raw.fixed_cost_allocation_kmf,
            customs_estimate_status: raw.customs_estimate_status,
            allocations: (d._allocations || []).map(a => ({
              key: a.component_key, category: a.category, unit: a.unit, level: a.allocation_level,
              engaged: a.engaged_cost_kmf, divisor: a.allocation_divisor, allocated: a.allocated_cost_kmf,
            })),
            warnings: raw.warnings,
          };
        } catch (err) { run.error = String(err.message).slice(0, 300); }
        report.engine_runs.push(run);
      }
    }
    report.status = 'COMPLETED';
  } catch (err) {
    report.status = 'FAILED';
    report.fatal = String(err.message).slice(0, 300);
    if (tx) await client.query('ROLLBACK').catch(() => {});
  } finally {
    await client.end().catch(() => {});
    fs.writeFileSync(OUTPUT, JSON.stringify(report, null, 2) + '\n');
    try { await require('../../db').pool?.end?.(); } catch (_) { /* noop */ }
  }
  process.exit(report.status === 'COMPLETED' ? 0 : 1);
}

main();
