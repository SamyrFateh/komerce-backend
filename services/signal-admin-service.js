/**
 * @komerce-arch
 * @role          decision-signal-admin-service
 * @domain        decision-signals
 * @layer         service
 * @criticality   high
 * @inputs        signal_filters, signal_internal_id_or_ref, authenticated_actor
 * @outputs       signal_projection_rows, lifecycle_transition_results
 * @depends       db.js
 * @used-by       routes/signals.js, services/action-center-workspace.js, services/signal-service.js
 * @db-read       signals
 * @db-write      signals
 * @db-txn        none
 * @doctrine      signal_is_derived_fact, active_signal_states_are_open_acknowledged_snoozed, browser_uses_signal_ref_only
 * @impact-areas  decision-signals, admin-dashboard
 * @version       2026-08
 */

'use strict';

const db = require('../db');

const FAMILY_TYPES = Object.freeze({
  ops: Object.freeze(['parcel_blocked', 'cash_expiring', 'sla_breach', 'hub_tension', 'relay_tension', 'loyalty_pending']),
  eco: Object.freeze(['margin_drift', 'pricing_outlier', 'category_drift', 'recon_anomaly']),
  sourcing: Object.freeze(['sourcing_arbitrage', 'product_dead', 'product_star', 'stock_rupture']),
  disputes: Object.freeze(['dispute_sensitive']),
});

const TYPE_FAMILY = Object.freeze(Object.entries(FAMILY_TYPES).reduce((map, [family, types]) => {
  types.forEach(type => { map[type] = family; });
  return map;
}, {}));

function familyForType(signalType) {
  return TYPE_FAMILY[signalType] || 'other';
}

function normalizeLimit(raw, fallback = 50, max = 200) {
  const value = parseInt(raw, 10);
  return Math.min(Number.isFinite(value) && value > 0 ? value : fallback, max);
}

