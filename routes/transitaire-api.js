/**
 * TRANSITAIRE API — Transit agent endpoints
 * Mounted at /api/transitaire
 *
 * Simplified: direct SQL + state machine (no scan-engine dependency)
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { transitionOrderStatus } = require('../services/order-status-machine');
const log = require('../utils/logger').child({ module: 'transitaire-api' });

const guard = [authenticate, requireRole(['admin', 'agent_hub', 'agent_transitaire'])];

// ── GET /parcels — List parcels ready for transit (shipped) ──
router.get('/parcels', ...guard, async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT p.id, p.reference, p.status, p.weight_kg,
             p.created_at, p.shipped_at, p.relais_id,
             o.reference AS order_ref, o.destination_island,
             u.full_name AS customer_name,
             r.name AS relais_name
      FROM parcels p
      LEFT JOIN orders o ON o.id = p.order_id
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN relais r ON r.id = COALESCE(p.relais_id, o.relais_id)
      WHERE p.status = 'shipped'
      ORDER BY p.shipped_at ASC
    `);

    // Count items per parcel
    for (const p of rows) {
      const { rows: [cnt] } = await db.query(
        `SELECT COUNT(*)::int AS nb FROM parcel_items WHERE parcel_id = $1`, [p.id]
      );
      p.nb_items = cnt.nb;
    }

    res.json({ parcels: rows, count: rows.length });
  } catch (err) { next(err); }
});

// ── POST /ship — Confirm transit (shipped → in_transit) ──
router.post('/ship', ...guard, async (req, res, next) => {
  try {
    const { parcel_id, notes } = req.body;
    if (!parcel_id) return res.status(400).json({ error: 'parcel_id requis' });

    // 1. Load parcel
    const { rows: [parcel] } = await db.query(
      `SELECT p.*, o.id AS order_id FROM parcels p LEFT JOIN orders o ON o.id = p.order_id WHERE p.id = $1`,
      [parcel_id]
    );
    if (!parcel) return res.status(404).json({ error: 'Colis introuvable' });
    if (parcel.status !== 'shipped') {
      return res.status(400).json({ error: `Colis en statut "${parcel.status}" — doit être "shipped" pour confirmer le transit` });
    }

    // [P1-2] Cohérence transactionnelle parcel + order.
    // Avant : UPDATE parcel direct puis try/catch order (non-bloquant) → divergence possible
    //         (parcel en in_transit avec order encore shipped si state machine order refuse)
    // Après : transaction atomique. Si l'order ne peut pas transiter, le parcel reste shipped.
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // 2. Transition order via state machine EN PREMIER (source of truth)
      //    Si elle refuse, on rollback et on n'a rien touché.
      if (parcel.order_id) {
        const orderResult = await transitionOrderStatus({
          orderId: parcel.order_id,
          newStatus: 'in_transit',
          actor: { id: req.user.id, role: req.user.role },
          source: 'transitaire_ship',
          note: notes || 'Transit confirmé par transitaire',
          dbClient: client,
        });

        if (!orderResult.success && !orderResult.noop) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            error: `Transition order refusée : ${orderResult.error}`,
            current_status: orderResult.previousStatus,
          });
        }
      }

      // 3. Update parcel status: shipped → in_transit (dans la même transaction)
      await client.query(
        `UPDATE parcels SET status = 'in_transit', updated_at = NOW() WHERE id = $1`,
        [parcel_id]
      );

      // 4. Log scan event (dans la transaction — pas "best effort" séparé)
      await client.query(`
        INSERT INTO scan_events (parcel_id, order_id, event_type, actor_name, actor_role, location, notes, status)
        VALUES ($1, $2, 'transit_confirmed', $3, $4, 'transitaire', $5, 'applied')
      `, [parcel_id, parcel.order_id, req.user.full_name || req.user.email, req.user.role, notes || 'Transit confirmé']);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // 5. WhatsApp notification (après COMMIT, fire-and-forget)
    try {
      const { notifyParcelScan } = require('../services/notification-service');
      notifyParcelScan(parcel_id, parcel.reference, 'in_transit')
        .catch(err => log.warn('[TRANSITAIRE] Notification error:', err.message));
    } catch (e) { /* notification service not available */ }

    res.json({
      success: true,
      parcel: { ...parcel, status: 'in_transit' },
      message: `Colis ${parcel.reference} en transit ✈️`,
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
             p.reference AS parcel_ref
      FROM scan_events se
      JOIN parcels p ON p.id = se.parcel_id
      WHERE se.event_type = 'transit_confirmed' AND se.status = 'applied'
      ORDER BY se.created_at DESC
      LIMIT 50
    `);

    res.json({ events: rows });
  } catch (err) { next(err); }
});

module.exports = router;
