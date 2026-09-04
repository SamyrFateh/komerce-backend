/**
 * @komerce-arch
 * @role          canonical-operations-dashboard-service
 * @domain        admin-dashboard
 * @layer         service
 * @criticality   high
 * @inputs        server_resolved_market
 * @outputs       canonical_operations_projection
 * @depends       db, dashboard-metrics, dashboard-metrics/_helpers
 * @used-by       routes/admin-dashboard-market.js
 * @db-read       orders, parcels, relais, signals, scan_events
 * @db-write      none
 * @db-txn        none
 * @doctrine      dashboard_no_business_recompute, server_market_scope_is_authority
 * @impact-areas  admin-dashboard, operations, logistics, market-authorization
 * @version       2026-08
 */

'use strict';

const db = require('../db');
const metrics = require('./dashboard-metrics');
const {
  buildFiltersClause,
  buildSignalMarketClause,
  ACTIVE_ORDER_STATUSES,
} = require('./dashboard-metrics/_helpers');

const OPS_SIGNAL_TYPES = Object.freeze([
  'parcel_blocked',
  'cash_expiring',
  'sla_breach',
  'hub_tension',
  'relay_tension',
  'loyalty_pending',
]);

function marketFilters(market) {
  return market && market.id ? { market_id: market.id } : {};
}

async function getActiveOrders(filters = {}) {
  const { where, params } = buildFiltersClause(filters);
  const { rows } = await db.query(`
    SELECT
      o.reference,
      o.status::text AS status,
      o.payment_status::text AS payment_status,
      o.total_kmf,
      o.destination_island,
      o.created_at,
      r.name AS relais_name,
      COUNT(DISTINCT p.id)::int AS parcels_count,
      FLOOR(EXTRACT(EPOCH FROM (
        NOW() - COALESCE(
          o.available_at,
          o.shipped_at,
          o.preparation_at,
          o.purchasing_at,
          o.created_at
        )
      )) / 3600)::int AS hours_since_last_event
    FROM orders o
    LEFT JOIN relais r ON r.id = o.relais_id
    LEFT JOIN parcels p ON p.order_id = o.id
    WHERE ${where}
      AND o.status::text = ANY($${params.length + 1}::text[])
    GROUP BY
      o.reference, o.status, o.payment_status, o.total_kmf,
      o.destination_island, o.created_at, r.name,
      o.available_at, o.shipped_at, o.preparation_at, o.purchasing_at
    ORDER BY hours_since_last_event DESC, o.created_at ASC
    LIMIT 30
  `, [...params, ACTIVE_ORDER_STATUSES]);

  return rows.map(row => ({
    reference: row.reference,
    status: row.status,
    payment_status: row.payment_status,
    total_kmf: Number(row.total_kmf) || 0,
    destination_island: row.destination_island || null,
    relais_name: row.relais_name || null,
    parcels_count: Number(row.parcels_count) || 0,
    hours_since_last_event: Number(row.hours_since_last_event) || 0,
    created_at: row.created_at,
  }));
}

async function getCriticalDelays(filters = {}) {
  const { where, params } = buildFiltersClause(filters, 'o');
  const { rows } = await db.query(`
    SELECT
      p.reference AS tracking_number,
      p.status::text AS status,
      p.shipped_at,
      o.reference AS order_reference,
      r.name AS relais_name,
      FLOOR(EXTRACT(EPOCH FROM (NOW() - p.shipped_at)) / 86400)::int AS days_in_transit
    FROM parcels p
    JOIN orders o ON o.id = p.order_id
    LEFT JOIN relais r ON r.id = o.relais_id
    WHERE ${where}
      AND p.shipped_at IS NOT NULL
      AND p.shipped_at < NOW() - INTERVAL '14 days'
      AND p.status NOT IN ('available', 'collected', 'cancelled')
    ORDER BY p.shipped_at ASC
    LIMIT 20
  `, params);

  return rows.map(row => ({
    tracking_number: row.tracking_number || null,
    order_reference: row.order_reference,
    status: row.status,
    relais_name: row.relais_name || null,
    shipped_at: row.shipped_at,
    days_in_transit: Number(row.days_in_transit) || 0,
  }));
}

async function getOperationalSignals(filters = {}) {
  const params = [OPS_SIGNAL_TYPES];
  const marketClause = buildSignalMarketClause(filters, 's', 2);
  params.push(...marketClause.params);

  const { rows } = await db.query(`
    SELECT
      s.signal_type,
      s.severity,
      s.title,
      s.summary,
      s.recommendation,
      s.owner_role,
      s.entity_type,
      s.status,
      s.created_at
    FROM signals s
    WHERE s.status IN ('open', 'acknowledged', 'snoozed')
      AND s.signal_type = ANY($1::text[])
      AND ${marketClause.where}
    ORDER BY
      CASE s.severity
        WHEN 'urgent' THEN 1
        WHEN 'critical' THEN 2
        WHEN 'warning' THEN 3
        ELSE 4
      END,
      s.created_at ASC
    LIMIT 12
  `, params);

  return rows.map(row => ({
    signal_type: row.signal_type,
    severity: row.severity,
    title: row.title,
    summary: row.summary || null,
    recommendation: row.recommendation || null,
    owner_role: row.owner_role || null,
    entity_type: row.entity_type || null,
    status: row.status,
    created_at: row.created_at,
  }));
}

function publicScope(market) {
  if (!market) return Object.freeze({ mode: 'global', market: null });
  return Object.freeze({
    mode: 'market',
    market: Object.freeze({
      code: market.code,
      name: market.name,
      currency: market.currency,
    }),
  });
}

async function buildOperations(options = {}) {
  const market = options.market || null;
  const filters = marketFilters(market);

  const [
    cmdsAujourdhui,
    paiementsAttente,
    colisPreparation,
    colisTransit,
    disponiblesRelais,
    retardsCritiques,
    tauxScans,
    tauxCollecte,
    activeOrders,
    criticalDelays,
    signals,
  ] = await Promise.all([
    metrics.getCmdsAujourdhui(filters),
    metrics.getPaiementsEnAttente(filters),
    metrics.getColisPreparation(filters),
    metrics.getColisEnTransit(filters),
    metrics.getDisponiblesRelais(filters),
    metrics.getRetardsCritiques(filters),
    metrics.getTauxCompletudeScans(filters),
    metrics.getTauxCollecteRelais(filters),
    getActiveOrders(filters),
    getCriticalDelays(filters),
    getOperationalSignals(filters),
  ]);

  return Object.freeze({
    scope: publicScope(market),
    kpis: Object.freeze([
      cmdsAujourdhui,
      paiementsAttente,
      colisPreparation,
      colisTransit,
      disponiblesRelais,
      retardsCritiques,
      tauxScans,
      tauxCollecte,
    ]),
    active_orders: Object.freeze(activeOrders),
    critical_delays: Object.freeze(criticalDelays),
    signals: Object.freeze(signals),
    data_quality: Object.freeze({
      generated_at: new Date(options.now || Date.now()).toISOString(),
      scope_mode: market ? 'market' : 'global',
      source_tables: Object.freeze(['orders', 'parcels', 'relais', 'signals', 'scan_events']),
    }),
  });
}

module.exports = {
  OPS_SIGNAL_TYPES,
  marketFilters,
  getActiveOrders,
  getCriticalDelays,
  getOperationalSignals,
  buildOperations,
};