function normalizeOffset(raw) {
  const value = parseInt(raw, 10);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

async function listSignals(filters = {}) {
  const where = [];
  const params = [];
  let idx = 1;

  if (filters.status) {
    where.push(`s.status = $${idx++}`);
    params.push(filters.status);
  } else {
    where.push("s.status IN ('open','acknowledged')");
  }

  if (filters.severity) {
    where.push(`s.severity = $${idx++}`);
    params.push(filters.severity);
  }
  if (filters.signal_type) {
    where.push(`s.signal_type = $${idx++}`);
    params.push(filters.signal_type);
  }
  if (filters.owner_role) {
    where.push(`s.owner_role = $${idx++}`);
    params.push(filters.owner_role);
  }
  if (filters.family && FAMILY_TYPES[filters.family]) {
    where.push(`s.signal_type = ANY($${idx++})`);
    params.push(FAMILY_TYPES[filters.family]);
  }

  const limit = normalizeLimit(filters.limit);
  const offset = normalizeOffset(filters.offset);
  const whereSql = where.join(' AND ');

  const { rows } = await db.query(
    `SELECT s.*
       FROM signals s
      WHERE ${whereSql}
      ORDER BY
        CASE s.severity
          WHEN 'urgent' THEN 1
          WHEN 'critical' THEN 2
          WHEN 'warning' THEN 3
          ELSE 4
        END,
        s.created_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params
  );

  const countResult = await db.query(`SELECT COUNT(*) FROM signals s WHERE ${whereSql}`, params);
  return {
    signals: rows,
    total: parseInt(countResult.rows[0]?.count || '0', 10),
    limit,
    offset,
  };
}

async function getStats() {
  const [severityResult, typeResult, familyResult] = await Promise.all([
    db.query(`
      SELECT severity, COUNT(*) AS count
        FROM signals
       WHERE status IN ('open','acknowledged')
       GROUP BY severity`),
    db.query(`
      SELECT signal_type, COUNT(*) AS count
        FROM signals
       WHERE status IN ('open','acknowledged')
       GROUP BY signal_type
       ORDER BY count DESC`),
    db.query(`
      SELECT
        CASE
          WHEN signal_type = ANY($1) THEN 'ops'
          WHEN signal_type = ANY($2) THEN 'eco'
          WHEN signal_type = ANY($3) THEN 'sourcing'
          WHEN signal_type = ANY($4) THEN 'disputes'
          ELSE 'other'
        END AS family,
        COUNT(*) AS count
        FROM signals
       WHERE status IN ('open','acknowledged')
       GROUP BY family
       ORDER BY count DESC`, [FAMILY_TYPES.ops, FAMILY_TYPES.eco, FAMILY_TYPES.sourcing, FAMILY_TYPES.disputes]),
  ]);

  const bySeverity = severityResult.rows;
  return {
    total: bySeverity.reduce((sum, row) => sum + parseInt(row.count || '0', 10), 0),
    bySeverity,
    byType: typeResult.rows,
    byFamily: familyResult.rows,
  };
}

function selectorColumn(selector) {
  if (selector === 'id') return 'id';
  if (selector === 'signal_ref') return 'signal_ref';
  throw new Error('Unsupported signal selector');
}

async function acknowledge(selector, value) {
  const column = selectorColumn(selector);
  const result = await db.query(
    `UPDATE signals
        SET status = 'acknowledged', updated_at = NOW()
      WHERE ${column} = $1 AND status = 'open'
      RETURNING id, signal_ref, status`,
    [value]
  );
  return result.rows[0] || null;
}

async function snooze(selector, value, rawHours) {
  const column = selectorColumn(selector);
  const parsed = parseInt(rawHours, 10);
  const hours = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 24 * 30) : 24;
  const result = await db.query(
    `UPDATE signals
        SET status = 'snoozed',
            snoozed_until = NOW() + ($2 || ' hours')::interval,
            updated_at = NOW()
      WHERE ${column} = $1 AND status IN ('open','acknowledged')
      RETURNING id, signal_ref, status, snoozed_until`,
    [value, hours.toString()]
  );
  return result.rows[0] || null;
}

async function resolve(selector, value, userId) {
  const column = selectorColumn(selector);
  const result = await db.query(
    `UPDATE signals
        SET status = 'resolved',
            resolved_at = NOW(),
            resolved_by = $2,
            snoozed_until = NULL,
            updated_at = NOW()
      WHERE ${column} = $1 AND status IN ('open','acknowledged','snoozed')
      RETURNING id, signal_ref, status, resolved_at`,
    [value, userId]
  );
  return result.rows[0] || null;
}

async function hardDeleteById(id) {
  const result = await db.query('DELETE FROM signals WHERE id = $1 RETURNING id', [id]);
  return result.rows[0] || null;
}

async function reactivateExpiredSnoozes() {
  const result = await db.query(`
    UPDATE signals
       SET status = 'open', snoozed_until = NULL, updated_at = NOW()
     WHERE status = 'snoozed'
       AND snoozed_until IS NOT NULL
       AND snoozed_until <= NOW()
  `);
  return result.rowCount || 0;
}

async function findActiveByEntity(signalType, entityType, entityId) {
  if (!signalType) return null;
  const { rows } = await db.query(
    `SELECT id, signal_ref, status, snoozed_until
       FROM signals
      WHERE signal_type = $1
        AND entity_type IS NOT DISTINCT FROM $2
        AND entity_id IS NOT DISTINCT FROM $3
        AND status IN ('open','acknowledged','snoozed')
      ORDER BY
        CASE status WHEN 'snoozed' THEN 1 WHEN 'acknowledged' THEN 2 ELSE 3 END,
        created_at DESC
      LIMIT 1`,
    [signalType, entityType || null, entityId || null]
  );
  return rows[0] || null;
}

module.exports = {
  FAMILY_TYPES,
  familyForType,
  listSignals,
  getStats,
  acknowledgeById: id => acknowledge('id', id),
  acknowledgeByRef: signalRef => acknowledge('signal_ref', signalRef),
  snoozeById: (id, hours) => snooze('id', id, hours),
  snoozeByRef: (signalRef, hours) => snooze('signal_ref', signalRef, hours),
  resolveById: (id, userId) => resolve('id', id, userId),
  resolveByRef: (signalRef, userId) => resolve('signal_ref', signalRef, userId),
  hardDeleteById,
  reactivateExpiredSnoozes,
  findActiveByEntity,
};
