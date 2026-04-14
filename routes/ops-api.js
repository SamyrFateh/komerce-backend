// ============================================================
// routes/ops-api.js — Lightweight v2 API endpoints
// Feeds: Incidents, Reconciliation, Alerts, Parcel drill-down
// ============================================================
const express = require('express');
const router = express.Router();
const pool = require('../db');

// ---- INCIDENTS ----
router.get('/incidents', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT i.*,
        o.reference as order_reference,
        p.reference as parcel_reference,
        p.status as parcel_status,
        u.name as detected_by_name
      FROM incidents i
      LEFT JOIN orders o ON o.id = i.order_id
      LEFT JOIN parcels p ON p.id = i.parcel_id
      LEFT JOIN users u ON u.id = i.detected_by
      ORDER BY i.created_at DESC
    `);
    res.json({ incidents: rows, total: rows.length });
  } catch (err) {
    console.error('[ops-api] incidents error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---- RECONCILIATION SUMMARY ----
router.get('/reconciliation/summary', async (req, res) => {
  try {
    const totalQ = await pool.query(`SELECT count(*) as total FROM parcels`);
    const reconciledQ = await pool.query(`
      SELECT count(*) as total FROM parcels 
      WHERE verification_status = 'verified'
    `);
    const pendingQ = await pool.query(`
      SELECT count(*) as total FROM parcels 
      WHERE verification_status IS NULL OR verification_status = 'pending'
    `);
    const anomalyQ = await pool.query(`
      SELECT count(*) as total FROM parcels 
      WHERE verification_status = 'anomaly'
    `);
    
    // Get recent reconciliation details
    const detailsQ = await pool.query(`
      SELECT p.id, p.reference, p.status, p.verification_status,
        p.verified_at, p.verification_notes,
        p.expected_weight_kg, p.actual_weight_kg,
        o.reference as order_reference,
        r.name as relay_name,
        (SELECT count(*) FROM parcel_items pi WHERE pi.parcel_id = p.id) as items_count,
        (SELECT count(*) FROM parcel_items pi WHERE pi.parcel_id = p.id AND pi.verified = true) as verified_items
      FROM parcels p
      LEFT JOIN orders o ON o.id = p.order_id
      LEFT JOIN relais r ON r.id = p.relay_id
      ORDER BY p.updated_at DESC
      LIMIT 50
    `);

    const total = parseInt(totalQ.rows[0].total);
    const reconciled = parseInt(reconciledQ.rows[0].total);
    const pending = parseInt(pendingQ.rows[0].total);
    const anomalies = parseInt(anomalyQ.rows[0].total);

    res.json({
      summary: {
        total_parcels: total,
        reconciled,
        pending,
        anomalies,
        rate: total > 0 ? Math.round((reconciled / total) * 100) : 0
      },
      parcels: detailsQ.rows
    });
  } catch (err) {
    console.error('[ops-api] reconciliation error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---- ALERTS ----
router.get('/alerts', async (req, res) => {
  try {
    // Generate alerts from data analysis
    const alerts = [];

    // 1. Cash pending > 72h
    const cashQ = await pool.query(`
      SELECT p.id, p.reference, o.reference as order_ref, o.total_amount,
        p.available_at, r.name as relay_name,
        EXTRACT(EPOCH FROM (NOW() - p.available_at)) / 3600 as hours_waiting
      FROM parcels p
      JOIN orders o ON o.id = p.order_id
      LEFT JOIN relais r ON r.id = p.relay_id
      WHERE p.status = 'available' 
        AND p.collected_at IS NULL
        AND p.available_at < NOW() - INTERVAL '72 hours'
        AND o.payment_method = 'cash'
    `);
    cashQ.rows.forEach(r => {
      alerts.push({
        id: 'cash-' + r.id,
        type: 'cash_pending',
        severity: 'high',
        title: `💰 Cash en attente > 72h`,
        description: `Colis ${r.reference || r.id} — ${Math.round(r.hours_waiting)}h au relais ${r.relay_name || '?'}`,
        amount: r.total_amount,
        parcel_id: r.id,
        created_at: r.available_at
      });
    });

    // 2. Stuck parcels > 7 days
    const stuckQ = await pool.query(`
      SELECT p.id, p.reference, p.status, p.shipped_at, p.in_transit_at,
        o.reference as order_ref,
        EXTRACT(EPOCH FROM (NOW() - COALESCE(p.in_transit_at, p.shipped_at))) / 86400 as days_stuck
      FROM parcels p
      JOIN orders o ON o.id = p.order_id
      WHERE p.status IN ('shipped', 'in_transit')
        AND COALESCE(p.in_transit_at, p.shipped_at) < NOW() - INTERVAL '7 days'
    `);
    stuckQ.rows.forEach(r => {
      alerts.push({
        id: 'stuck-' + r.id,
        type: 'stuck_parcel',
        severity: 'high',
        title: `📦 Colis bloqué > 7 jours`,
        description: `Colis ${r.reference || r.id} — ${Math.round(r.days_stuck)} jours en ${r.status}`,
        parcel_id: r.id,
        created_at: r.shipped_at || r.in_transit_at
      });
    });

    // 3. SLA breach > 21 days
    const slaQ = await pool.query(`
      SELECT p.id, p.reference, p.status, o.reference as order_ref, o.created_at as order_date,
        EXTRACT(EPOCH FROM (NOW() - o.created_at)) / 86400 as days_since_order
      FROM parcels p
      JOIN orders o ON o.id = p.order_id
      WHERE p.status NOT IN ('collected', 'cancelled')
        AND o.created_at < NOW() - INTERVAL '21 days'
    `);
    slaQ.rows.forEach(r => {
      alerts.push({
        id: 'sla-' + r.id,
        type: 'sla_breach',
        severity: 'critical',
        title: `⏰ SLA dépassé > 21 jours`,
        description: `Colis ${r.reference || r.id} — ${Math.round(r.days_since_order)} jours depuis commande`,
        parcel_id: r.id,
        created_at: r.order_date
      });
    });

    // 4. Weight mismatches (from incidents)
    const weightQ = await pool.query(`
      SELECT i.id, i.parcel_id, i.description, i.severity, i.created_at,
        p.reference as parcel_reference
      FROM incidents i
      JOIN parcels p ON p.id = i.parcel_id
      WHERE i.incident_type = 'weight_mismatch' AND i.status = 'open'
    `);
    weightQ.rows.forEach(r => {
      alerts.push({
        id: 'weight-' + r.id,
        type: 'weight_mismatch',
        severity: r.severity || 'medium',
        title: `⚖️ Poids incohérent`,
        description: r.description || `Colis ${r.parcel_reference}`,
        parcel_id: r.parcel_id,
        created_at: r.created_at
      });
    });

    // Sort by severity then date
    const sevOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    alerts.sort((a, b) => (sevOrder[a.severity] || 9) - (sevOrder[b.severity] || 9));

    res.json({ alerts, total: alerts.length });
  } catch (err) {
    console.error('[ops-api] alerts error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---- ACKNOWLEDGE ALERT ----
router.post('/alerts/:alertId/acknowledge', async (req, res) => {
  try {
    const { alertId } = req.params;
    // If it's an incident-based alert, resolve the incident
    if (alertId.startsWith('weight-')) {
      const incidentId = alertId.replace('weight-', '');
      await pool.query(`UPDATE incidents SET status = 'resolved', resolved_at = NOW() WHERE id = $1`, [incidentId]);
    }
    res.json({ success: true, message: 'Alert acknowledged' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- PARCEL DRILL-DOWN ----
router.get('/parcels/:parcelId', async (req, res) => {
  try {
    const { parcelId } = req.params;
    const { rows } = await pool.query(`
      SELECT p.*,
        o.reference as order_reference,
        o.customer_name, o.customer_phone,
        r.name as relay_name
      FROM parcels p
      LEFT JOIN orders o ON o.id = p.order_id
      LEFT JOIN relais r ON r.id = p.relay_id
      WHERE p.id = $1
    `, [parcelId]);
    
    if (!rows.length) return res.status(404).json({ error: 'Colis introuvable' });
    res.json({ parcel: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- PARCEL SCANS ----
router.get('/parcels/:parcelId/scans', async (req, res) => {
  try {
    const { parcelId } = req.params;
    const { rows } = await pool.query(`
      SELECT se.*,
        u.name as actor_name_lookup
      FROM scan_events se
      LEFT JOIN users u ON u.id = se.scanned_by
      WHERE se.parcel_id = $1
      ORDER BY se.created_at ASC
    `, [parcelId]);
    
    // Map scan_code to scan_type for frontend compatibility
    const scans = rows.map(s => ({
      ...s,
      scan_type: s.event_type || s.scan_code || 'unknown',
      scanned_at: s.created_at
    }));
    
    res.json({ scans, total: scans.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- PARCEL → LINKED ORDERS ----
router.get('/parcels/:parcelId/orders', async (req, res) => {
  try {
    const { parcelId } = req.params;
    
    // Get orders linked via parcel_items or direct order_id
    const { rows: orders } = await pool.query(`
      SELECT DISTINCT o.*,
        (SELECT count(*) FROM parcels pp WHERE pp.order_id = o.id) as total_parcels,
        (SELECT count(*) FROM parcels pp WHERE pp.order_id = o.id AND pp.status IN ('collected', 'available')) as delivered_parcels
      FROM orders o
      WHERE o.id IN (
        SELECT p.order_id FROM parcels p WHERE p.id = $1
        UNION
        SELECT oi.order_id FROM order_items oi 
        JOIN parcel_items pi ON pi.order_item_id = oi.id 
        WHERE pi.parcel_id = $1
      )
    `, [parcelId]);

    // For each order, get items
    for (const order of orders) {
      const { rows: items } = await pool.query(`
        SELECT oi.*, pr.name as product_name,
          pi.quantity as packed_qty, pi.verified
        FROM order_items oi
        LEFT JOIN products pr ON pr.id = oi.product_id
        LEFT JOIN parcel_items pi ON pi.order_item_id = oi.id AND pi.parcel_id = $1
        WHERE oi.order_id = $2
      `, [parcelId, order.id]);
      order.items = items;
    }

    res.json({ orders, total: orders.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
