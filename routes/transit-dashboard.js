/**
 * KOMERCE — Transit Dashboard v1.0 (Parcel-First)
 * =================================================
 * Vue transit orientée COLIS : l'unité logistique réelle.
 *
 * GET /api/transit/dashboard   — KPIs colis par statut + délais + alertes
 * GET /api/transit/parcels     — Liste colis actifs avec ETA et retard
 * GET /api/transit/delayed     — Colis en retard (SLA dépassé)
 * GET /api/transit/alerts      — Alertes actives (bloqués, anomalies, paiement)
 *
 * Auth : JWT cookie httpOnly + rôle admin ou agent_hub
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const transitAuth = [authenticate, requireRole(['admin', 'agent_hub'])];

// ── Auto-create alerts table ─────────────────────────────────────────────────
(async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS alerts (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        type        TEXT        NOT NULL,
        entity_type TEXT        NOT NULL DEFAULT 'parcel',
        entity_id   UUID,
        severity    TEXT        NOT NULL DEFAULT 'medium'
                                CHECK (severity IN ('low','medium','high')),
        title       TEXT        NOT NULL,
        description TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved_at TIMESTAMPTZ,
        resolved_by UUID REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_alerts_entity   ON alerts(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);
      CREATE INDEX IF NOT EXISTS idx_alerts_open     ON alerts(resolved_at) WHERE resolved_at IS NULL;
    `);

    // Add destination_island + relay_id to parcels if missing
    await db.query(`
      ALTER TABLE parcels ADD COLUMN IF NOT EXISTS destination_island TEXT;
      ALTER TABLE parcels ADD COLUMN IF NOT EXISTS relay_id UUID REFERENCES relais(id);
      ALTER TABLE parcels ADD COLUMN IF NOT EXISTS eta TIMESTAMPTZ;
      ALTER TABLE parcels ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ;
      ALTER TABLE parcels ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
    `);

    // Backfill destination_island + relay_id from parent order
    await db.query(`
      UPDATE parcels p
      SET
        destination_island = COALESCE(p.destination_island, o.destination_island),
        relay_id           = COALESCE(p.relay_id, o.relais_id)
      FROM orders o
      WHERE p.order_id = o.id
        AND (p.destination_island IS NULL OR p.relay_id IS NULL)
    `);

    console.log('[TRANSIT-DASH] Tables + migrations OK');
  } catch(e) { console.warn('[TRANSIT-DASH] Init (non-fatal):', e.message); }
})();

// ── SLA config (jours) ───────────────────────────────────────────────────────
const SLA = {
  preparation_warning: 3,   // colis en prépa depuis > 3j → attention
  shipped_warning:     7,   // expédié depuis > 7j → attention
  in_transit_warning: 28,   // en transit > 28j → attention
  in_transit_late:    42,   // en transit > 42j → retard
  available_warning:   5,   // au relais > 5j → à notifier
  available_late:     14,   // au relais > 14j → relance urgente
};

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/transit/dashboard — KPIs colis + alertes actives
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/dashboard', ...transitAuth, async (req, res, next) => {
  try {
    // ── KPIs colis par statut ────────────────────────────────────────────────
    const { rows: [kpi] } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'draft')         AS draft,
        COUNT(*) FILTER (WHERE status = 'preparation')   AS preparation,
        COUNT(*) FILTER (WHERE status = 'shipped')       AS shipped,
        COUNT(*) FILTER (WHERE status = 'in_transit')    AS in_transit,
        COUNT(*) FILTER (WHERE status = 'available')     AS at_relay,
        COUNT(*) FILTER (WHERE status = 'collected')     AS collected,
        COUNT(*) FILTER (WHERE status = 'cancelled')     AS cancelled,
        COUNT(*) FILTER (WHERE status NOT IN ('collected','cancelled','draft')) AS active,
        COUNT(*) FILTER (WHERE status = 'in_transit'
          AND updated_at < NOW() - INTERVAL '42 days')   AS transit_late,
        COUNT(*) FILTER (WHERE status = 'available'
          AND updated_at < NOW() - INTERVAL '14 days')   AS relay_late
      FROM parcels
    `);

    // ── KPIs aujourd'hui ─────────────────────────────────────────────────────
    const { rows: [today] } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'shipped'
          AND updated_at::date = CURRENT_DATE)            AS shipped_today,
        COUNT(*) FILTER (WHERE status = 'in_transit'
          AND updated_at::date = CURRENT_DATE)            AS arrived_comores_today,
        COUNT(*) FILTER (WHERE status = 'collected'
          AND updated_at::date = CURRENT_DATE)            AS collected_today
      FROM parcels
    `);

    // ── Répartition par île ──────────────────────────────────────────────────
    const { rows: byIsland } = await db.query(`
      SELECT
        COALESCE(destination_island, o.destination_island, 'Non défini') AS island,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE p.status NOT IN ('collected','cancelled')) AS active
      FROM parcels p
      LEFT JOIN orders o ON o.id = p.order_id
      WHERE p.status NOT IN ('collected','cancelled','draft')
      GROUP BY 1 ORDER BY total DESC
    `);

    // ── Alertes actives (débloquage requis) ──────────────────────────────────
    const { rows: alertRows } = await db.query(`
      SELECT COUNT(*) AS total,
        COUNT(*) FILTER (WHERE severity = 'high')   AS high,
        COUNT(*) FILTER (WHERE severity = 'medium') AS medium,
        COUNT(*) FILTER (WHERE severity = 'low')    AS low
      FROM alerts
      WHERE resolved_at IS NULL
        AND entity_type = 'parcel'
    `);
    const alertKpi = alertRows[0] || {};

    // ── Délais moyens ─────────────────────────────────────────────────────────
    const { rows: [delays] } = await db.query(`
      SELECT
        ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(shipped_at, NOW()) - created_at)) / 86400)
          FILTER (WHERE status != 'cancelled'))::int AS avg_prep_to_ship_days,
        ROUND(AVG(EXTRACT(EPOCH FROM (delivered_at - shipped_at)) / 86400)
          FILTER (WHERE status = 'collected' AND delivered_at IS NOT NULL AND shipped_at IS NOT NULL))::int AS avg_transit_days,
        ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - updated_at)) / 86400)
          FILTER (WHERE status = 'available'))::int AS avg_relay_wait_days
      FROM parcels
    `);

    res.json({
      kpi: {
        preparation:   Number(kpi.preparation),
        shipped:       Number(kpi.shipped),
        in_transit:    Number(kpi.in_transit),
        at_relay:      Number(kpi.at_relay),
        collected:     Number(kpi.collected),
        active:        Number(kpi.active),
        transit_late:  Number(kpi.transit_late),
        relay_late:    Number(kpi.relay_late),
      },
      today: {
        shipped:           Number(today.shipped_today),
        arrived_comores:   Number(today.arrived_comores_today),
        collected:         Number(today.collected_today),
      },
      by_island: byIsland.map(r => ({
        island: r.island,
        total:  Number(r.total),
        active: Number(r.active),
      })),
      delays: {
        avg_prep_to_ship_days: delays.avg_prep_to_ship_days,
        avg_transit_days:      delays.avg_transit_days,
        avg_relay_wait_days:   delays.avg_relay_wait_days,
      },
      alerts: {
        total:  Number(alertKpi.total  || 0),
        high:   Number(alertKpi.high   || 0),
        medium: Number(alertKpi.medium || 0),
        low:    Number(alertKpi.low    || 0),
      },
      sla: SLA,
    });
  } catch(e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/transit/parcels — Liste colis actifs avec ETA + retard + ordre
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/parcels', ...transitAuth, async (req, res, next) => {
  try {
    const { status, island, search, page = 1, limit = 100 } = req.query;
    const safeLimit = Math.min(parseInt(limit) || 100, 200);
    const safePage  = Math.max(parseInt(page) || 1, 1);
    const offset    = (safePage - 1) * safeLimit;

    const conditions = ["p.status NOT IN ('collected','cancelled','draft')"];
    const params = [];
    let idx = 1;

    if (status)  { conditions.push(`p.status = $${idx++}`); params.push(status); }
    if (island)  { conditions.push(`(p.destination_island ILIKE $${idx} OR o.destination_island ILIKE $${idx})`); params.push(`%${island}%`); idx++; }
    if (search)  { conditions.push(`(p.reference ILIKE $${idx} OR o.reference ILIKE $${idx})`); params.push(`%${search}%`); idx++; }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const { rows } = await db.query(`
      SELECT
        p.id, p.reference, p.status, p.type,
        p.created_at, p.updated_at, p.shipped_at, p.delivered_at, p.eta,
        COALESCE(p.destination_island, o.destination_island) AS destination_island,
        COALESCE(p.relay_id, o.relais_id)                    AS relay_id,
        r.name  AS relay_name,
        o.id    AS order_id,
        o.reference  AS order_reference,
        o.status     AS order_status,
        o.total_kmf  AS order_total_kmf,
        rc.full_name AS recipient_name,
        rc.phone     AS recipient_phone,
        (SELECT COUNT(*) FROM parcel_items pi WHERE pi.parcel_id = p.id)::int AS items_count,
        EXTRACT(EPOCH FROM (NOW() - p.updated_at)) / 86400 AS days_since_update,
        EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 86400 AS age_days,
        -- Retard détection
        CASE
          WHEN p.status = 'in_transit'
            AND EXTRACT(EPOCH FROM (NOW() - p.updated_at)) / 86400 > ${SLA.in_transit_late}
            THEN 'late'
          WHEN p.status = 'in_transit'
            AND EXTRACT(EPOCH FROM (NOW() - p.updated_at)) / 86400 > ${SLA.in_transit_warning}
            THEN 'warning'
          WHEN p.status = 'available'
            AND EXTRACT(EPOCH FROM (NOW() - p.updated_at)) / 86400 > ${SLA.available_late}
            THEN 'late'
          WHEN p.status = 'available'
            AND EXTRACT(EPOCH FROM (NOW() - p.updated_at)) / 86400 > ${SLA.available_warning}
            THEN 'warning'
          WHEN p.status = 'shipped'
            AND EXTRACT(EPOCH FROM (NOW() - p.updated_at)) / 86400 > ${SLA.shipped_warning}
            THEN 'warning'
          ELSE 'on_time'
        END AS delay_status,
        -- Alerte ouverte sur ce colis
        (SELECT a.severity FROM alerts a
         WHERE a.entity_id = p.id AND a.entity_type = 'parcel' AND a.resolved_at IS NULL
         ORDER BY CASE a.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END
         LIMIT 1) AS alert_severity
      FROM parcels p
      LEFT JOIN orders o ON o.id = p.order_id
      LEFT JOIN relais r ON r.id = COALESCE(p.relay_id, o.relais_id)
      LEFT JOIN recipients rc ON rc.id = o.recipient_id
      ${where}
      ORDER BY
        CASE p.status
          WHEN 'in_transit' THEN 0
          WHEN 'shipped'    THEN 1
          WHEN 'available'  THEN 2
          WHEN 'preparation' THEN 3
          ELSE 4
        END,
        p.updated_at ASC
      LIMIT $${idx++} OFFSET $${idx++}
    `, [...params, safeLimit, offset]);

    // Count total
    const countRes = await db.query(`
      SELECT COUNT(*)::int AS total
      FROM parcels p
      LEFT JOIN orders o ON o.id = p.order_id
      ${where}
    `, params);

    res.json({
      data: rows.map(p => ({
        ...p,
        days_since_update: Math.round(Number(p.days_since_update)),
        age_days:          Math.round(Number(p.age_days)),
      })),
      pagination: {
        page: safePage, limit: safeLimit,
        total: countRes.rows[0].total,
        pages: Math.ceil(countRes.rows[0].total / safeLimit),
      },
    });
  } catch(e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/transit/delayed — Colis en retard uniquement
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/delayed', ...transitAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT
        p.id, p.reference, p.status,
        p.created_at, p.updated_at,
        COALESCE(p.destination_island, o.destination_island) AS destination_island,
        o.reference  AS order_reference,
        rc.full_name AS recipient_name,
        rc.phone     AS recipient_phone,
        r.name       AS relay_name,
        EXTRACT(EPOCH FROM (NOW() - p.updated_at)) / 86400 AS days_stalled,
        EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 86400 AS total_age_days
      FROM parcels p
      LEFT JOIN orders o  ON o.id = p.order_id
      LEFT JOIN relais r  ON r.id = COALESCE(p.relay_id, o.relais_id)
      LEFT JOIN recipients rc ON rc.id = o.recipient_id
      WHERE (
        (p.status = 'in_transit' AND p.updated_at < NOW() - INTERVAL '${SLA.in_transit_warning} days')
        OR (p.status = 'available' AND p.updated_at < NOW() - INTERVAL '${SLA.available_warning} days')
        OR (p.status = 'shipped'   AND p.updated_at < NOW() - INTERVAL '${SLA.shipped_warning} days')
      )
      ORDER BY days_stalled DESC
    `);

    res.json({
      count: rows.length,
      parcels: rows.map(p => ({
        ...p,
        days_stalled:    Math.round(Number(p.days_stalled)),
        total_age_days:  Math.round(Number(p.total_age_days)),
        severity: Number(p.days_stalled) > SLA.in_transit_late ? 'high'
                : Number(p.days_stalled) > SLA.in_transit_warning ? 'medium' : 'low',
      })),
    });
  } catch(e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/transit/alerts — Alertes actives
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/alerts', ...transitAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT a.*,
        CASE a.entity_type
          WHEN 'parcel' THEN (SELECT p.reference FROM parcels p WHERE p.id = a.entity_id)
          WHEN 'order'  THEN (SELECT o.reference FROM orders  o WHERE o.id = a.entity_id)
          ELSE NULL
        END AS entity_reference
      FROM alerts a
      WHERE a.resolved_at IS NULL
      ORDER BY
        CASE a.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
        a.created_at DESC
      LIMIT 100
    `);
    res.json({ count: rows.length, alerts: rows });
  } catch(e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/transit/alerts/:id/resolve — Résoudre une alerte
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/alerts/:id/resolve', ...transitAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      UPDATE alerts
      SET resolved_at = NOW(), resolved_by = $1
      WHERE id = $2 AND resolved_at IS NULL
      RETURNING *
    `, [req.user.id, req.params.id]);

    if (!rows.length) return res.status(404).json({ error: 'Alerte introuvable ou déjà résolue' });
    res.json(rows[0]);
  } catch(e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PATCH /api/transit/parcels/:id/destination — Assigner destination au colis
// ═══════════════════════════════════════════════════════════════════════════════
router.patch('/parcels/:id/destination', ...transitAuth, async (req, res, next) => {
  try {
    const { destination_island, relay_id, eta } = req.body;

    const parcelCheck = await db.query('SELECT id FROM parcels WHERE id = $1', [req.params.id]);
    if (!parcelCheck.rows.length) return res.status(404).json({ error: 'Colis introuvable' });

    const updates = [];
    const vals    = [];
    let i = 1;

    if (destination_island) { updates.push(`destination_island = $${i++}`); vals.push(destination_island); }
    if (relay_id)           { updates.push(`relay_id = $${i++}`);           vals.push(relay_id); }
    if (eta)                { updates.push(`eta = $${i++}`);                vals.push(eta); }
    updates.push('updated_at = NOW()');

    if (updates.length === 1) return res.status(400).json({ error: 'Aucun champ à mettre à jour' });

    vals.push(req.params.id);
    const { rows } = await db.query(
      `UPDATE parcels SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
      vals
    );
    res.json(rows[0]);
  } catch(e) { next(e); }
});

module.exports = router;
