#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role          staging-dashboard-audit-runner
 * @domain        admin-dashboard
 * @layer         script
 * @owner         backend-core
 * @purpose       Auditer les projections canoniques sur les données staging réelles.
 * @impact-areas  staging-only, dashboards, market, finance, logistics
 */
'use strict';

const db = require('../db');
const { resolveRuntimeEnvironment } = require('../middleware/require-non-production');
const pilotage = require('../services/dashboard-pilotage-market');
const commerce = require('../services/dashboard-commerce');
const operations = require('../services/dashboard-operations');
const finance = require('../services/dashboard-finance-canonical');

function parseArgs(argv = process.argv) {
  const out = { market: 'KM', period: '30' };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--market') out.market = String(argv[++i] || '').trim().toUpperCase();
    else if (argv[i] === '--period') out.period = String(argv[++i] || '30');
  }
  return out;
}

function metricMap(items) {
  return Object.fromEntries((Array.isArray(items) ? items : [])
    .filter(Boolean)
    .map(item => [item.key, item.value]));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function resolveMarket(code) {
  const { rows } = await db.query(
    'SELECT id, code, name, currency FROM markets WHERE code = $1 AND is_active = TRUE LIMIT 1',
    [code]
  );
  if (!rows.length) throw new Error('audit_market_not_found:' + code);
  return rows[0];
}

async function main(argv = process.argv) {
  const { env, source } = resolveRuntimeEnvironment();
  if (env !== 'staging') {
    throw new Error(`audit_refused_non_staging:${env || 'unknown'}:${source}`);
  }

  const args = parseArgs(argv);
  const market = await resolveMarket(args.market);
  const now = new Date();
  const filters = { market_id: market.id };

  const [p, c, o, f] = await Promise.all([
    pilotage.buildMarketPilotage(filters, market),
    commerce.buildCommerce({ period: args.period }, { market, now }),
    operations.buildOperations({ market, now }),
    finance.buildFinance({ period: args.period }, { market, now }),
  ]);

  assert(p.scope?.market?.code === market.code, 'pilotage_scope_mismatch');
  assert(c.scope?.market?.code === market.code, 'commerce_scope_mismatch');
  assert(o.scope?.market?.code === market.code, 'operations_scope_mismatch');
  assert(f.scope?.market?.code === market.code, 'finance_scope_mismatch');
  assert(Array.isArray(o.control_chain?.stages) && o.control_chain.stages.length >= 5, 'control_chain_missing');
  assert(Array.isArray(c.kpis) && c.kpis.length >= 4, 'commerce_kpis_missing');
  assert(Array.isArray(f.kpis) && f.kpis.length >= 4, 'finance_kpis_missing');

  const summary = {
    environment: { env, source },
    market: { code: market.code, name: market.name, currency: market.currency },
    pilotage: {
      kpis: metricMap(p.kpis_global),
      alerts: Array.isArray(p.system_alerts) ? p.system_alerts.length : 0,
      views: (p.view_blocks || []).map(v => v.view),
    },
    commerce: {
      period: c.period,
      kpis: metricMap(c.kpis),
      top_products: c.top_products?.length || 0,
      decision_signals: c.decision_signals?.map(s => ({ key: s.key, severity: s.severity })) || [],
      funnel: c.funnel || null,
    },
    operations: {
      kpis: metricMap(o.kpis),
      active_orders: o.active_orders?.length || 0,
      critical_delays: o.critical_delays?.length || 0,
      signals: o.signals?.map(s => ({ type: s.signal_type, severity: s.severity })) || [],
      control_chain: {
        order_count: o.control_chain?.orders?.length || 0,
        structural_alerts: o.control_chain?.structural_alerts || [],
        stage_counts: Object.fromEntries((o.control_chain?.stages || []).map(stage => [
          stage.key,
          Array.isArray(o.control_chain?.by_stage?.[stage.key]) ? o.control_chain.by_stage[stage.key].length : 0,
        ])),
      },
    },
    finance: {
      period: f.period,
      kpis: metricMap(f.kpis),
      incomplete_cost_orders: f.incomplete_cost_orders?.length || 0,
      refunds: f.refunds?.count || 0,
      supplier_payment_review: f.supplier_payment_review || null,
    },
  };

  console.log('[dashboard-audit] env=' + summary.environment.env + ' market=' + summary.market.code + ' period=' + summary.commerce.period);
  console.log('[dashboard-audit] pilotage ' + JSON.stringify(summary.pilotage));
  console.log('[dashboard-audit] commerce ' + JSON.stringify(summary.commerce));
  console.log('[dashboard-audit] operations ' + JSON.stringify({
    kpis: summary.operations.kpis,
    active_orders: summary.operations.active_orders,
    critical_delays: summary.operations.critical_delays,
    signals: summary.operations.signals,
  }));
  console.log('[dashboard-audit] chain ' + JSON.stringify(summary.operations.control_chain));
  console.log('[dashboard-audit] finance ' + JSON.stringify(summary.finance));
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('[dashboard-audit] FAILED ' + error.message);
      process.exit(1);
    });
}

module.exports = { parseArgs, metricMap, resolveMarket, main };
