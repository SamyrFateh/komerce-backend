/**
 * KOMERCE — SLA Monitoring Service
 *
 * Tracks delivery SLA compliance per parcel.
 * Calculates: on-time rate, avg transit time, breach alerts.
 *
 * SLA thresholds (from business_rules):
 *   - SLA_STANDARD_DAYS: 35 (default for maritime)
 *   - SLA_EXPRESS_DAYS: 21 (default for air)
 *   - SLA_BACKORDER_DAYS: 45
 *
 * Usage:
 *   const sla = require('../services/sla-service');
 *   const report = await sla.getSLAReport({ period: '30d' });
 *   const breaches = await sla.getActiveBreaches();
 */

'use strict';

const db = require('../db');
const { getRuleNumber } = require('../utils/rules');
const log = require('../utils/logger').child({ module: 'sla' });

// ── SLA Report ──────────────────────────────────────────────────────────────

async function getSLAReport(options = {}) {
  const period = options.period || '30d';
  const days = parseInt(period) || 30;

  const slaStandard = await getRuleNumber('SLA_STANDARD_DAYS', 35);
  const slaExpress = await getRuleNumber('SLA_EXPRESS_DAYS', 21);

  const { rows } = await db.query(`
    WITH parcel_sla AS (
      SELECT
        p.id,
        p.reference,
        p.type,
        p.status,
        p.created_at,
        p.collected_at,
        p.carrier_id,
        c.name AS carrier_name,
        c.type AS transport_type,
        -- Transit time in days
        CASE
          WHEN p.collected_at IS NOT NULL THEN
            EXTRACT(EPOCH FROM (p.collected_at - p.created_at)) / 86400
          WHEN p.status NOT IN ('collected', 'cancelled') THEN
            EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 86400
          ELSE NULL
        END AS transit_days,
        -- SLA target based on transport type
        CASE
          WHEN c.type = 'air' THEN $1
          ELSE $2
        END AS sla_target_days
      FROM parcels p
      LEFT JOIN carriers c ON c.id = p.carrier_id
      WHERE p.created_at > NOW() - INTERVAL '1 day' * $3
        AND p.status != 'cancelled'
    )
    SELECT
      COUNT(*) AS total_parcels,
      COUNT(*) FILTER (WHERE status = 'collected') AS delivered,
      COUNT(*) FILTER (WHERE status NOT IN ('collected', 'cancelled')) AS in_progress,

      -- SLA compliance (delivered parcels only)
      COUNT(*) FILTER (
        WHERE status = 'collected' AND transit_days <= sla_target_days
      ) AS on_time,
      COUNT(*) FILTER (
        WHERE status = 'collected' AND transit_days > sla_target_days
      ) AS late,

      -- Active breaches (in-progress parcels exceeding SLA)
      COUNT(*) FILTER (
        WHERE status NOT IN ('collected', 'cancelled')
        AND transit_days > sla_target_days
      ) AS active_breaches,

      -- Averages
      ROUND(AVG(transit_days) FILTER (WHERE status = 'collected'), 1) AS avg_transit_days,
      ROUND(MIN(transit_days) FILTER (WHERE status = 'collected'), 1) AS min_transit_days,
      ROUND(MAX(transit_days) FILTER (WHERE status = 'collected'), 1) AS max_transit_days,

      -- By transport type
      COUNT(*) FILTER (WHERE transport_type = 'maritime') AS maritime_count,
      COUNT(*) FILTER (WHERE transport_type = 'air') AS air_count,
      ROUND(AVG(transit_days) FILTER (
        WHERE status = 'collected' AND transport_type = 'maritime'
      ), 1) AS avg_maritime_days,
      ROUND(AVG(transit_days) FILTER (
        WHERE status = 'collected' AND transport_type = 'air'
      ), 1) AS avg_air_days

    FROM parcel_sla
  `, [slaExpress, slaStandard, days]);

  const stats = rows[0];
  const delivered = parseInt(stats.delivered) || 0;
  const onTime = parseInt(stats.on_time) || 0;

  return {
    period: `${days}d`,
    sla_targets: { standard_days: slaStandard, express_days: slaExpress },
    summary: {
      total_parcels: parseInt(stats.total_parcels),
      delivered,
      in_progress: parseInt(stats.in_progress),
      on_time: onTime,
      late: parseInt(stats.late),
      active_breaches: parseInt(stats.active_breaches),
      on_time_rate: delivered > 0 ? Math.round((onTime / delivered) * 100) : null,
    },
    transit: {
      avg_days: parseFloat(stats.avg_transit_days) || null,
      min_days: parseFloat(stats.min_transit_days) || null,
      max_days: parseFloat(stats.max_transit_days) || null,
    },
    by_transport: {
      maritime: { count: parseInt(stats.maritime_count), avg_days: parseFloat(stats.avg_maritime_days) || null },
      air: { count: parseInt(stats.air_count), avg_days: parseFloat(stats.avg_air_days) || null },
    },
  };
}

