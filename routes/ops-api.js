// routes/ops-api.js — v2.0 — Endpoints opérationnels pour Control Tower
// Requête directement la DB — pas de dépendance aux services v2
const express = require('express');
const router = express.Router();
const pool = require('../db');

// ─── GET /api/v2/incidents ──────────────────────────────────────────
router.get('/incidents', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        i.id, i.incident_type, i.severity, i.status, i.title, i.description,
        i.details, i.client_impact, i.client_notified, i.detected_source,
        i.resolution, i.resolution_type, i.resolved_at,
        i.created_at, i.updated_at,
        p.reference AS parcel_reference, p.status AS parcel_status,
        o.reference AS order_reference,
        u_detected.full_name AS detected_by_name,
        u_resolved.full_name AS resolved_by_name
      FROM incidents i
      LEFT JOIN parcels p ON i.parcel_id = p.id
      LEFT JOIN orders o ON i.order_id = o.id
      LEFT JOIN users u_detected ON i.detected_by = u_detected.id
      LEFT JOIN users u_resolved ON i.resolved_by = u_resolved.id
      ORDER BY 
        CASE i.severity 
          WHEN 'critical' THEN 0 WHEN 'high' THEN 1 
          WHEN 'medium' THEN 2 ELSE 3 
        END,
        i.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('GET /api/v2/incidents error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/v2/reconciliation/summary ─────────────────────────────
router.get('/reconciliation/summary', async (req, res) => {
  try {
    // Reconciliation based on parcel_items.verified status
    const { rows: summary } = await pool.query(`
      SELECT 
        COUNT(DISTINCT p.id) AS total_parcels,
        COUNT(DISTINCT p.id) FILTER (
          WHERE NOT EXISTS (
            SELECT 1 FROM parcel_items pi WHERE pi.parcel_id = p.id AND pi.verified = false
          ) AND EXISTS (
            SELECT 1 FROM parcel_items pi2 WHERE pi2.parcel_id = p.id
          )
        ) AS reconciled,
        COUNT(DISTINCT p.id) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM parcel_items pi WHERE pi.parcel_id = p.id AND pi.verified = false
          )
        ) AS pending,
        COUNT(DISTINCT p.id) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM incidents inc WHERE inc.parcel_id = p.id AND inc.status = 'open'
          )
        ) AS anomalies
      FROM parcels p
      WHERE p.status NOT IN ('draft', 'cancelled')
    `);

    const s = summary[0] || {};

    // Details: parcels with their verification info
    const { rows: parcels } = await pool.query(`
      SELECT 
        p.id, p.reference, p.status, p.weight_kg,
        p.created_at, p.shipped_at, p.arrived_at,
        o.reference AS order_reference,
        r.name AS relay_name,
        COALESCE(pi_stats.total_items, 0) AS total_items,
        COALESCE(pi_stats.verified_items, 0) AS verified_items,
        CASE 
          WHEN pi_stats.total_items = 0 THEN 'no_items'
          WHEN pi_stats.verified_items = pi_stats.total_items THEN 'verified'
          WHEN pi_stats.verified_items > 0 THEN 'partial'
          ELSE 'pending'
        END AS verification_status
      FROM parcels p
      LEFT JOIN orders o ON p.order_id = o.id
      LEFT JOIN relais r ON p.relais_id = r.id
      LEFT JOIN LATERAL (
        SELECT 
          COUNT(*) AS total_items,
          COUNT(*) FILTER (WHERE verified = true) AS verified_items
        FROM parcel_items WHERE parcel_id = p.id
      ) pi_stats ON true
      WHERE p.status NOT IN ('draft', 'cancelled')
      ORDER BY p.created_at DESC
      LIMIT 100
    `);

    res.json({
      summary: {
        total_parcels: parseInt(s.total_parcels) || 0,
        reconciled: parseInt(s.reconciled) || 0,
        pending: parseInt(s.pending) || 0,
        anomalies: parseInt(s.anomalies) || 0,
        rate: s.total_parcels > 0 
          ? Math.round((parseInt(s.reconciled) / parseInt(s.total_parcels)) * 100) 
          : 0
      },
      parcels
    });
  } catch (err) {
    console.error('GET /api/v2/reconciliation/summary error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/v2/alerts ─────────────────────────────────────────────
// Auto-generated alerts from business rules
router.get('/alerts', async (req, res) => {
  try {
    const alerts = [];

    // 1. Cash orders pending > 72h
    const { rows: cashAlerts } = await pool.query(`
      SELECT o.id, o.reference, o.total_kmf, o.created_at,
             u.full_name AS customer_name,
             r.name AS relay_name,
             EXTRACT(EPOCH FROM (NOW() - o.created_at)) / 3600 AS hours_pending
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN relais r ON o.relais_id = r.id
      WHERE o.payment_mode = 'cash' 
        AND o.payment_status = 'pending'
        AND o.status NOT IN ('cancelled', 'collected')
        AND o.created_at < NOW() - INTERVAL '72 hours'
      ORDER BY o.created_at ASC
    `);
    cashAlerts.forEach(o => alerts.push({
      id: `cash-${o.id}`,
      type: 'cash_pending',
      severity: 'high',
      message: `💵 Paiement cash en attente depuis ${Math.round(o.hours_pending)}h — ${o.reference}`,
      order_reference: o.reference,
      customer: o.customer_name,
      relay: o.relay_name,
      amount_kmf: o.total_kmf,
      created_at: o.created_at
    }));

    // 2. Stuck parcels > 7 days in same status
    const { rows: stuckAlerts } = await pool.query(`
      SELECT p.id, p.reference, p.status, p.updated_at,
             o.reference AS order_reference,
             EXTRACT(EPOCH FROM (NOW() - p.updated_at)) / 86400 AS days_stuck
      FROM parcels p
      LEFT JOIN orders o ON p.order_id = o.id
      WHERE p.status NOT IN ('collected', 'cancelled', 'draft')
        AND p.updated_at < NOW() - INTERVAL '7 days'
      ORDER BY p.updated_at ASC
    `);
    stuckAlerts.forEach(p => alerts.push({
      id: `stuck-${p.id}`,
      type: 'stuck_parcel',
      severity: 'medium',
      message: `📦 Colis bloqué depuis ${Math.round(p.days_stuck)}j en statut "${p.status}" — ${p.reference}`,
      parcel_reference: p.reference,
      order_reference: p.order_reference,
      status: p.status,
      days_stuck: Math.round(p.days_stuck),
      created_at: p.updated_at
    }));

    // 3. SLA breach > 21 days (order created → collected)
    const { rows: slaAlerts } = await pool.query(`
      SELECT o.id, o.reference, o.status, o.created_at, o.total_kmf,
             u.full_name AS customer_name,
             EXTRACT(EPOCH FROM (NOW() - o.created_at)) / 86400 AS days_elapsed
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE o.status NOT IN ('cancelled', 'collected')
        AND o.created_at < NOW() - INTERVAL '21 days'
      ORDER BY o.created_at ASC
    `);
    slaAlerts.forEach(o => alerts.push({
      id: `sla-${o.id}`,
      type: 'sla_breach',
      severity: 'critical',
      message: `🚨 SLA dépassé (${Math.round(o.days_elapsed)}j) — ${o.reference} (${o.customer_name || 'Client inconnu'})`,
      order_reference: o.reference,
      customer: o.customer_name,
      days_elapsed: Math.round(o.days_elapsed),
      amount_kmf: o.total_kmf,
      created_at: o.created_at
    }));

    // 4. Weight anomalies (incidents of type weight_mismatch still open)
    const { rows: weightAlerts } = await pool.query(`
      SELECT i.id, i.title, i.description, i.details, i.created_at,
             p.reference AS parcel_reference
      FROM incidents i
      LEFT JOIN parcels p ON i.parcel_id = p.id
      WHERE i.incident_type = 'weight_mismatch' AND i.status = 'open'
      ORDER BY i.created_at DESC
    `);
    weightAlerts.forEach(i => alerts.push({
      id: `weight-${i.id}`,
      type: 'weight_anomaly',
      severity: 'medium',
      message: `⚖️ Anomalie poids — ${i.parcel_reference}: ${i.title}`,
      parcel_reference: i.parcel_reference,
      details: i.details,
      created_at: i.created_at
    }));

    // Sort by severity
    const sevOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    alerts.sort((a, b) => (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9));

    res.json(alerts);
  } catch (err) {
    console.error('GET /api/v2/alerts error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/v2/alerts/:id/acknowledge ────────────────────────────
router.post('/alerts/:id/acknowledge', async (req, res) => {
  try {
    // For incident-based alerts, mark as resolved
    const alertId = req.params.id;
    
    if (alertId.startsWith('weight-')) {
      const incidentId = alertId.replace('weight-', '');
      await pool.query(
        `UPDATE incidents SET status = 'resolved', resolved_at = NOW(), 
         resolution = $1 WHERE id = $2`,
        [JSON.stringify({ type: 'acknowledged', note: 'Acquitté via Control Tower' }), incidentId]
      );
    }
    
    res.json({ success: true, message: 'Alerte acquittée' });
  } catch (err) {
    console.error('POST /api/v2/alerts/:id/acknowledge error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/v2/parcels/:id ────────────────────────────────────────
router.get('/parcels/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        p.*,
        o.reference AS order_reference, o.status AS order_status,
        o.total_kmf, o.payment_mode, o.payment_status,
        u.full_name AS customer_name, u.phone AS customer_phone,
        r.name AS relay_name, r.city AS relay_city,
        (SELECT COUNT(*) FROM parcel_items pi WHERE pi.parcel_id = p.id) AS item_count,
        (SELECT COUNT(*) FROM scan_events se WHERE se.parcel_id = p.id) AS scan_count,
        (SELECT COUNT(*) FROM incidents i WHERE i.parcel_id = p.id) AS incident_count
      FROM parcels p
      LEFT JOIN orders o ON p.order_id = o.id
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN relais r ON p.relais_id = r.id
      WHERE p.id = $1
    `, [req.params.id]);

    if (!rows.length) return res.status(404).json({ error: 'Colis non trouvé' });
    res.json(rows[0]);
  } catch (err) {
    console.error('GET /api/v2/parcels/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/v2/parcels/:id/scans ──────────────────────────────────
router.get('/parcels/:id/scans', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        se.id, se.event_type, se.scan_code, se.actor_name, se.actor_role,
        se.location, se.notes, se.metadata, se.status,
        se.qty_before, se.qty_after,
        se.created_at,
        u.full_name AS scanned_by_name
      FROM scan_events se
      LEFT JOIN users u ON se.scanned_by = u.id
      WHERE se.parcel_id = $1
      ORDER BY se.created_at ASC
    `, [req.params.id]);
    res.json(rows);
  } catch (err) {
    console.error('GET /api/v2/parcels/:id/scans error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/v2/parcels/:id/orders ─────────────────────────────────
// Returns orders linked to this parcel + their items (for drill-down accordion)
router.get('/parcels/:id/orders', async (req, res) => {
  try {
    // Get the order linked to this parcel
    const { rows: parcels } = await pool.query(
      `SELECT order_id FROM parcels WHERE id = $1`, [req.params.id]
    );
    if (!parcels.length) return res.json([]);

    const orderId = parcels[0].order_id;

    const { rows: orders } = await pool.query(`
      SELECT 
        o.id, o.reference, o.status, o.total_kmf, o.payment_mode, o.payment_status,
        o.created_at, o.shipped_at, o.available_at, o.collected_at,
        u.full_name AS customer_name,
        r.name AS relay_name
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN relais r ON o.relais_id = r.id
      WHERE o.id = $1
    `, [orderId]);

    // Get items for the order
    for (const order of orders) {
      const { rows: items } = await pool.query(`
        SELECT 
          oi.id, oi.quantity, oi.price_kmf, oi.scan_code,
          p.name AS product_name, p.sku,
          pi.quantity AS parcel_qty, pi.qty_packed, pi.qty_shipped, 
          pi.qty_received, pi.qty_collected, pi.verified
        FROM order_items oi
        LEFT JOIN products p ON oi.product_id = p.id
        LEFT JOIN parcel_items pi ON pi.order_item_id = oi.id AND pi.parcel_id = $1
        WHERE oi.order_id = $2
        ORDER BY oi.created_at ASC
      `, [req.params.id, order.id]);
      order.items = items;
    }

    res.json(orders);
  } catch (err) {
    console.error('GET /api/v2/parcels/:id/orders error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
