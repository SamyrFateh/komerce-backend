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
const referenceResolver = require('../services/canonical-reference-resolver');

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

function representativeReferences(controlChain, customsReference = null) {
  const orders = Array.isArray(controlChain && controlChain.orders) ? controlChain.orders : [];
  const first = selector => {
    for (const order of orders) {
      const values = selector(order);
      if (Array.isArray(values) && values.length) return values[0];
    }
    return null;
  };
  return Object.freeze([
    { kind: 'ORDER', reference: orders[0]?.order_reference || null, owner: 'orders' },
    { kind: 'PURCHASE_ORDER', reference: first(order => order.lineage?.purchase_orders), owner: 'purchasing' },
    { kind: 'HUB_UNIT', reference: first(order => order.lineage?.hub_units), owner: 'logistics' },
    { kind: 'PARCEL', reference: first(order => order.lineage?.parcels), owner: 'logistics' },
    { kind: 'CUSTOMS_SHIPMENT', reference: customsReference, owner: 'customs' },
  ].filter(item => item.reference));
}

async function latestAuditCustomsReference(marketId) {
  const { rows } = await db.query(
    `SELECT cs.reference
       FROM customs_shipments cs
       JOIN customs_shipment_parcels csp ON csp.shipment_id = cs.id
       JOIN parcels p ON p.id = csp.parcel_id
       JOIN orders o ON o.id = p.order_id
      WHERE cs.is_active = TRUE
        AND o.market_id = $1
        AND o.reference LIKE 'AUDIT-%'
      ORDER BY cs.created_at DESC
      LIMIT 1`,
    [marketId]
  );
  return rows[0]?.reference || null;
}

async function auditReferenceResolution(controlChain, market) {
  const customsReference = await latestAuditCustomsReference(market.id);
  const candidates = representativeReferences(controlChain, customsReference);
  assert(candidates.some(item => item.kind === 'ORDER'), 'reference_audit_order_missing');

  const results = [];
  for (const candidate of candidates) {
    const globalResult = await referenceResolver.resolveReference(candidate.reference, {
      role: 'admin',
      global: true,
    });
    assert(globalResult.found === true, 'reference_not_found:' + candidate.kind);
    const globalMatch = globalResult.matches.find(match => match.entity_type === candidate.kind)
      || globalResult.matches[0];
    assert(globalMatch, 'reference_match_missing:' + candidate.kind);
    assert(globalMatch.canonical_owner === candidate.owner, 'reference_owner_mismatch:' + candidate.kind);
    assert(globalMatch.customer_order_reference, 'reference_parent_order_missing:' + candidate.kind);

    const marketResult = await referenceResolver.resolveReference(candidate.reference, {
      role: 'market_operator',
      authorizedMarketIds: new Set([market.id]),
    });
    assert(marketResult.found === true, 'reference_market_scope_missing:' + candidate.kind);

    results.push(Object.freeze({
      kind: candidate.kind,
      reference: candidate.reference,
      owner: globalMatch.canonical_owner,
      order: globalMatch.customer_order_reference,
      stage: globalMatch.current_position?.stage || null,
      health: globalMatch.current_position?.health || null,
      global_href: globalMatch.canonical_href,
      market_href: marketResult.matches[0]?.canonical_href || null,
      ambiguous: globalResult.ambiguous === true,
    }));
  }
  return Object.freeze(results);
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
  const referenceSearch = await auditReferenceResolution(o.control_chain, market);

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
    reference_search: referenceSearch,
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
  console.log('[dashboard-audit] reference_search ' + JSON.stringify(summary.reference_search));
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

module.exports = { parseArgs, metricMap, representativeReferences, latestAuditCustomsReference, auditReferenceResolution, resolveMarket, main };