// ── Active Breaches List ────────────────────────────────────────────────────

async function getActiveBreaches() {
  const slaStandard = await getRuleNumber('SLA_STANDARD_DAYS', 35);
  const slaExpress = await getRuleNumber('SLA_EXPRESS_DAYS', 21);

  const { rows } = await db.query(`
    SELECT
      p.id,
      p.reference,
      p.type,
      p.status,
      p.created_at,
      o.reference AS order_reference,
      c.name AS carrier_name,
      c.type AS transport_type,
      ROUND(EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 86400, 1) AS days_elapsed,
      CASE WHEN c.type = 'air' THEN $1 ELSE $2 END AS sla_target,
      ROUND(EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 86400 -
        CASE WHEN c.type = 'air' THEN $1 ELSE $2 END, 1) AS days_overdue
    FROM parcels p
    JOIN orders o ON o.id = p.order_id
    LEFT JOIN carriers c ON c.id = p.carrier_id
    WHERE p.status NOT IN ('collected', 'cancelled')
      AND EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 86400 >
        CASE WHEN c.type = 'air' THEN $1 ELSE $2 END
    ORDER BY days_overdue DESC
  `, [slaExpress, slaStandard]);

  return rows;
}

// ── Cost Report ─────────────────────────────────────────────────────────────

async function getCostReport(options = {}) {
  const days = parseInt(options.period) || 30;

  const { rows } = await db.query(`
    SELECT
      c.id AS carrier_id,
      c.name AS carrier_name,
      c.type AS transport_type,
      c.cost_per_kg_kmf,
      COUNT(p.id) AS parcel_count,
      ROUND(SUM(p.customs_weight_kg), 2) AS total_weight_kg,
      ROUND(SUM(p.customs_value_kmf), 2) AS total_customs_value_kmf,
      ROUND(SUM(
        COALESCE(p.customs_weight_kg, 0) * COALESCE(c.cost_per_kg_kmf, 0)
      ), 2) AS estimated_shipping_cost_kmf,
      ROUND(AVG(
        EXTRACT(EPOCH FROM (
          COALESCE(p.collected_at, NOW()) - p.created_at
        )) / 86400
      ), 1) AS avg_transit_days
    FROM parcels p
    JOIN carriers c ON c.id = p.carrier_id
    WHERE p.created_at > NOW() - INTERVAL '1 day' * $1
      AND p.status != 'cancelled'
    GROUP BY c.id, c.name, c.type, c.cost_per_kg_kmf
    ORDER BY parcel_count DESC
  `, [days]);

  // Global totals
  const totals = rows.reduce((acc, r) => ({
    total_parcels: acc.total_parcels + parseInt(r.parcel_count),
    total_weight_kg: acc.total_weight_kg + (parseFloat(r.total_weight_kg) || 0),
    total_customs_value: acc.total_customs_value + (parseFloat(r.total_customs_value_kmf) || 0),
    total_shipping_cost: acc.total_shipping_cost + (parseFloat(r.estimated_shipping_cost_kmf) || 0),
  }), { total_parcels: 0, total_weight_kg: 0, total_customs_value: 0, total_shipping_cost: 0 });

  return {
    period: `${days}d`,
    by_carrier: rows.map(r => ({
      ...r,
      parcel_count: parseInt(r.parcel_count),
      total_weight_kg: parseFloat(r.total_weight_kg) || 0,
      total_customs_value_kmf: parseFloat(r.total_customs_value_kmf) || 0,
      estimated_shipping_cost_kmf: parseFloat(r.estimated_shipping_cost_kmf) || 0,
      avg_transit_days: parseFloat(r.avg_transit_days) || null,
    })),
    totals,
  };
}

module.exports = {
  getSLAReport,
  getActiveBreaches,
  getCostReport,
};
