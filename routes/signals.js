/**
 * @komerce-arch
 * @role          signals
 * @domain        recommendations
 * @layer         route
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       signals
 * @db-write      signals
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  unknown
 * @version       2026-06
 */

/**
 * Signals API — Komerce Control Tower
 * Routes: /api/admin/signals/*
 *
 * Endpoints:
 *   GET    /              — List signals (with filters)
 *   GET    /stats         — Aggregated counts by severity/type/status
 *   POST   /generate      — Run signal generators (admin only)
 *   POST   /:id/acknowledge — Mark signal as acknowledged
 *   POST   /:id/snooze    — Snooze signal for N hours
 *   POST   /:id/resolve   — Resolve signal
 *   DELETE /:id           — Delete signal (admin only)
 */

var express = require('express');
var router = express.Router();
var db = require('../db');
var { authenticate, requireAdmin } = require('../middleware/auth');
var signalService = require('../services/signal-service');
var log = require('../utils/logger').child({ module: 'signals' });

/* All routes require authentication + admin role */
router.use(authenticate, requireAdmin);

/* ═══════════════════════════════════════════════════════════════
   GET / — List signals
   Query params: status, severity, signal_type, owner_role, limit, offset
   ═══════════════════════════════════════════════════════════════ */
router.get('/', async function(req, res) {
  try {
    var where = [];
    var params = [];
    var idx = 1;

    if (req.query.status) {
      where.push('s.status = $' + idx++);
      params.push(req.query.status);
    } else {
      // Default: show open + acknowledged
      where.push("s.status IN ('open','acknowledged')");
    }

    if (req.query.severity) {
      where.push('s.severity = $' + idx++);
      params.push(req.query.severity);
    }
    if (req.query.signal_type) {
      where.push('s.signal_type = $' + idx++);
      params.push(req.query.signal_type);
    }
    if (req.query.owner_role) {
      where.push('s.owner_role = $' + idx++);
      params.push(req.query.owner_role);
    }
    if (req.query.family) {
      // Map family to signal types (from ct-platform.js SIGNAL_TYPES)
      var familyMap = {
        ops:      ['parcel_blocked','cash_expiring','sla_breach','hub_tension','relay_tension','loyalty_pending'],
        eco:      ['margin_drift','pricing_outlier','category_drift','recon_anomaly'],
        sourcing: ['sourcing_arbitrage','product_dead','product_star','stock_rupture'],
        disputes: ['dispute_sensitive']
      };
      var types = familyMap[req.query.family];
      if (types) {
        where.push('s.signal_type = ANY($' + idx++ + ')');
        params.push(types);
      }
    }

    var limit  = Math.min(parseInt(req.query.limit) || 50, 200);
    var offset = parseInt(req.query.offset) || 0;

    var sql = `
      SELECT s.*
      FROM signals s
      WHERE ${where.join(' AND ')}
      ORDER BY
        CASE s.severity
          WHEN 'urgent' THEN 1
          WHEN 'critical' THEN 2
          WHEN 'warning' THEN 3
          ELSE 4
        END,
        s.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    var result = await db.query(sql, params);

    // Total count for pagination
    var countSql = `SELECT COUNT(*) FROM signals s WHERE ${where.join(' AND ')}`;
    var countResult = await db.query(countSql, params);

    res.json({
      signals: result.rows,
      total:   parseInt(countResult.rows[0].count),
      limit:   limit,
      offset:  offset
    });
  } catch (err) {
    next(err);
  }
});

/* ═══════════════════════════════════════════════════════════════
   GET /stats — Signal statistics
   ═══════════════════════════════════════════════════════════════ */
router.get('/stats', async function(req, res) {
  try {
    var bySeverity = (await db.query(`
      SELECT severity, COUNT(*) AS count
      FROM signals WHERE status IN ('open','acknowledged')
      GROUP BY severity
    `)).rows;

    var byType = (await db.query(`
      SELECT signal_type, COUNT(*) AS count
      FROM signals WHERE status IN ('open','acknowledged')
      GROUP BY signal_type ORDER BY count DESC
    `)).rows;

    var byFamily = (await db.query(`
      SELECT
        CASE
          WHEN signal_type IN ('parcel_blocked','cash_expiring','sla_breach','hub_tension','relay_tension','loyalty_pending') THEN 'ops'
          WHEN signal_type IN ('margin_drift','pricing_outlier','category_drift','recon_anomaly') THEN 'eco'
          WHEN signal_type IN ('sourcing_arbitrage','product_dead','product_star','stock_rupture') THEN 'sourcing'
          WHEN signal_type = 'dispute_sensitive' THEN 'disputes'
          ELSE 'other'
        END AS family,
        COUNT(*) AS count
      FROM signals WHERE status IN ('open','acknowledged')
      GROUP BY family ORDER BY count DESC
    `)).rows;

    var total = bySeverity.reduce(function(s, r) { return s + parseInt(r.count); }, 0);

    res.json({
      total:      total,
      bySeverity: bySeverity,
      byType:     byType,
      byFamily:   byFamily
    });
  } catch (err) {
    next(err);
  }
});

/* ═══════════════════════════════════════════════════════════════
   POST /generate — Run signal generators
   Body: { types: ['parcel_blocked', ...] } (optional, runs all if omitted)
   ═══════════════════════════════════════════════════════════════ */
router.post('/generate', async function(req, res) {
  try {
    var types = req.body.types || null;
    var result = await signalService.generateSignals(types);
    res.json({ ok: true, result: result });
  } catch (err) {
    next(err);
  }
});

/* ═══════════════════════════════════════════════════════════════
   POST /:id/acknowledge — Acknowledge a signal
   ═══════════════════════════════════════════════════════════════ */
router.post('/:id/acknowledge', async function(req, res) {
  try {
    var result = await db.query(`
      UPDATE signals
      SET status = 'acknowledged', updated_at = NOW()
      WHERE id = $1 AND status = 'open'
      RETURNING id, status
    `, [req.params.id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Signal not found or not open' });
    }
    res.json({ ok: true, signal: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

/* ═══════════════════════════════════════════════════════════════
   POST /:id/snooze — Snooze a signal
   Body: { hours: 24 }
   ═══════════════════════════════════════════════════════════════ */
router.post('/:id/snooze', async function(req, res) {
  try {
    var hours = parseInt(req.body.hours) || 24;
    var result = await db.query(`
      UPDATE signals
      SET status = 'snoozed',
          snoozed_until = NOW() + ($2 || ' hours')::interval,
          updated_at = NOW()
      WHERE id = $1 AND status IN ('open','acknowledged')
      RETURNING id, status, snoozed_until
    `, [req.params.id, hours.toString()]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Signal not found' });
    }
    res.json({ ok: true, signal: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

/* ═══════════════════════════════════════════════════════════════
   POST /:id/resolve — Resolve a signal
   Body: { notes: '...' } (optional)
   ═══════════════════════════════════════════════════════════════ */
router.post('/:id/resolve', async function(req, res) {
  try {
    var result = await db.query(`
      UPDATE signals
      SET status = 'resolved',
          resolved_at = NOW(),
          resolved_by = $2,
          updated_at = NOW()
      WHERE id = $1 AND status IN ('open','acknowledged','snoozed')
      RETURNING id, status, resolved_at
    `, [req.params.id, req.user.id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Signal not found' });
    }
    res.json({ ok: true, signal: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

/* ═══════════════════════════════════════════════════════════════
   DELETE /:id — Delete a signal (hard delete, admin only)
   ═══════════════════════════════════════════════════════════════ */
router.delete('/:id', async function(req, res) {
  try {
    var result = await db.query('DELETE FROM signals WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Signal not found' });
    }
    res.json({ ok: true, deleted: req.params.id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
