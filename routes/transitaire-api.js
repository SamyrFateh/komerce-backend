/**
 * ═══════════════════════════════════════════════════════════════
 * TRANSITAIRE API — Transit agent endpoints
 * Mounted at /api/transitaire
 * ═══════════════════════════════════════════════════════════════
 *
 * The transitaire receives shipped parcels from the Hub
 * and confirms transit (shipped → in_transit).
 * Uses the scan-engine for the actual transition.
 * ═══════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { processScan } = require('../services/scan-engine');

const guard = [authenticate, requireRole(['admin', 'agent_hub', 'agent_transitaire'])];

// ── GET /parcels — List parcels ready for transit (shipped) ──
router.get('/parcels', ...guard, async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT p.id, p.reference, p.status, p.weight_kg,
             p.created_at, p.shipped_at,
             o.reference AS order_ref, o.destination_island,
             u.full_name AS customer_name,
             r.name AS relais_name,
             (SELECT COUNT(*)::int FROM parcel_items pi WHERE pi.parcel_id = p.id) AS nb_items
      FROM parcels p
      LEFT JOIN orders o ON o.id = p.order_id
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN relais r ON r.id = o.relais_id
      WHERE p.status = 'shipped'
      ORDER BY p.shipped_at ASC
    `);

    res.json({ parcels: rows, count: rows.length });
  } catch (err) { next(err); }
});

// ── POST /ship — Confirm transit (shipped → in_transit) ──
router.post('/ship', ...guard, async (req, res, next) => {
  try {
    const { parcel_id, notes } = req.body;
    if (!parcel_id) return res.status(400).json({ error: 'parcel_id requis' });

    // Use scan-engine with transit_confirmed event
    const result = await processScan({
      parcel_id,
      event_type: 'transit_confirmed',
      scanned_by: req.user.id,
      actor_name: req.user.full_name || req.user.email,
      actor_role: req.user.role || 'agent_transitaire',
      location: 'transitaire',
      notes: notes || 'Transit confirmé par transitaire',
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error?.message || 'Échec de la transition', details: result });
    }

    res.json({
      success: true,
      parcel: result.parcel,
      message: `Colis ${result.parcel?.reference || parcel_id} en transit ✈️`,
    });
  } catch (err) { next(err); }
});

// ── GET /stats — Transitaire KPIs ──
router.get('/stats', ...guard, async (req, res, next) => {
  try {
    const { rows: [stats] } = await db.query(`
      SELECT
        (SELECT COUNT(*)::int FROM parcels WHERE status = 'shipped') AS ready_to_ship,
        (SELECT COUNT(*)::int FROM parcels WHERE status = 'in_transit') AS in_transit,
        (SELECT COUNT(*)::int FROM parcels WHERE status IN ('shipped', 'in_transit')) AS total_active,
        (SELECT COALESCE(SUM(weight_kg), 0)::numeric(10,2) FROM parcels WHERE status = 'shipped') AS total_weight_shipped,
        (SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (NOW() - shipped_at)) / 3600), 0)::numeric(10,1)
         FROM parcels WHERE status = 'shipped' AND shipped_at IS NOT NULL) AS avg_wait_hours,
        (SELECT COUNT(*)::int FROM parcels 
         WHERE status = 'shipped' AND shipped_at IS NOT NULL 
           AND shipped_at < NOW() - INTERVAL '48 hours') AS overdue_shipments
    `);

    res.json(stats);
  } catch (err) { next(err); }
});

// ── GET /history — Recent transit events ──
router.get('/history', ...guard, async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT se.id, se.event_type, se.created_at, se.actor_name, se.notes,
             p.reference AS parcel_ref, o.reference AS order_ref
      FROM scan_events se
      JOIN parcels p ON p.id = se.parcel_id
      LEFT JOIN orders o ON o.id = se.order_id
      WHERE se.event_type = 'transit_confirmed' AND se.status = 'applied'
      ORDER BY se.created_at DESC
      LIMIT 50
    `);

    res.json({ events: rows });
  } catch (err) { next(err); }
});

module.exports = router;
